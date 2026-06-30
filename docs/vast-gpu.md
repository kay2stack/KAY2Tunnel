# vast.ai GPU burst — Stan CLI integration

On-demand GPU boxes for **local Ollama**, **OpenClaw/Clive**, and heavy inference when the Pi is slow or offline. Controlled from Stan CLI on your phone or via CLI.

This is **not** a replacement for the always-on CPU VPS fallback — vast.ai is **pay-per-hour** and ephemeral.

---

## Full stack

```
iPhone (Stan CLI)
    │
    ├─► kay2.ts.net           Pi primary (Ollama local, files)
    ├─► stan-vps.ts.net       CPU fallback (Claude Code, Codex, 24/7)
    └─► stan-gpu (Tailscale)  GPU burst (Ollama 7B+, OpenClaw) — vast.ai
```

| Need | Use |
|------|-----|
| Pi down, still coding | VPS failover |
| Big local model, fast inference | vast.ai GPU |
| Claude Code / Codex | Pi or VPS (API — no GPU needed) |

---

## Setup (5 minutes)

### 1. Get vast.ai API key

https://cloud.vast.ai/manage-keys/

### 2. Add to `.env` on Pi (or VPS)

```bash
VAST_API_KEY=your-key-here

# Optional filters (defaults shown)
VAST_MAX_DPH=0.55              # max $/hour
VAST_MIN_GPU_RAM_MB=16384      # 16GB VRAM minimum
VAST_MIN_CPU_RAM_MB=16000      # 16GB system RAM
VAST_GPU_LABEL=stan-gpu
VAST_OLLAMA_MODEL=gemma2:9b
VAST_DISK_GB=40

# Auto-join Tailscale on boot (recommended)
TAILSCALE_AUTHKEY=tskey-auth-...
```

Create a **reusable** Tailscale auth key at https://login.tailscale.com/admin/settings/keys

### 3. Register SSH key on vast.ai

https://cloud.vast.ai/account/

Required before `ssh_direct` instances work reliably.

### 4. Restart Stan CLI

```bash
pm2 restart stan-cli
```

---

## Usage

### From iPhone

**Home → GPU** (or Settings → Cloud GPU)

- See active instance + $/hr
- Browse offers
- **Launch best offer** or pick one
- **Destroy GPU** when done (stops billing)

### From terminal (Pi/VPS)

```bash
npm run gpu:status     # instance + config
npm run gpu:offers     # matching GPUs
npm run gpu:up         # launch cheapest
npm run gpu:up 12345   # launch specific offer id
npm run gpu:down       # destroy + stop billing
npm run gpu:watch      # live status
```

### API

| Endpoint | Description |
|----------|-------------|
| `GET /api/gpu/config` | Filters, model, configured? |
| `GET /api/gpu/status` | Active instance |
| `GET /api/gpu/offers` | Search results |
| `POST /api/gpu/launch` | Body: `{"confirm":true,"offerId":optional}` |
| `POST /api/gpu/destroy` | Body: `{"confirm":true}` |

---

## What happens on launch

`scripts/vast-onstart.sh` runs inside the container:

1. Installs **Tailscale** (userspace mode for Docker)
2. Joins tailnet as `stan-gpu` (if `TAILSCALE_AUTHKEY` set)
3. Installs **Ollama** + pulls `VAST_OLLAMA_MODEL`
4. Logs to `/workspace/stan-onstart.log`

Connect after ~2 minutes:

```bash
# Via Tailscale (preferred)
ssh root@stan-gpu

# Or vast.ai direct SSH (from status panel)
ssh root@HOST -p PORT
```

Point Stan CLI AI tab at GPU Ollama (future) or curl locally:

```bash
curl http://127.0.0.1:11434/api/tags
```

---

## Cost control

| Rule | Why |
|------|-----|
| **Always destroy when done** | Billing runs until destroyed |
| Set `VAST_MAX_DPH` | Caps hourly rate |
| Use `gpu:down` / Destroy button | Don't rely on vast.ai auto-stop |
| Prefer VPS for 24/7 agents | GPU only for bursts |

Typical burst: RTX 3090/4090 class @ **$0.20–0.50/hr** ≈ $2–5 for an evening session.

---

## Cursor agent prompt (on Pi)

```
Integrate my vast.ai GPU with Stan CLI.

1. Add VAST_API_KEY + TAILSCALE_AUTHKEY to ~/KAY2Tunnel/.env
2. pm2 restart stan-cli
3. npm run gpu:offers — show me top 5
4. npm run gpu:up — launch cheapest 16GB+ GPU
5. Wait for running, SSH to stan-gpu via Tailscale
6. Verify ollama list and /workspace/stan-onstart.log
7. When done: npm run gpu:down
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `VAST_API_KEY not configured` | Add to `.env`, restart PM2 |
| No offers | Raise `VAST_MAX_DPH` or lower `VAST_MIN_GPU_RAM_MB` |
| Instance stuck loading | Destroy and retry — offer may be stale |
| Tailscale not up on GPU | Check auth key; read `/workspace/tailscale-auth-url.txt` |
| OOM on small GPU | Use smaller model (`gemma2:2b`) or raise VRAM filter |

---

## Related

- [vps-failover.md](./vps-failover.md) — always-on CPU fallback
- [pi-recovery.md](./pi-recovery.md) — fix Pi reboots first
