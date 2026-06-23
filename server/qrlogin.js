/* StanCLI — QR cross-device sign-in ("Sign in with phone").
 *
 * Lets an UNAUTHENTICATED desktop log in by having an already-trusted phone
 * scan a QR and approve — no auth token typed on the desktop. WhatsApp-Web style.
 *
 * Flow:
 *   1. Desktop (no token) POST /api/qr/start  → { id, secret, code }.
 *      It renders a QR encoding only `id` (in a https://stan…/#qr=<id> URL) and
 *      keeps `secret` private. It also shows `code` (a 4-digit confirm number).
 *   2. Phone scans → opens #qr=<id>. The phone is the trust anchor: it must
 *      already hold the AUTH_TOKEN (saved login or a passkey assertion). It
 *      shows the same `code` (fetched from /api/qr/info) for the user to match,
 *      then POST /api/qr/approve { id } — gated by bearerAuth upstream, so only
 *      an authenticated device can approve.
 *   3. Desktop polls /api/qr/poll?id&secret. Once approved it receives the
 *      AUTH_TOKEN exactly once, then the session is destroyed.
 *
 * Why a separate `secret`: the QR carries only `id`, so anyone who photographs
 * it could approve (if they were authenticated) but can NEVER claim the token —
 * the token is handed only to the poller presenting the matching `secret`, which
 * never leaves the originating desktop. The 4-digit `code` defends against the
 * user being socially-engineered into approving a stranger's QR.
 */
const express = require('express');
const crypto = require('crypto');
const { AUTH_TOKEN } = require('./config');

const APPROVE_TTL_MS = 3 * 60 * 1000;   // QR/code valid for 3 min to approve
const SESSION_MAX_MS = 5 * 60 * 1000;   // hard cap before a session is swept

// id -> { secret, code, status: 'pending'|'approved', createdAt }
const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_MAX_MS) sessions.delete(id);
  }
}
function get(id) {
  const s = id && sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > APPROVE_TTL_MS) { sessions.delete(id); return null; }
  return s;
}

// ── PUBLIC routes (mounted BEFORE bearerAuth) — start + poll ───────────────────
const publicRouter = express.Router();

publicRouter.post('/start', (req, res) => {
  sweep();
  const id = crypto.randomBytes(16).toString('base64url');
  const secret = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  sessions.set(id, { secret, code, status: 'pending', createdAt: Date.now() });
  res.json({ id, secret, code, ttl: APPROVE_TTL_MS });
});

publicRouter.get('/poll', (req, res) => {
  sweep();
  const { id, secret } = req.query;
  const s = get(id);
  // Constant-ish guard: unknown id OR wrong secret both look 'expired' to callers.
  if (!s || typeof secret !== 'string' || s.secret !== secret) {
    return res.json({ status: 'expired' });
  }
  if (s.status === 'approved') {
    sessions.delete(id);                       // single use — burn it
    return res.json({ status: 'approved', token: AUTH_TOKEN });
  }
  res.json({ status: 'pending' });
});

// ── GATED routes (mounted AFTER bearerAuth) — info + approve ───────────────────
const approveRouter = express.Router();

// Phone previews the session so the user can match the confirmation code.
approveRouter.get('/info', (req, res) => {
  sweep();
  const s = get(String(req.query?.id || ''));
  if (!s) return res.status(404).json({ error: 'expired' });
  res.json({ code: s.code, status: s.status });
});

// Phone (authenticated) approves the desktop's sign-in.
approveRouter.post('/approve', express.json({ limit: '4kb' }), (req, res) => {
  sweep();
  const id = String(req.body?.id || '');
  const s = get(id);
  if (!s) return res.status(404).json({ error: 'expired' });
  s.status = 'approved';
  res.json({ ok: true });
});

module.exports = { publicRouter, approveRouter };
