# Scaleway bootstrap (KeyStudios / stan-vps)

## Can't set up from iPhone? **Skip it for now.**

You do **not** need Scaleway to use Stan CLI when the Pi is back. VPS is optional backup.

| Priority | What to do |
|----------|------------|
| **Now (no Pi, no laptop)** | Wait — nothing critical blocked |
| **Pi returns** | Fix Pi → `npm run pi:recovery` → optional VPS in 5 min from Cursor |
| **Need GPU now** | vast.ai from Pi when it's up (`npm run gpu:up`) |

---

## Zero-iPhone-SSH path (when Pi or laptop is back)

Only copy **two things** from Safari on iPhone (no Termius, no SSH keys):

1. **Scaleway Project ID** — KeyStudios → Project settings → UUID  
2. **Tailscale auth key** — https://login.tailscale.com/admin/settings/keys → Generate reusable key  

Add to `~/KAY2Tunnel/.env`:

```bash
SCW_SECRET_KEY=your-new-api-secret
SCW_PROJECT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
TAILSCALE_AUTHKEY=tskey-auth-xxxxxxxx
AUTH_TOKEN=your-stan-token
```

One command (on Pi or laptop):

```bash
cd ~/KAY2Tunnel
./scripts/scaleway-provision-all.sh
```

That creates the VPS, installs Tailscale + Stan CLI, and exposes HTTPS — **you only open Safari on iPhone** after ~5 minutes.

---

## ⚠️ Security first

You posted your API **secret** in chat. After setup:

1. Scaleway → **IAM → API keys** → **Revoke** that key  
2. Create a new key with minimal permissions (Instances + SSH keys)  
3. Never paste secrets in chat again  

Scaleway keys are **two parts**:

| Part | Looks like | Where |
|------|-----------|--------|
| **Access key** | 20 characters, e.g. `SCW8ABCD...` | API keys page |
| **Secret key** | UUID, e.g. `8d63899b-...` | Shown once at creation |

---

## Find your Project ID (required for API)

1. Scaleway console → project **KeyStudios**  
2. **Project settings** (or Settings → Project)  
3. Copy **Project ID** (UUID)

It’s also in the URL:

```
https://console.scaleway.com/project/<PROJECT-ID>/...
```

Add to `.env`:

```bash
SCW_SECRET_KEY=your-new-secret-after-rotate
SCW_PROJECT_ID=your-project-uuid
```

---

## Option A — Paste public key in console (easiest on iPhone)

**Public key** (register this in Scaleway → SSH keys → Add):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFacb4aZv4T6sC67c7ORll5ihlznsL1RxRANHPOIxjh2 stan-vps-termius
```

**Private key** — import into Termius:

1. Termius → **Settings → Security → Keychain** (or **+ New Host → Key → Import**)  
2. Import OpenSSH private key (paste block below)  
3. Name it `stan-vps`

<details>
<summary>Private key for Termius import (tap to expand — keep secret)</summary>

Generate a fresh key on any machine instead if you prefer not to use a shared one:

```bash
ssh-keygen -t ed25519 -f stan-vps -N ""
```

</details>

> A key pair was generated for this setup. Use **Option B** script with `--print-private` on a trusted machine, or generate your own with `ssh-keygen` and paste only the `.pub` into Scaleway.

---

## Option B — API script (Pi or laptop)

```bash
cd ~/KAY2Tunnel
# .env: SCW_SECRET_KEY + SCW_PROJECT_ID
./scripts/scaleway-setup-ssh.sh
./scripts/scaleway-setup-ssh.sh --print-private   # Termius import
```

---

## Create instance (console)

| Setting | Value |
|---------|--------|
| Type | BASIC1-X2C-8G |
| Zone | **PAR 1** |
| Image | Ubuntu 22.04/24.04 |
| SSH key | stan-vps-termius |
| IPv4 | On (for first login) |

---

## Connect from Termius

- **Host:** Scaleway public IPv4  
- **User:** `root`  
- **Key:** imported stan-vps key  

Then:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --hostname=stan-vps
git clone https://github.com/kay2stack/KAY2Tunnel.git && cd KAY2Tunnel
cp .env.example .env   # AUTH_TOKEN + optional VAST_API_KEY
bash scripts/vps-setup.sh   # or manual npm/pm2 steps
tailscale serve --bg 7420
```

iPhone: Stan CLI → Settings → Fallback host → `https://stan-vps.<tailnet>.ts.net`

---

## API permissions

If the script says **insufficient permissions**, edit the API key in Scaleway and enable:

- IAM: SSH keys (write)  
- Instance: read/write (if automating servers later)
