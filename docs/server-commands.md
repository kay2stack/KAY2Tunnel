# Server commands — kay2 Pi

Operational runbook for **Stan CLI / KAY2Tunnel** on the `kay2` Raspberry Pi: process management, ingress, and **Cloudflare Tunnel recovery after reboot**.

> **Repo note:** This repository does **not** ship `cloudflared` config, systemd units, or tunnel tokens. Ingress for the app itself is documented in `CLAUDE.md` as **Tailscale Serve → `127.0.0.1:7420`**. Public `*.kay2tunnel.dev` URLs are configured **on the Pi** (Cloudflare Zero Trust / `cloudflared`), outside this repo.

---

## Quick reference

| Service | Default bind | How it is exposed |
|---------|--------------|-------------------|
| Stan CLI (`stan-cli`) | `127.0.0.1:7420` | PM2; use Tailscale Serve and/or Cloudflare Tunnel on the Pi |
| Ollama (optional) | `127.0.0.1:11434` | Not proxied by this app unless you add a tunnel rule |

---

## After Pi reboot — full recovery order

Run on the Pi as user `kay2` (or via SSH):

```bash
# 1) App process
cd ~/KAY2Tunnel
pm2 resurrect || pm2 start ecosystem.config.js
pm2 save
pm2 status

# 2) Verify app is listening locally
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7420/

# 3) Tailscale ingress (tailnet-only, stable URL)
sudo tailscale serve --bg 7420
tailscale serve status

# 4) Cloudflare ingress (public *.kay2tunnel.dev or trycloudflare — see below)
sudo systemctl restart cloudflared   # if using systemd named tunnel
# OR re-run quick tunnel / tmux session (if using TryCloudflare)
```

Expected local check: HTTP `200` or `401` (auth required) from `http://127.0.0.1:7420/`.

---

## Stan CLI (PM2)

```bash
cd ~/KAY2Tunnel
pm2 status
pm2 logs stan-cli --lines 50
pm2 restart stan-cli
pm2 save
```

Logs: `~/.pm2/logs/stan-cli-*.log`

Environment: `~/KAY2Tunnel/.env` (`PORT`, `AUTH_TOKEN`, `ROOT_DIR`, `OLLAMA_URL`).

---

## Tailscale Serve (stable tailnet URL)

Documented primary ingress in `CLAUDE.md`. URL does **not** change on reboot if MagicDNS and serve config persist.

```bash
sudo tailscale serve --bg 7420
tailscale serve status
```

Typical URL: `https://kay2.<tailnet>.ts.net` (example in repo assets: `kay2.tail69c58c.ts.net`).

---

## Cloudflare Tunnel

### Why the old URL broke

| Tunnel type | URL after reboot | Typical failure |
|-------------|------------------|-----------------|
| **TryCloudflare** (`cloudflared tunnel --url` / quick tunnel) | **New random URL every run** | Process not in systemd/tmux; old `*.trycloudflare.com` link is dead |
| **Named tunnel** (`*.kay2tunnel.dev` in Zero Trust) | **Same hostname** if tunnel ID + DNS unchanged | `cloudflared` service failed to start; connector offline |
| **Ephemeral tmux/manual** | Same as TryCloudflare if not restarted | Session lost on reboot |

Docs/branding reference a stable hostname pattern, e.g. `quiet-fluffy-stan.kay2tunnel.dev` — that implies a **named tunnel** on the `kay2tunnel.dev` zone, not a one-off `trycloudflare.com` URL.

### Diagnostics (run on Pi)

```bash
systemctl status cloudflared
systemctl --failed
ps aux | grep cloudflared
tmux ls
journalctl -u cloudflared -n 100 --no-pager
```

Optional repo helper (copy to Pi or run from repo checkout):

```bash
~/KAY2Tunnel/scripts/recover-cloudflare-tunnel.sh
```

### Restart — systemd named tunnel (stable URL)

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
journalctl -u cloudflared -n 30 --no-pager
```

Config locations to inspect:

```bash
ls -la ~/.cloudflared/
cat ~/.cloudflared/config.yml
sudo cat /etc/cloudflared/config.yml
```

List tunnels (if CLI authenticated):

```bash
cloudflared tunnel list
cloudflared tunnel info <TUNNEL_NAME>
```

Public URL: the hostname in Zero Trust **Public Hostname** for this tunnel (e.g. `https://<subdomain>.kay2tunnel.dev`). It should match DNS in the Cloudflare dashboard for zone `kay2tunnel.dev`.

### Restart — TryCloudflare (new URL each time)

If you use a **quick tunnel** (no token / random subdomain):

```bash
# Stop any stale process
pkill -f 'cloudflared tunnel' || true

# Forward to Stan CLI
cloudflared tunnel --url http://127.0.0.1:7420
```

The process prints a line like:

```text
https://<random-words>.trycloudflare.com
```

**That is the new live URL.** Update bookmarks, PWA, and any shared links.

To keep it running across disconnects (not reboot-safe unless you automate):

```bash
tmux new-session -d -s cloudflare \
  'cloudflared tunnel --url http://127.0.0.1:7420 2>&1 | tee -a ~/cloudflared-quick.log'
tmux capture-pane -pt cloudflare:0 -S -30 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
```

### Recover URL from logs

```bash
# systemd
journalctl -u cloudflared -n 200 --no-pager | grep -oE 'https://[^ ]+' | tail -5

# quick tunnel log
grep -oE 'https://[a-z0-9-]+\.(trycloudflare\.com|kay2tunnel\.dev)' ~/cloudflared-quick.log | tail -1
```

---

## Verify tunnel end-to-end

On the **Pi**:

```bash
curl -s -o /dev/null -w "local:%{http_code}\n" http://127.0.0.1:7420/
```

From **phone/laptop** (replace with your current public URL):

```bash
curl -sI https://<your-tunnel-host>/
```

Success: HTTP response from Stan CLI (often `401` without `Authorization: Bearer` token — that still proves the tunnel works).

With token:

```bash
curl -s -H "Authorization: Bearer $AUTH_TOKEN" https://<your-tunnel-host>/api/term/sessions
```

---

## Cloud Agent / remote limitation

The Cursor Cloud Agent environment **cannot** SSH to `kay2` or run `systemctl` on the Pi. Tunnel recovery and capturing the **new** TryCloudflare URL must be executed **on the Pi** (or via Tailscale SSH from a device on the tailnet).

After running recovery on the Pi, record the live URL in your password manager or team notes — this repo intentionally does not store production tunnel URLs.

---

## Related docs

- `CLAUDE.md` — architecture, Tailscale Serve, port `7420`
- `README.md` — install and PM2 workflow
- `scripts/recover-cloudflare-tunnel.sh` — automated diagnostics + restart hints
