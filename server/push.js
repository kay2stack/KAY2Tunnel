// Web Push — notify the user's devices when an agent finishes, etc.
// VAPID keys + subscriptions are persisted to disk so they survive restarts.
const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const VAPID_FILE = path.join(__dirname, '.vapid.json');
const SUBS_FILE = path.join(__dirname, '.push-subs.json');

// ── VAPID keys (generate once, then reuse) ───────────────────────────────
let keys;
try {
  keys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} catch {
  keys = webpush.generateVAPIDKeys();
  try { fs.writeFileSync(VAPID_FILE, JSON.stringify(keys)); } catch (e) { console.error('[push] cannot persist VAPID keys:', e.message); }
}
webpush.setVapidDetails('mailto:web3kay2@gmail.com', keys.publicKey, keys.privateKey);

// ── Subscription store ───────────────────────────────────────────────────
let subs = [];
try { subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { subs = []; }
function persist() {
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subs)); } catch (e) { console.error('[push] persist failed:', e.message); }
}

function addSub(sub) {
  if (!sub || !sub.endpoint) return;
  if (!subs.find(s => s.endpoint === sub.endpoint)) { subs.push(sub); persist(); }
}
function removeSub(endpoint) {
  const before = subs.length;
  subs = subs.filter(s => s.endpoint !== endpoint);
  if (subs.length !== before) persist();
}

// ── Send a notification to every subscribed device ───────────────────────
async function notify({ title, body, tag, url }) {
  if (!subs.length) return;
  const payload = JSON.stringify({ title: title || 'Stan CLI', body: body || '', tag, url: url || '/' });
  await Promise.all(subs.map(sub =>
    webpush.sendNotification(sub, payload).catch(err => {
      // 404/410 → subscription is dead; drop it.
      if (err.statusCode === 404 || err.statusCode === 410) removeSub(sub.endpoint);
      else console.error('[push] send error:', err.statusCode || err.message);
    })
  ));
}

// ── Routes (mounted behind bearerAuth at /api/push) ──────────────────────
const router = express.Router();
router.get('/vapid', (req, res) => res.json({ key: keys.publicKey }));
router.post('/subscribe', express.json(), (req, res) => {
  addSub(req.body?.subscription || req.body);
  res.json({ ok: true, count: subs.length });
});
router.post('/unsubscribe', express.json(), (req, res) => {
  if (req.body?.endpoint) removeSub(req.body.endpoint);
  res.json({ ok: true });
});
router.post('/test', express.json(), async (req, res) => {
  await notify({ title: 'Stan CLI', body: 'Notifications are working ✓', tag: 'test' });
  res.json({ ok: true, count: subs.length });
});

module.exports = { router, notify };
