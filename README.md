# Stan CLI 🐈‍⬛

> Your tiny terminal companion.
>
> Mobile‑first AI developer workstation inspired by Lunel CLI.

![Stan CLI Hero](docs/assets/stan-hero-placeholder.png)

Stan CLI brings **Claude Code, Codex, terminals, projects, tunnels, and AI sessions** into a premium mobile‑first developer workflow.

Built around:

- Claude Code CLI
- Codex CLI
- Gemini CLI
- OpenClaw / Clive (planned)
- KAY2Tunnel infrastructure
- Mobile‑first remote developer workflows

---

## Features

✅ Real terminal access

✅ Multi‑agent workspace

✅ Claude Code + Codex session control

✅ Mobile approvals + live sessions

✅ Project management

✅ Tunnel management

✅ Remote developer workflows

✅ Stan orchestration layer

---

## Install

```bash
git clone https://github.com/kay2stack/KAY2Tunnel.git
cd KAY2Tunnel
npm install
```

---

## Quick Start

Launch development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

---

## Common Commands

### Start Dev Server

```bash
npm run dev
```

### Reinstall Dependencies

Useful after server reboot, clean environment, or package problems.

```bash
rm -rf node_modules package-lock.json
npm install
```

### Restart Local Environment

```bash
pkill node
npm run dev
```

### Git Pull Latest

```bash
git pull origin main
npm install
npm run dev
```

### Production Restart Workflow

Useful after Pi reboot / VPS restart.

```bash
cd ~/KAY2Tunnel
npm install
npm run build
npm run dev
```

### Check Running Processes

```bash
ps aux | grep node
```

### Kill Process by Port

Example: port 3000.

```bash
lsof -ti:3000 | xargs kill -9
```

---

## Mobile Workflow

Stan CLI is designed around:

- iPhone
- PWA usage
- remote coding workflows
- AI coding sessions away from desktop
- Raspberry Pi / remote development
- multi‑agent operations

---

## Screens

### Login

Clean onboarding.

Auth token.

GitHub / Google login.

### Dashboard

Monitor:

- tunnels
- Claude Code sessions
- gateway status
- recent activity

### Terminal

Run:

```bash
$ stan tunnel 3000
$ claude
$ codex
```

### Agents

Control:

- Claude Code
- Codex CLI
- Gemini CLI
- OpenClaw

### Sessions

Live coding session monitoring.

Diff approvals.

Task status.

### Projects

Manage repositories.

Launch agents.

Review workflows.

---

## Example Session

```bash
Claude Code
Repository: KAY2Tunnel

Reading files...
Editing components...
Running tests...
✓ Completed
```

---

## Roadmap

- [ ] Stan mascot system
- [ ] Multi‑agent routing
- [ ] Claude Code integration
- [ ] Codex integration
- [ ] Tunnel orchestration
- [ ] Mobile diff approvals
- [ ] Pi remote workflows
- [ ] OpenClaw / Clive bridge
- [ ] Notifications
- [ ] Voice workflows

---

## Docs

See:

- docs/stan-mascot-brand-brief.md
- docs/stan-mobile-ai-architecture-brief.md

---

## Pi offline? VPN & reboot recovery

If **kay2 is unreachable over Tailscale** or keeps rebooting:

```bash
cd ~/KAY2Tunnel
npm run pi:recovery          # terminal health dashboard
npm run pi:recovery isolate  # full isolation workflow
```

When the Pi is reachable on the tailnet or LAN, open Stan CLI → **Health** for live metrics, reboot history, and one-tap VPN isolation.

Full walkthrough: [docs/pi-recovery.md](docs/pi-recovery.md)

---

## VPS fallback (Pi down → keep coding)

Run Claude Code, Codex, and OpenClaw on a **VPS** when kay2 is offline. Same Stan CLI, same token, auto-failover on iPhone.

```bash
# On VPS (once):
sudo bash scripts/vps-setup.sh

# On Pi (sync repos when healthy):
./scripts/pi-push-to-vps.sh kay2@stan-vps
```

iPhone: **Settings → Fallback host** → `https://stan-vps.<tailnet>.ts.net`

Guide: [docs/vps-failover.md](docs/vps-failover.md) — includes Cursor agent prompt for setup from the Pi.

---

## GPU burst (vast.ai)

Spin up a cloud GPU from your phone when you need fast local Ollama or OpenClaw:

```bash
# .env: VAST_API_KEY=... and TAILSCALE_AUTHKEY=...
npm run gpu:up      # launch cheapest 16GB+ GPU
npm run gpu:down    # destroy — stop billing
```

iPhone: **Home → GPU**. Full guide: [docs/vast-gpu.md](docs/vast-gpu.md)

---

## Philosophy

Stan CLI is not a generic AI chat app.

Stan is a **mobile‑first AI engineering workstation**.

Real terminals.

Real workflows.

Real coding sessions.

Minimal friction.
