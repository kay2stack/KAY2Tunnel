// System monitor — fires web-push notifications on the events Kane wants to be
// "fully notified" about: Pi reboots, phone connect/disconnect, low battery.
// Runs inside the stan-cli process. Lightweight: only `adb devices` + a quick
// adb battery read + /proc reads — no heavy spawns. State persists to disk so a
// reboot is still detected after the server restarts with it.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const push = require('./push');

const STATE_FILE = path.join(__dirname, '.monitor-state.json');
const ADB = process.env.ADB_BIN || 'adb';

const ADB_POLL_MS = 12000;      // phone connect/disconnect
const BATT_POLL_MS = 60000;     // phone battery
const LOW_BATT = 15;            // % threshold

let state = load();             // { armed, bootId, phone, lowBattNotified }
let _timers = [];

function load() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }

function fire(o) { push.notify(o).catch(() => {}); }

function bootId() {
  try {
    const m = fs.readFileSync('/proc/stat', 'utf8').match(/btime (\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function adbConnected(cb) {
  execFile(ADB, ['devices'], { timeout: 6000 }, (err, out) => {
    if (err) return cb(false);
    cb(/\tdevice\b/.test(out.toString()));
  });
}

function adbBattery(cb) {
  execFile(ADB, ['shell', 'dumpsys', 'battery'], { timeout: 6000 }, (err, out) => {
    if (err) return cb(null, null);
    const s = out.toString();
    const lvl = s.match(/level:\s*(\d+)/);
    const tmp = s.match(/temperature:\s*(\d+)/);
    cb(lvl ? +lvl[1] : null, tmp ? +tmp[1] / 10 : null);   // temp is tenths °C
  });
}

const TEMP_WARN = 40;   // °C — push warning; matches thermal-guard warn band

// ── startup: reboot detection + one-time arm confirmation ─────────────────
function startup() {
  const boot = bootId();
  const prevBoot = state.bootId;
  state.bootId = boot;

  // Only fire the one-time confirmation once a device is actually subscribed,
  // so it isn't wasted into the void before notifications are enabled.
  if (!state.armed && push.subCount() > 0) {
    state.armed = true;
    fire({ title: 'StanCLI', body: '🔔 Notifications armed — you’ll be alerted on reboots, phone connect/disconnect & low battery.', tag: 'armed' });
  } else if (state.armed && prevBoot && boot && prevBoot !== boot) {
    fire({ title: 'StanCLI', body: '♻️ Pi rebooted — StanCLI is back online.', tag: 'reboot', url: '/' });
  }
  save();
}

// ── pollers ───────────────────────────────────────────────────────────────
function pollPhone() {
  adbConnected(conn => {
    const now = conn ? 'connected' : 'disconnected';
    if (state.phone && state.phone !== now) {
      if (now === 'connected')
        fire({ title: 'Phone', body: '📱 Android connected — Phone tab is live.', tag: 'phone', url: '/' });
      else
        fire({ title: 'Phone', body: '🔌 Android disconnected.', tag: 'phone', url: '/' });
    }
    if (state.phone !== now) { state.phone = now; save(); }
  });
}

function pollBattery() {
  if (state.phone !== 'connected') return;
  adbBattery((level, temp) => {
    if (level != null) {
      if (level <= LOW_BATT && !state.lowBattNotified) {
        state.lowBattNotified = true; save();
        fire({ title: 'Phone', body: `🪫 Battery low (${level}%) — plug it in.`, tag: 'phone-batt' });
      } else if (level > LOW_BATT + 5 && state.lowBattNotified) {
        state.lowBattNotified = false; save();   // reset once it recovers
      }
    }
    if (temp != null) {
      if (temp >= TEMP_WARN && !state.hotNotified) {
        state.hotNotified = true; save();
        fire({ title: 'Phone', body: `🔥 Phone running hot (${temp.toFixed(0)}°C) — DroidLoop auto-aborts at 42°C, watchdog at 43°C.`, tag: 'phone-temp' });
      } else if (temp < TEMP_WARN - 3 && state.hotNotified) {
        state.hotNotified = false; save();        // reset once it cools
      }
    }
  });
}

function start() {
  // small delay so push subs / webpush are ready before the arm/reboot ping
  setTimeout(startup, 3000);
  _timers.push(setInterval(pollPhone, ADB_POLL_MS));
  _timers.push(setInterval(pollBattery, BATT_POLL_MS));
  setTimeout(pollPhone, 4000);
  console.log('[monitor] watching reboots + phone connect/disconnect + battery');
}

function stop() { _timers.forEach(clearInterval); _timers = []; }

module.exports = { start, stop };
