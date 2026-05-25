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

## Philosophy

Stan CLI is not a generic AI chat app.

Stan is a **mobile‑first AI engineering workstation**.

Real terminals.

Real workflows.

Real coding sessions.

Minimal friction.
