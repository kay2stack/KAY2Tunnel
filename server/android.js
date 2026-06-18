// Stan CLI — Android control: live screen mirror + input forwarding over ADB/USB.
// This is a manual remote-control surface for Kane's *own* connected phone — the
// same primitives (tap/swipe/key/text/screencap) you'd use sitting in front of it.
// No automation loop, no anti-detection, no human-mimicry: just a remote screen.
const express = require('express');
const { execFile } = require('child_process');

const router = express.Router();

const ADB = process.env.ADB_BIN || 'adb';
let _serial = null;          // cached device serial
let _serialAt = 0;

// Friendly key name -> Android keycode. Allowlist: navigation + light editing only.
const KEYMAP = {
  home: 'KEYCODE_HOME',
  back: 'KEYCODE_BACK',
  recents: 'KEYCODE_APP_SWITCH',
  enter: 'KEYCODE_ENTER',
  tab: 'KEYCODE_TAB',
  del: 'KEYCODE_DEL',
  esc: 'KEYCODE_ESCAPE',
  up: 'KEYCODE_DPAD_UP',
  down: 'KEYCODE_DPAD_DOWN',
  left: 'KEYCODE_DPAD_LEFT',
  right: 'KEYCODE_DPAD_RIGHT',
  wake: 'KEYCODE_WAKEUP',
};

function adb(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const full = _serial ? ['-s', _serial, ...args] : args;
    execFile(ADB, full, { timeout: 8000, maxBuffer: 16 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || '').toString().trim()));
        resolve(stdout);
      });
  });
}

// Resolve (and cache for 15s) the first device in "device" state.
async function ensureSerial() {
  if (_serial && Date.now() - _serialAt < 15000) return _serial;
  const out = (await execFileP(ADB, ['devices'])).toString();
  const line = out.split('\n').slice(1).find(l => /\tdevice\b/.test(l));
  if (!line) { _serial = null; throw new Error('no device in "device" state'); }
  _serial = line.split('\t')[0].trim();
  _serialAt = Date.now();
  return _serial;
}

function execFileP(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 8000, maxBuffer: 16 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).toString())) : resolve(stdout));
  });
}

async function getSize() {
  const out = (await adb(['shell', 'wm', 'size'])).toString();
  const m = out.match(/Override size:\s*(\d+)x(\d+)/) || out.match(/Physical size:\s*(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2408 };
}

// GET /api/android/status — device presence + vitals for the topbar.
router.get('/status', async (req, res) => {
  try {
    await ensureSerial();
    const [model, rel, batt, size, fg] = await Promise.all([
      adb(['shell', 'getprop', 'ro.product.model']).then(s => s.toString().trim()),
      adb(['shell', 'getprop', 'ro.build.version.release']).then(s => s.toString().trim()),
      adb(['shell', 'dumpsys', 'battery']).then(s => s.toString()),
      getSize(),
      adb(['shell', 'dumpsys', 'activity', 'activities'])
        .then(s => (s.toString().match(/topResumedActivity=.*?([\w.]+\/[\w.$]+)/) || [])[1] || '')
        .catch(() => ''),
    ]);
    const level = (batt.match(/level:\s*(\d+)/) || [])[1];
    const tempRaw = (batt.match(/temperature:\s*(\d+)/) || [])[1];
    const charging = /status:\s*2/.test(batt);
    res.json({
      connected: true, serial: _serial, model, android: rel,
      battery: level ? +level : null,
      temp: tempRaw ? +tempRaw / 10 : null,
      charging, width: size.w, height: size.h, foreground: fg,
    });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// GET /api/android/screen — one PNG frame (clients poll this for the mirror).
router.get('/screen', async (req, res) => {
  try {
    await ensureSerial();
    const png = await adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// POST /api/android/input — forward one input event.
//   { type:'tap', x, y } | { type:'swipe', x1,y1,x2,y2, dur? }
//   { type:'key', key }  (allowlisted) | { type:'text', text }
router.post('/input', express.json({ limit: '64kb' }), async (req, res) => {
  const b = req.body || {};
  try {
    await ensureSerial();
    const size = await getSize();
    const clampX = v => Math.max(0, Math.min(size.w, Math.round(+v)));
    const clampY = v => Math.max(0, Math.min(size.h, Math.round(+v)));

    if (b.type === 'tap') {
      await adb(['shell', 'input', 'tap', String(clampX(b.x)), String(clampY(b.y))]);
    } else if (b.type === 'swipe') {
      const dur = Math.max(50, Math.min(3000, +b.dur || 250));
      await adb(['shell', 'input', 'swipe',
        String(clampX(b.x1)), String(clampY(b.y1)),
        String(clampX(b.x2)), String(clampY(b.y2)), String(dur)]);
    } else if (b.type === 'key') {
      const code = KEYMAP[String(b.key || '').toLowerCase()];
      if (!code) return res.status(400).json({ error: 'key not allowed' });
      await adb(['shell', 'input', 'keyevent', code]);
    } else if (b.type === 'text') {
      // input text needs spaces escaped as %s; send verbatim otherwise.
      const txt = String(b.text || '').slice(0, 2000).replace(/ /g, '%s');
      if (txt) await adb(['shell', 'input', 'text', txt]);
    } else {
      return res.status(400).json({ error: 'unknown input type' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

module.exports = router;
