# kay2 Pi recovery — VPN removal & reboot diagnosis

Use this when **kay2 is offline** over Tailscale and you have **local access** (keyboard/monitor, HDMI, or LAN SSH).

Goal: get the Pi stable on plain local/LAN networking first, find what is causing reboots, then re-enable Tailscale only after it is healthy.

---

## Before you start

You need one of:

| Access | How |
|--------|-----|
| **Keyboard + monitor** | Plug in directly |
| **LAN SSH** | `ssh kay2@<pi-lan-ip>` (check router DHCP leases if you do not know the IP) |
| **SD card on another machine** | Mount `/boot` and `/` to edit config or run chroot (last resort) |

Clone or update this repo on the Pi:

```bash
cd ~
git clone https://github.com/kay2stack/KAY2Tunnel.git 2>/dev/null || (cd ~/KAY2Tunnel && git pull)
cd ~/KAY2Tunnel
chmod +x scripts/*.sh
```

---

## Quick path (copy-paste)

Run these in order on the Pi:

```bash
cd ~/KAY2Tunnel
./scripts/pi-diagnose-reboots.sh          # capture evidence (safe, read-only)
./scripts/pi-remove-tailscale.sh          # stop Tailscale + clear serve proxy
sudo reboot
# after reboot:
./scripts/pi-diagnose-reboots.sh --post-reboot
ping -c 3 8.8.8.8                        # confirm plain internet works
pm2 status                               # confirm stan-cli / kay2tunnel is up
```

If the Pi still reboots with Tailscale off, the VPN was probably not the cause — focus on the diagnostic output (power, thermal, OOM, kernel panics).

---

## Step 1 — Capture reboot evidence (do this first)

Every reboot overwrites useful logs. Run diagnostics **before** changing anything:

```bash
cd ~/KAY2Tunnel
./scripts/pi-diagnose-reboots.sh
```

This writes a timestamped report under `~/pi-diagnostics/`. Copy it somewhere safe:

```bash
# from your laptop, once LAN works:
scp kay2@<pi-ip>:~/pi-diagnostics/*.txt .
```

### What to look for in the report

| Signal | Likely cause |
|--------|----------------|
| `throttled` flags in `vcgencmd get_throttled` | Undervoltage or overheating — check PSU (official 5V/3A+), cable, case airflow |
| `Out of memory: Kill process` in journal | OOM — Ollama or another service eating RAM; reduce models or add swap |
| `watchdog` or `hard LOCKUP` | Kernel hang; check SD card health, `dmesg` I/O errors |
| `reboot: Restarting system` with no preceding error | Manual reboot, `cron`, unattended-upgrades, or power loss |
| `Shutdown` / `Power key` | Deliberate shutdown or flaky power button wiring |
| Frequent `tailscaled` crashes before reboot | Tailscale bug or network loop — removing VPN isolates this |

---

## Step 2 — Remove / disable Tailscale

KAY2Tunnel is exposed via `tailscale serve`. Tailscale is the VPN layer — not required for the app itself (it listens on `127.0.0.1:7420`).

### Automated (recommended)

```bash
cd ~/KAY2Tunnel
./scripts/pi-remove-tailscale.sh
```

This script:

1. Saves current Tailscale status to `~/pi-diagnostics/`
2. Clears `tailscale serve` (HTTPS proxy on port 7420)
3. Stops and disables the `tailscaled` service
4. Leaves packages installed so you can re-enable quickly later

### Manual equivalent

```bash
# save state
mkdir -p ~/pi-diagnostics
tailscale status > ~/pi-diagnostics/tailscale-status-before.txt 2>&1
tailscale serve status >> ~/pi-diagnostics/tailscale-status-before.txt 2>&1

# remove HTTPS proxy (does not uninstall Tailscale)
sudo tailscale serve reset

# stop VPN daemon
sudo systemctl stop tailscaled
sudo systemctl disable tailscaled

# verify — should show "inactive"
systemctl is-active tailscaled
```

### Full uninstall (only if you want Tailscale gone completely)

```bash
sudo tailscale serve reset
sudo tailscale logout
sudo systemctl stop tailscaled
sudo systemctl disable tailscaled
sudo apt remove --purge tailscale -y
sudo apt autoremove -y
```

---

## Step 3 — Verify plain networking

After Tailscale is off:

```bash
# link up?
ip -br addr

# default route?
ip route | head -5

# DNS + internet?
ping -c 3 192.168.1.1    # your router — adjust IP
ping -c 3 8.8.8.8
ping -c 3 github.com

# SSH still reachable on LAN?
hostname -I
```

If networking is broken without Tailscale, check:

```bash
# NetworkManager (Bookworm desktop)
nmcli dev status

# dhcpcd / static config (Lite)
cat /etc/dhcpcd.conf
cat /etc/network/interfaces 2>/dev/null

# recent network errors
journalctl -u NetworkManager --since "1 hour ago" --no-pager
journalctl -u dhcpcd --since "1 hour ago" --no-pager
```

**Do not proceed to re-enable Tailscale until LAN + internet work on their own.**

---

## Step 4 — Confirm KAY2Tunnel / stan-cli still runs

The app does not depend on Tailscale — only on PM2 + Node:

```bash
cd ~/KAY2Tunnel
pm2 status
pm2 logs stan-cli --lines 30

# if down:
npm install
pm2 start ecosystem.config.js
pm2 save
```

Reach it locally (no VPN):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:7420/
```

From another device on the same LAN (temporary debug only — do not leave this open):

```bash
# on the Pi — bind check (should be 127.0.0.1 only)
ss -tlnp | grep 7420
```

---

## Step 5 — Reboot loop test

With Tailscale **disabled**, watch one full boot cycle:

```bash
# note uptime
uptime

# optional: log boot milestones to a file you can read after a crash
echo "$(date) pre-reboot test" >> ~/pi-diagnostics/reboot-test.log
sudo reboot
```

After it comes back:

```bash
cd ~/KAY2Tunnel
./scripts/pi-diagnose-reboots.sh --post-reboot
cat ~/pi-diagnostics/reboot-test.log
uptime
```

| Result | Next step |
|--------|-----------|
| Stable for 30+ min, no surprise reboots | Tailscale was likely involved — re-enable carefully (Step 6) |
| Still rebooting | Hardware/power/SD/OOM — see Step 7 |
| Hangs but does not reboot | SD card or filesystem — run `sudo fsck -f /dev/mmcblk0p2` from recovery |

---

## Step 6 — Re-enable Tailscale (after stable)

Only when plain networking is stable **and** reboots have stopped:

```bash
sudo systemctl enable tailscaled
sudo systemctl start tailscaled
sudo tailscale up

# confirm
tailscale status
tailscale ip -4

# re-expose KAY2Tunnel (HTTPS on tailnet only)
sudo tailscale serve --bg 7420
tailscale serve status
```

From your phone (on Tailscale): open `https://kay2.<tailnet>.ts.net`

If reboots return immediately after `tailscale up`, capture logs and keep Tailscale off until you inspect `journalctl -u tailscaled`.

---

## Step 7 — Common reboot causes on Raspberry Pi

### Power (most common)

```bash
vcgencmd get_throttled
# 0x0 = OK
# 0x50000 or 0x50005 = undervoltage seen since boot
```

Fix: official PSU (5V 3A+ for Pi 4/5), short thick USB-C cable, no underpowered hub.

### Thermal

```bash
vcgencmd measure_temp
# sustained > 80°C on Pi 4 → throttling
```

Fix: heatsink/fan, move out of enclosed case.

### OOM (Ollama + agents)

```bash
free -h
grep -i "out of memory" /var/log/syslog 2>/dev/null | tail -5
journalctl -k | grep -i "oom\|killed process" | tail -10
```

Fix: stop heavy models, add swap, or reduce concurrent agents:

```bash
pm2 stop all
sudo systemctl stop ollama   # if installed as a service
```

### SD card failure

```bash
dmesg | grep -iE "mmc|I/O error|ext4" | tail -20
sudo smartctl -a /dev/mmcblk0 2>/dev/null || echo "smartctl not installed"
```

Fix: backup, replace SD, fresh flash.

### Watchdog / cron / unattended upgrades

```bash
systemctl is-active watchdog
crontab -l
sudo crontab -l
grep -r reboot /etc/cron* 2>/dev/null
cat /var/log/unattended-upgrades/unattended-upgrades.log 2>/dev/null | tail -20
```

### Kernel panics

```bash
journalctl -k -b -1 --no-pager | tail -80   # previous boot kernel log
last reboot | head -10
```

---

## Step 8 — No local access at all (SD card rescue)

1. Power off Pi, remove SD card.
2. Mount on another Linux machine.
3. Edit boot config if needed: `fsck.repair=yes` in cmdline.txt for filesystem repair.
4. On the root partition, disable Tailscale:

   ```bash
   # chroot into mounted root
   sudo mount /dev/sdX2 /mnt
   sudo mount /dev/sdX1 /mnt/boot
   sudo chroot /mnt systemctl disable tailscaled
   ```

5. Boot Pi, SSH over LAN, run diagnostics from Step 1.

---

## Checklist summary

- [ ] Run `pi-diagnose-reboots.sh` and save report off-device
- [ ] Run `pi-remove-tailscale.sh` (or manual stop/disable)
- [ ] Reboot once, confirm LAN + internet without VPN
- [ ] Confirm `pm2 status` shows stan-cli running
- [ ] Soak test 30+ minutes — no unexpected reboots
- [ ] Re-enable Tailscale + `tailscale serve --bg 7420`
- [ ] Test PWA from phone over tailnet

---

## Related files

| File | Purpose |
|------|---------|
| `scripts/pi-diagnose-reboots.sh` | Read-only reboot / power / OOM / Tailscale report |
| `scripts/pi-remove-tailscale.sh` | Stop Tailscale and clear serve proxy |
| `CLAUDE.md` | Normal deploy path (assumes Tailscale healthy) |
