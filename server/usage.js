// server/usage.js — Claude Max-plan usage, read from the logged-in Claude Code
// OAuth token and proxied so the token NEVER reaches the browser.
//
// StanChat IS Claude Code on a Max plan, so a per-session "$" readout (great for
// the API-billed bots — Clive/Hermes) is misleading here: the real budget is the
// plan's rolling limits. This surfaces the exact numbers `claude`'s own /usage
// command shows, by hitting the same endpoint with the live OAuth access token.
//
// Claude Code keeps ~/.claude/.credentials.json refreshed as it runs, so we just
// read the current accessToken each call — no token-refresh logic that could
// clobber the credentials Claude owns. 60s cache; last-known served on a blip.

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const CREDS = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_MS = 60 * 1000;

let cache = null, cacheAt = 0, inflight = null;

function readCred() {
  try {
    const c = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
    const o = c.claudeAiOauth || c;
    return { token: o.accessToken, plan: o.subscriptionType || null, expiresAt: o.expiresAt || null };
  } catch { return null; }
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request(USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'stan-cli/1.0 (+kay2)',
        Accept: 'application/json',
      },
    }, r => {
      let body = '';
      r.on('data', d => (body += d));
      r.on('end', () => {
        if (r.statusCode !== 200) return reject(new Error('usage-http-' + r.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error('usage-timeout')));
    req.on('error', reject);
    req.end();
  });
}

// Compact, client-friendly shape from the raw oauth/usage payload.
function shape(raw, cred) {
  const win = w => (w ? { pct: Math.round(w.utilization ?? 0), resetsAt: w.resets_at || null } : null);
  const sess = (raw.limits || []).find(l => l.group === 'session');
  return {
    plan: (cred && cred.plan) || 'max',
    session: win(raw.five_hour),        // 5h rolling — the "about to cap" number
    week: win(raw.seven_day),           // 7-day, all models
    weekOpus: win(raw.seven_day_opus),
    weekSonnet: win(raw.seven_day_sonnet),
    severity: (sess && sess.severity) || 'normal',
    at: Date.now(),
  };
}

async function getUsage() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const cred = readCred();
    if (!cred || !cred.token) throw new Error('no-credentials');
    const out = shape(await fetchUsage(cred.token), cred);
    cache = out; cacheAt = Date.now();
    return out;
  })();
  try { return await inflight; } finally { inflight = null; }
}

const router = express.Router();
router.get('/', async (req, res) => {
  try {
    res.json(await getUsage());
  } catch (e) {
    if (cache) return res.json({ ...cache, stale: true });   // ride out a transient blip
    res.status(e.message === 'no-credentials' ? 503 : 502).json({ error: e.message });
  }
});

module.exports = { router, getUsage };
