# Phone bring-up playbook

What to do the moment the Nokia G60 5G is plugged back into the Pi, and what we
can run/test once it's live. Phone serial: `AQ7505H029P20300035`.

## 0. Plug in (physical)
- Use a **data** cable (not charge-only), ideally a blue **USB-3** port on the Pi.
- Unlock the phone; tap **Allow** on the "Allow USB debugging?" prompt
  (tick *always allow from this computer*).

## 1. One-command bring-up
```bash
~/KAY2Tunnel/scripts/phone-bringup.sh
```
Walks the whole chain and prints ✓/✗ at each stage: USB bus → adb authorised →
vitals (model/Android/res/battery/temp) → screenshot → StanCLI `/api/android`.
Green all the way = Phone tab is live.

**Don't want to babysit it?** Start the watcher now and walk away — it fires
bring-up automatically the instant the phone appears:
```bash
~/KAY2Tunnel/scripts/phone-watch.sh
```

Quick screenshot any time:
```bash
~/KAY2Tunnel/scripts/phone-shot.sh [out.png]
```

## 2. Activate Phase 2 (Automation tab) — needs one restart
The `/api/ops` route (cron + agent tasks) isn't loaded by the running server yet.
Use **restart, not reload** (reload double-loads memory → caused the reboot):
```bash
free -h            # confirm headroom first
pm2 restart stan-cli
```
Heads-up: this drops live terminal sessions (but should not reboot the Pi).
Then hard-refresh the PWA (service worker is at v36).

## 3. Manual test pass in StanCLI
- **More → Android Phone → Connect**
  - Live mirror renders (~2 fps).
  - Tap a few spots → registers as taps. Swipe → scrolls.
  - Back / Home / Recents buttons work.
  - Type in the text bar + ⏎ → text lands in a focused field.
- **More → Automation**
  - Cron Jobs lists the 4 Hermes jobs with next-run + last status.
  - "Refresh" re-pulls. Agent Tasks shows the kanban board (empty = clear).

## 4. DroidLoop smoke tests (autonomous control)
Always dry-run first (writes nothing), then `--live` once the plan looks right.
```bash
cd ~/DroidLoop
./play.sh "open Settings and read the Android version"          # dry-run
./play.sh --live "what is my battery percentage"                # read-only, safe live
./play.sh "open the Clock app"                                  # dry-run a navigation
```
Read the result line + newest `droidloop-*.jsonl` for per-step detail.

## 5. Fun / useful demos (once green)
- **Opus-driven nav:** I drive the phone directly over adb, frame by frame
  (deep-link a Settings page, open an app, screenshot, verify).
- **Morning brief:** open your apps, screenshot notifications, summarise.
- **Phone → Pi grab:** pull a photo/file off the phone into a project.
- **Perception→action log:** capture observe/decide/act steps as a dataset.

## Troubleshooting
- `lsusb` shows no Android device → cable/port (charge-only cable is the usual culprit).
- `unauthorized` in `adb devices` → re-accept the debugging prompt on the phone.
- Mirror connects but frames frozen → phone screen off; the bring-up sends WAKEUP.
- Battery was low (~21%) earlier — leave it charging during sessions; DroidLoop
  aborts a run if battery hits 45°C.
