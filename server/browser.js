// Chrome DevTools Protocol bridge — streams screenshots + forwards input events

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const router = express.Router();

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;

let _cdp = null;
let _msgId = 1;
let _cbs = {};
let _currentUrl = '';

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!_cdp || _cdp.readyState !== WebSocket.OPEN) {
      reject(new Error('not connected')); return;
    }
    const id = _msgId++;
    _cbs[id] = { resolve, reject };
    _cdp.send(JSON.stringify({ id, method, params }));
    const t = setTimeout(() => {
      if (_cbs[id]) { delete _cbs[id]; reject(new Error('timeout')); }
    }, 8000);
    // clear timeout on resolution
    const orig = _cbs[id];
    _cbs[id] = {
      resolve: (v) => { clearTimeout(t); orig.resolve(v); },
      reject: (e) => { clearTimeout(t); orig.reject(e); },
    };
  });
}

function listTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${CDP_HOST}:${CDP_PORT}/json`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('CDP timeout')); });
  });
}

async function ensureConnected() {
  if (_cdp && _cdp.readyState === WebSocket.OPEN) return true;
  _cdp = null;
  try {
    const targets = await listTargets();
    const page = targets.find(t => t.type === 'page') || targets[0];
    if (!page) return false;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      ws.once('open', () => {
        _cdp = ws;
        _cdp.on('message', raw => {
          try {
            const msg = JSON.parse(raw);
            if (msg.id && _cbs[msg.id]) {
              const cb = _cbs[msg.id];
              delete _cbs[msg.id];
              if (msg.error) cb.reject(new Error(msg.error.message));
              else cb.resolve(msg.result || {});
            }
          } catch {}
        });
        _cdp.on('close', () => { _cdp = null; });
        _cdp.on('error', () => { _cdp = null; });
        resolve();
      });
      ws.once('error', reject);
      setTimeout(() => reject(new Error('ws timeout')), 4000);
    });
    return true;
  } catch { return false; }
}

// GET /api/browser/status
router.get('/status', async (req, res) => {
  const connected = await ensureConnected();
  if (!connected) return res.json({ connected: false });
  try {
    const { result } = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    _currentUrl = result?.value || '';
    res.json({ connected: true, url: _currentUrl });
  } catch { res.json({ connected: true, url: _currentUrl }); }
});

// GET /api/browser/screenshot
router.get('/screenshot', async (req, res) => {
  if (!await ensureConnected()) { res.status(503).end(); return; }
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 65 });
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(data, 'base64'));
  } catch { _cdp = null; res.status(503).end(); }
});

// POST /api/browser/navigate  { url }
router.post('/navigate', express.json(), async (req, res) => {
  if (!await ensureConnected()) return res.status(503).json({ error: 'not connected' });
  try {
    let url = (req.body.url || '').trim();
    if (url && !url.startsWith('http')) url = 'https://' + url;
    await send('Page.navigate', { url });
    _currentUrl = url;
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/browser/click  { x, y }
router.post('/click', express.json(), async (req, res) => {
  if (!await ensureConnected()) return res.status(503).json({ error: 'not connected' });
  try {
    const { x, y } = req.body;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/browser/type  { text }
router.post('/type', express.json(), async (req, res) => {
  if (!await ensureConnected()) return res.status(503).json({ error: 'not connected' });
  try {
    await send('Input.insertText', { text: req.body.text });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/browser/key  { key: 'Enter'|'Backspace'|etc. }
router.post('/key', express.json(), async (req, res) => {
  if (!await ensureConnected()) return res.status(503).json({ error: 'not connected' });
  try {
    const key = req.body.key || '';
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/browser/back
router.post('/back', async (req, res) => {
  if (!await ensureConnected()) return res.status(503).json({ error: 'not connected' });
  try { await send('Runtime.evaluate', { expression: 'history.back()' }); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/browser/forward
router.post('/forward', async (req, res) => {
  if (!await ensureConnected()) return res.status(503).json({ error: 'not connected' });
  try { await send('Runtime.evaluate', { expression: 'history.forward()' }); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/browser/refresh
router.post('/refresh', async (req, res) => {
  if (!await ensureConnected()) return res.status(503).json({ error: 'not connected' });
  try { await send('Page.reload'); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
