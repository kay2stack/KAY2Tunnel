# Scaleway bootstrap (KeyStudios / stan-vps)

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
