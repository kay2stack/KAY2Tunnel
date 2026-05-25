# Stan CLI

**Self-hosted remote control panel for your Raspberry Pi.**  
Terminal · File browser · AI — accessed from your iPhone as a PWA, over Tailscale. No relay, no cloud, no session codes.

---

## Why not Lunel?

Lunel routes phone ↔ machine traffic through a public relay with 10-minute session TTLs. That relay is why the terminal drops.

Stan CLI deletes that layer entirely. The Pi is already on Tailscale — the tunnel already exists. The phone connects **directly** to the Pi.

|                 | Lunel                            | Stan CLI                          |
|-----------------|----------------------------------|-----------------------------------|
| Transport       | Public relay + session code      | Direct over Tailscale             |
| Session TTL     | 10 minutes                       | Lives as long as the server       |
| Reconnect       | New session                      | Reattaches to the **same** shell  |
| Client          | Native app (App Store)           | PWA — Add to Home Screen          |
| PTY             | Custom Rust + 24fps render loop  | `node-pty` + `xterm.js`           |
| Deploy          | Relay account required           | `npm install` + `pm2 start`       |

---

## Stack

- **Server** — Node.js 20+, Express, `ws`, `node-pty`
- **Client** — Vanilla JS PWA, `@xterm/xterm`, no framework, no build step
- **Process manager** — PM2
- **Tunnel** — Tailscale serve (production) / Cloudflare quick tunnel (dev)
- **AI** — Ollama proxy (Gemma, Llama, etc. — whatever's running locally)

---

## Quick start

```bash
git clone https://github.com/kay2stack/KAY2Tunnel ~/KAY2Tunnel
cd ~/KAY2Tunnel
npm install
cp .env.example .env
nano .env           # set AUTH_TOKEN

pm2 start ecosystem.config.js
pm2 save
```

Open `https://kay2.<tailnet>.ts.net` in Safari → Share → Add to Home Screen.

---

## Install

### Prerequisites

```bash
# Node 20+
node -v

# PM2
npm install -g pm2

# node-pty native build deps (Raspberry Pi / Debian)
sudo apt install -y build-essential python3
```

### Environment

```bash
cp .env.example .env
```

```env
PORT=7420
AUTH_TOKEN=<run: openssl rand -hex 32>
ROOT_DIR=/home/kay2
OLLAMA_URL=http://127.0.0.1:11434
```

`AUTH_TOKEN` is required — the server refuses to start without it.

---

## Running

```bash
pm2 start ecosystem.config.js   # start
pm2 stop stan-cli                # stop
pm2 restart stan-cli             # restart
pm2 logs stan-cli                # live logs
pm2 status                       # all processes
```

---

## Auto-start on boot

Run once after initial setup. After this, Stan CLI and the Cloudflare tunnel survive every reboot automatically.

```bash
# 1. Generate the systemd startup hook
pm2 startup

# 2. Run the command it prints — will look like:
sudo env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u kay2 --hp /home/kay2

# 3. Freeze the current process list
pm2 save
```

Verify after a reboot:

```bash
pm2 status
```

---

## Expose over Tailscale (production)

```bash
tailscale serve --bg 7420
```

Serves HTTPS via MagicDNS — reachable only from your tailnet.

---

## Expose via Cloudflare quick tunnel (no Tailscale)

```bash
pm2 start ecosystem.config.js --only stan-cli-tunnel
pm2 logs stan-cli-tunnel --lines 20 | grep trycloudflare
```

The URL changes on every restart. For a fixed domain, set up a [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps).

---

## If the Pi reboots

If `pm2 startup` + `pm2 save` was run, everything comes back automatically. If something is wrong:

```bash
# Check what's running
pm2 status

# Restart the server
pm2 restart stan-cli

# Start everything fresh from config
pm2 start ecosystem.config.js

# Full reset
pm2 delete all && pm2 start ecosystem.config.js && pm2 save

# Tail logs
pm2 logs stan-cli --lines 50

# Confirm port is bound
ss -tlnp | grep 7420
```

---

## Project structure

```
KAY2Tunnel/
├── .env.example
├── ecosystem.config.js     # PM2 — server + tunnel processes
├── package.json
├── server/
│   ├── index.js            # Express + WebSocket bootstrap
│   ├── config.js           # env loader, ROOT_DIR, auth token
│   ├── auth.js             # bearer token middleware (HTTP + WS)
│   ├── terminal.js         # node-pty session manager + scrollback
│   ├── files.js            # filesystem REST (jailed to ROOT_DIR)
│   ├── agents.js           # AI agent launcher (Claude, Codex, etc.)
│   ├── projects.js         # git repo scanner
│   └── ai.js               # Ollama proxy + streaming
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js              # tab router, auth bootstrap, reconnect
    ├── term.js             # xterm.js + mobile key bar
    ├── projects.js         # file browser (full Pi filesystem)
    ├── agents.js           # agent cards + Ollama chat
    ├── sw.js               # service worker (app-shell cache)
    ├── manifest.webmanifest
    ├── brand/              # design tokens, SVG logo assets
    ├── icons/              # 192 + 512 PWA icons (Stan mascot)
    └── vendor/             # xterm, fit addon, web-links addon
```

---

## Security model

1. Server binds `127.0.0.1` only — never on a LAN or public interface
2. `tailscale serve` is the sole ingress — only tailnet devices can reach it
3. Bearer token is a second factor on top of Tailscale identity
4. Filesystem API is jailed to `ROOT_DIR` — no `..` traversal
5. AI suggestions are never auto-executed — user pastes into terminal manually
6. No telemetry, no relay, nothing leaves the Pi

---

## License

MIT — see [LICENSE](LICENSE)
