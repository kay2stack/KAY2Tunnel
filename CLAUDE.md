# KAY2Tunnel

A self-hosted remote control panel for the `kay2` Raspberry Pi. Terminal, file
browser/editor, and on-device AI — accessed from an iPhone (or any device) over
Tailscale. A leaner, more reliable replacement for Lunel.

> **no talk just make.** This file is the full spec. Build it.

-----

## Why this is not Lunel

Lunel routes the phone ↔ machine connection through a public relay
(`gateway.lunel.dev`) using 10-minute session codes and QR pairing, plus a
custom Rust PTY. The relay hop and session TTL are the reason its terminal
drops.

KAY2Tunnel deletes that entire layer. The Pi is already on Tailscale, so the
tunnel already exists. The phone connects **directly** to the Pi. No relay, no
session codes, no QR, no Rust binary.

|                   |Lunel                                   |KAY2Tunnel                         |
|-------------------|----------------------------------------|-----------------------------------|
|Transport          |Public relay + session code             |Direct, over Tailscale             |
|PTY                |Custom Rust + wezterm, 24fps render loop|`node-pty` + `xterm.js`            |
|Client             |Native app (Expo, App Store)            |PWA served by the Pi               |
|Session lifetime   |10 min TTL on relay                     |Lives as long as the server process|
|Reconnect behaviour|New session                             |Reattaches to the **same** shell   |

Result: fewer moving parts, no relay outages, terminal that survives a phone
locking/backgrounding.

-----

## Architecture

```
iPhone (Safari PWA)
      │  HTTPS / WSS  — over Tailscale only
      ▼
tailscale serve  →  https://kay2.<tailnet>.ts.net
      │
      ▼
KAY2Tunnel server  (Node, PM2-managed, listens 127.0.0.1:7420)
      ├── /            → static PWA
      ├── /ws/term     → WebSocket: node-pty sessions
      ├── /api/files/* → filesystem REST
      └── /api/ai/*    → proxy to local Ollama (127.0.0.1:11434)
```

The server binds to `127.0.0.1` only. `tailscale serve` is the *only* thing
that exposes it, so it is reachable from the tailnet and nowhere else. No port
is ever opened to the public internet.

-----

## Tech stack

- **Server:** Node.js 20+, Express, `ws` (WebSocket), `node-pty`.
- **Client:** vanilla TS/JS PWA — no framework. `@xterm/xterm` for the
  terminal, CodeMirror 6 for the file editor.
- **Process mgmt:** PM2 (`ecosystem.config.js`), consistent with the rest of
  the Pi.
- **AI:** proxy to the Ollama instance already on the Pi (Gemma etc.).
- **Repo:** `kay2stack/KAY2Tunnel`.

Keep dependencies minimal. No build step for the client beyond bundling
xterm/CodeMirror — prefer pinned files in `public/vendor/` over a bundler so it
stays buildable/iterable from an iPhone.

-----

## Project structure

```
KAY2Tunnel/
├── CLAUDE.md
├── package.json
├── ecosystem.config.js          # PM2
├── .env.example
├── server/
│   ├── index.js                 # Express + WS bootstrap, static serving
│   ├── config.js                # env load, ROOT_DIR, token, port
│   ├── auth.js                  # bearer-token middleware (HTTP + WS)
│   ├── terminal.js              # PTY session manager
│   ├── files.js                 # filesystem routes
│   └── ai.js                    # Ollama proxy routes
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js                   # tab router, auth bootstrap, reconnect logic
    ├── term.js                  # xterm wiring + mobile key bar
    ├── files.js                 # file tree + CodeMirror editor
    ├── ai.js                    # chat panel
    ├── manifest.webmanifest
    ├── sw.js                    # service worker (app-shell cache only)
    ├── icons/                   # 192 + 512 PWA icons
    └── vendor/                  # xterm, codemirror, addons (pinned)
```

-----

## Server

### config.js

Load from `.env`:

- `PORT` (default `7420`), bind host always `127.0.0.1`.
- `AUTH_TOKEN` — long random string. Required; refuse to start without it.
- `ROOT_DIR` — default `/home/kay2`. The filesystem API is jailed to this.
- `OLLAMA_URL` — default `http://127.0.0.1:11434`.

### auth.js

Single shared bearer token. Tailscale already gates *network* access; the token
is a second factor so a compromised tailnet device can’t walk in.

- HTTP: `Authorization: Bearer <token>` → middleware on `/api/*`.
- WS: token passed as `?token=` query param on the upgrade request; reject the
  upgrade if it fails.
- The PWA stores the token in `localStorage` after a one-time entry screen.

### terminal.js — PTY session manager

This is the part that must be more reliable than Lunel. Sessions are
**server-owned and persistent**.

- A `Session` = `{ id, pty, scrollback, clients:Set, lastActive }`.
- `pty` spawned via `node-pty` (`bash`, `cwd: ROOT_DIR`, inherit env, `TERM=xterm-256color`).
- **Scrollback ring buffer:** keep the last ~256 KB of PTY output in memory per
  session.
- On WS connect:
  - `?session=<id>` present and alive → **reattach**: add client to the set,
    immediately send the full scrollback buffer so the terminal looks
    unbroken, then stream live.
  - no session / dead id → create a new one, return its `id` to the client.
- One PTY can have multiple attached clients (phone + desktop mirror); broadcast
  output to all.
- Client → server messages: `{type:'input', data}`, `{type:'resize', cols, rows}`.
- **Heartbeat:** server pings every 20 s; a client missing 2 pongs is dropped
  (but the PTY stays alive).
- PTY is killed only when it exits on its own or via an explicit
  `{type:'kill'}`. A dropped phone never kills the shell.
- `GET /api/term/sessions` lists live sessions so the UI can offer “reattach”.

### files.js — filesystem REST

All paths resolved against `ROOT_DIR`; reject anything that escapes it after
`path.resolve` (no `..` traversal).

- `GET  /api/files/list?path=` → `[{name, type, size, mtime}]`, dirs first.
- `GET  /api/files/read?path=` → raw file (text or binary; set content-type).
- `PUT  /api/files/write` `{path, content}` → write, atomic (temp + rename).
- `POST /api/files/mkdir` `{path}`
- `POST /api/files/rename` `{from, to}`
- `DELETE /api/files?path=` → file or recursive dir delete.
- `POST /api/files/upload` (multipart) and `GET /api/files/download?path=`.
- Cap inline read/write at ~5 MB; larger files go through download/upload only.

### ai.js — Ollama proxy

- `GET  /api/ai/models` → proxy `GET {OLLAMA_URL}/api/tags`, return model names.
- `POST /api/ai/chat` `{model, messages}` → proxy to `{OLLAMA_URL}/api/chat`
  with `stream:true`; pipe the NDJSON stream straight back to the client so
  tokens render live.
- Optional: a system prompt that tells the model it’s running on the `kay2` Pi
  and can suggest shell commands; a “run this” button in the UI pastes a
  suggested command into the terminal tab (never auto-executes).

-----

## Client (PWA)

Dark, terminal aesthetic — house style: background `#030609`, accent cyan
`#00e5ff`, `Rajdhani`/`Exo 2` for UI chrome, a mono font for terminal/editor.
Bottom tab bar (thumb-reachable): **Terminal · Files · AI**.

### Auth bootstrap

First load → token entry screen. Store in `localStorage`. Every fetch and the
WS URL carry it. A 401 anywhere → bounce back to the token screen.

### Terminal tab (term.js)

- `@xterm/xterm` + `fit` addon + `web-links` addon.
- On open, connect `wss://…/ws/term?token=…&session=<saved id>`; persist the
  returned `id` in `localStorage` so relaunching the PWA reattaches the same
  shell.
- **Auto-reconnect:** on WS close, reconnect with exponential backoff
  (0.5s → 8s cap). Show a small “reconnecting…” pill, not a broken screen.
- **Mobile key bar** — a row above the keyboard for keys iOS lacks:
  `Esc  Tab  Ctrl  Alt  ↑ ↓ ← →  ⌫  ｜  ~  /  -`. `Ctrl` is sticky: tap then a
  letter sends the control code. This is essential — Lunel’s mobile terminal is
  painful largely because of missing keys.
- Refit + send `resize` on orientation change and keyboard show/hide.
- Pinch-to-zoom adjusts font size.

### Files tab (files.js)

- Breadcrumb + list view, dirs first, file-type icons, size/mtime.
- Tap file → CodeMirror 6 editor with syntax highlighting; Save button →
  `PUT /write`. Dirty indicator; warn on navigate-away with unsaved changes.
- Long-press / context menu: rename, delete, download.
- Upload button (multipart). New file / new folder actions.
- “Open in terminal” on a folder → switches to Terminal tab and `cd`s there.

### AI tab (ai.js)

- Model picker populated from `/api/ai/models`.
- Streaming chat bubbles, markdown rendering, code blocks with copy button.
- Code blocks that look like shell get a “send to terminal” action.
- Conversation kept in memory + `localStorage`; “new chat” clears it.

### PWA shell

- `manifest.webmanifest`: name `KAY2Tunnel`, `display: standalone`, dark theme
  colours, 192 + 512 icons.
- `sw.js`: cache the **app shell only** (html/css/js/vendor/icons). Never cache
  `/api/*` or WS. Cache-first for the shell, network-only for everything else.
  Bump a `CACHE_VERSION` const on every change.
- HTTPS (required for service workers) comes from `tailscale serve` — see Deploy.

-----

## Deploy

On the Pi:

```bash
git clone https://github.com/kay2stack/KAY2Tunnel ~/KAY2Tunnel
cd ~/KAY2Tunnel
npm install                      # node-pty needs build-essential + python3
cp .env.example .env             # set AUTH_TOKEN to a long random string
pm2 start ecosystem.config.js
pm2 save

# expose over the tailnet with HTTPS (MagicDNS cert, tailnet-only):
tailscale serve --bg 7420
```

Then on the iPhone: open `https://kay2.<tailnet>.ts.net` in Safari, enter the
token once, **Share → Add to Home Screen**. It now launches like a native app.

`ecosystem.config.js`: app name `kay2tunnel`, `server/index.js`,
`autorestart: true`, `max_restarts`, log files under `~/.pm2/logs`.

-----

## Security model

1. Server binds `127.0.0.1` only — never directly on a LAN/public interface.
1. `tailscale serve` is the sole ingress → only tailnet devices can reach it.
1. Bearer token is a second factor on top of Tailscale identity.
1. Filesystem API is jailed to `ROOT_DIR`; path traversal rejected.
1. AI suggestions are never auto-run — the user taps to send to the terminal.
1. No telemetry, no third-party relay, nothing leaves the Pi.

-----

## Build order

1. **Skeleton** — Express server, static serving, `.env`/config, auth
   middleware, token entry screen. Verify reachable over Tailscale.
1. **Terminal** — `node-pty` + WS, scrollback buffer, persistent/reattachable
   sessions, xterm client, mobile key bar, auto-reconnect. *This is the
   priority — it’s the thing Lunel gets wrong.*
1. **Files** — REST API + tree UI + CodeMirror editor + upload/download.
1. **AI** — Ollama proxy + streaming chat panel + send-to-terminal.
1. **PWA polish** — manifest, service worker, icons, offline app shell,
   orientation/keyboard resize handling.

Ship phase 2 working solidly before moving on. A reliable terminal alone
already beats Lunel for the main use case.

## Stretch (later, not v1)

- Split-screen: terminal + editor side by side on landscape/iPad.
- System stats strip (CPU, RAM, disk, temp) — read from `/proc`, `vcgencmd`.
- Quick PM2 panel: list processes, restart/stop, tail logs.
- Per-session named shells (“clive”, “deploy”, “scratch”).
- Biometric (WebAuthn) unlock instead of typing the token.
