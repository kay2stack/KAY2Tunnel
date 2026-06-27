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

// Notification categories the user can toggle per device. A subscription with no
// `prefs` (older subs) is treated as all-on, so behaviour is unchanged until a
// device explicitly opts a category out.
const CATEGORIES = ['reply', 'error', 'work', 'agent', 'system'];

function addSub(sub, prefs) {
  if (!sub || !sub.endpoint) return;
  const existing = subs.find(s => s.endpoint === sub.endpoint);
  if (existing) {
    if (prefs) { existing.prefs = { ...(existing.prefs || {}), ...prefs }; persist(); }
    return;
  }
  const rec = { ...sub };
  if (prefs) rec.prefs = prefs;
  subs.push(rec);
  persist();
}
function removeSub(endpoint) {
  const before = subs.length;
  subs = subs.filter(s => s.endpoint !== endpoint);
  if (subs.length !== before) persist();
}
// Update which categories a device wants. Returns false if the endpoint is unknown.
function setPrefs(endpoint, prefs) {
  const s = subs.find(x => x.endpoint === endpoint);
  if (!s || !prefs || typeof prefs !== 'object') return false;
  s.prefs = { ...(s.prefs || {}), ...prefs };
  persist();
  return true;
}

// ── Send a notification to every subscribed device that wants this category ──
// `category` is one of CATEGORIES (or omitted for unconditional/system pings).
async function notify({ title, body, tag, url, category }) {
  if (!subs.length) return;
  const payload = JSON.stringify({ title: title || 'Stan CLI', body: body || '', tag, url: url || '/' });
  const targets = category
    ? subs.filter(s => !s.prefs || s.prefs[category] !== false)
    : subs;
  if (!targets.length) return;
  await Promise.all(targets.map(sub =>
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
  addSub(req.body?.subscription || req.body, req.body?.prefs);
  res.json({ ok: true, count: subs.length });
});
router.post('/unsubscribe', express.json(), (req, res) => {
  if (req.body?.endpoint) removeSub(req.body.endpoint);
  res.json({ ok: true });
});
// Per-device category preferences: { endpoint, prefs:{reply,error,work,agent,system} }
router.post('/prefs', express.json(), (req, res) => {
  const ok = setPrefs(req.body?.endpoint, req.body?.prefs);
  res.json({ ok, categories: CATEGORIES });
});
router.post('/test', express.json(), async (req, res) => {
  await notify({ title: 'Stan CLI', body: 'Notifications are working ✓', tag: 'test' });
  res.json({ ok: true, count: subs.length });
});

function subCount() { return subs.length; }

module.exports = { router, notify, subCount, CATEGORIES };
