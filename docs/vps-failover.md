# VPS failover — keep coding when kay2 Pi is down

When the Pi reboots, loses power, or Tailscale flaps, you lose Claude Code, Codex, and OpenClaw. A **VPS on the same Tailscale tailnet** runs the same Stan CLI stack as a hot standby. Your phone auto-fails over.

```
iPhone (Stan CLI PWA)
      │  tries primary, then fallback
      ├──────────────────► https://kay2.<tailnet>.ts.net     (Pi — primary)
      └──────────────────► https://stan-vps.<tailnet>.ts.net  (VPS — fallback)
```

Both run identical Stan CLI. Same `AUTH_TOKEN`. Projects synced from Pi → VPS when Pi is healthy.

---

## What runs where

| Capability | Pi (primary) | VPS (fallback) |
|------------|--------------|----------------|
| Claude Code / Codex | ✓ | ✓ |
| OpenClaw / Clive | optional | ✓ (recommended) |
| Local Ollama / Stan | ✓ | — |
| Home filesystem / SD | ✓ | synced copy only |
| Always on | ✗ (power/reboot) | ✓ |

---

## Setup with Cursor on the Pi

When kay2 is up, open **Cursor** (SSH or local) and run this workflow. Cursor can execute each step via the terminal.

### Phase 1 — Provision VPS (15 min)

1. Create a VPS (Hetzner CX22, DigitalOcean, etc.) — **Ubuntu 22.04**, 2GB+ RAM.
2. Add the VPS to your **Tailscale tailnet** (install script or auth key).
3. From the Pi, SSH to the VPS:

```bash
ssh root@stan-vps   # or Tailscale IP 100.x.x.x
```

4. Bootstrap Stan CLI on the VPS:

```bash
# on VPS as root
export TAILSCALE_AUTHKEY="tskey-auth-..."   # optional, from Tailscale admin
export VPS_HOSTNAME="stan-vps"
curl -fsSL https://raw.githubusercontent.com/kay2stack/KAY2Tunnel/cursor/vps-failover-9640/scripts/vps-setup.sh | bash
```

Or from a cloned repo on the VPS:

```bash
sudo bash ~/KAY2Tunnel/scripts/vps-setup.sh
```

5. **Copy the same `AUTH_TOKEN`** from Pi `.env` to VPS `.env` so one token works on both hosts.

### Phase 2 — Install agents on VPS

SSH to VPS as your user:

```bash
npm install -g @anthropic-ai/claude-code @openai/codex
claude login
codex login
# OpenClaw / Clive — follow your OpenClaw install, ensure `openclaw` on PATH
```

### Phase 3 — Sync projects (from Pi)

On the Pi when healthy:

```bash
cd ~/KAY2Tunnel
# add to .env:  VPS_SYNC_TARGET=kay2@stan-vps
./scripts/pi-push-to-vps.sh kay2@stan-vps
```

Optional cron on Pi (sync every hour):

```cron
0 * * * * cd ~/KAY2Tunnel && ./scripts/pi-push-to-vps.sh kay2@stan-vps >> ~/pi-diagnostics/vps-sync.log 2>&1
```

### Phase 4 — iPhone failover

1. Open Stan CLI on `https://kay2.<tailnet>.ts.net`
2. **Settings → Failover host** → enter `https://stan-vps.<tailnet>.ts.net`
3. Same auth token as Pi

When the Pi is unreachable, the app probes the fallback and redirects automatically.

---

## Cursor agent prompt (paste when Pi is online)

```
Goal: Set up VPS failover for Stan CLI so Claude Code, Codex, and OpenClaw work when the Pi is down.

Context:
- Pi hostname: kay2 (Tailscale MagicDNS)
- VPS: stan-vps on same tailnet
- Repo: ~/KAY2Tunnel

Tasks:
1. Verify Pi Stan CLI: pm2 status, tailscale serve status
2. SSH to stan-vps and run scripts/vps-setup.sh (or guide me to create the VPS)
3. Copy AUTH_TOKEN from Pi .env to VPS .env — must match
4. Install claude + codex on VPS, verify which openclaw
5. Run scripts/pi-push-to-vps.sh to sync ~/projects
6. Document both Tailscale URLs for iPhone Settings → Failover host
7. Test: stop pm2 on Pi, confirm phone fails over to VPS and Agents tab works
```

---

## API: host identity

`GET /api/host` returns role so the UI shows **Pi** vs **VPS (fallback)**:

```json
{
  "role": "vps",
  "name": "stan-vps",
  "isFallback": true,
  "capabilities": { "agents": true, "ollama": false, "openclaw": true }
}
```

Set on each machine in `.env`:

```bash
# Pi
HOST_ROLE=pi
HOST_NAME=kay2

# VPS
HOST_ROLE=vps
HOST_NAME=stan-vps
OPENCLAW_ENABLED=1
ROOT_DIR=/home/kay2/projects
```

---

## Testing failover

```bash
# On Pi — simulate outage
pm2 stop stan-cli

# On iPhone — reopen PWA, should redirect to VPS within ~5s

# Restore Pi
pm2 start stan-cli
```

---

## Cost & sizing

| Provider | Spec | ~cost |
|----------|------|-------|
| Hetzner CX22 | 2 vCPU, 4GB | ~€4/mo |
| DigitalOcean | 2GB droplet | ~$12/mo |

Agents need RAM — **2GB minimum**, 4GB comfortable for Claude Code + OpenClaw.

---

## Related

- [pi-recovery.md](./pi-recovery.md) — fix Pi reboots first, then VPS is your safety net
- `scripts/vps-setup.sh` — VPS bootstrap
- `scripts/pi-push-to-vps.sh` — project sync
