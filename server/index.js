const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { PORT, HOST, AUTH_TOKEN } = require('./config');
const { bearerAuth, wsAuth } = require('./auth');
const { handleWs, listSessions, getSession, renameSession, killSession, setExitNotifier } = require('./terminal');
const push = require('./push');
const { handleVncWs } = require('./vnc');
const filesRouter = require('./files');
const aiRouter = require('./ai');
const agentsRouter = require('./agents');
const projectsRouter = require('./projects');
const diffRouter = require('./diff');
const piRouter = require('./pi');
const browserRouter = require('./browser');
const androidRouter = require('./android');
const opsRouter = require('./ops');
const chat = require('./chat');
const usage = require('./usage');
const voice = require('./voice');
const system = require('./system');

const app = express();
const server = http.createServer(app);

// CORS — lets the kay2OS frontend (served cross-origin, e.g. from Netlify) call
// the API. Strictly allowlisted: only origins in FRONTEND_ORIGINS (.env,
// comma-separated) get CORS headers; every other cross-origin request is left
// without them and blocked by the browser. Auth stays token-based on top of
// this. Preflight is answered here, before the bearer-auth gate.
const ALLOWED_ORIGINS = new Set(
  (process.env.FRONTEND_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

// Dedicated kay2OS subdomain: kay2os.spikeradar.co.uk serves the desktop shell
// at the root, while /api and /ws still hit this same server (so the frontend is
// same-origin with its backend — no CORS, shares the stan_token login).
const KAY2OS_DIR = '/home/kay2/KAY2Tunnel/public/kay2os';
const kay2osStatic = express.static(KAY2OS_DIR, { index: 'index.html' });
// Security headers for the kay2OS frontend ONLY (additive — scoped to the
// kay2os host so the main StanCLI UI is untouched). CSP keeps 'unsafe-inline'
// because the shell is one big inline script (a nonce rewrite is the follow-up);
// even so, frame-ancestors/connect-src/object-src materially cut XSS+clickjacking
// blast radius. frame-src https: is required by the in-app Browser/site apps.
function kay2osSecHeaders(res) {
  // connect-src whitelists the read-only public APIs the desktop apps use
  // (Weather: Open-Meteo · TON Markets/Explorer: tonapi.io + CoinGecko). These
  // expose no local data — they only permit outbound fetches to named hosts.
  // The TON Wallet app self-hosts the TON Connect SDK (so script-src stays
  // 'self'), but connecting a real wallet needs its HTTP-bridge hosts + the
  // wallets-list, and the connect modal shows wallet icons (img https:).
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https:; font-src 'self'; " +
    "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://tonapi.io https://api.coingecko.com " +
      "https://config.ton.org https://raw.githubusercontent.com https://bridge.tonapi.io https://connect.tonhubapi.com https://walletbot.me " +
      "https://tonconnectbridge.mytonwallet.org https://connect.mytonwallet.org https://app.tonkeeper.com https://ton-connect-bridge.bgwapi.io; " +
    "frame-src https:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
app.use((req, res, next) => {
  if (req.hostname === 'kay2os.spikeradar.co.uk' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
    kay2osSecHeaders(res);
    return kay2osStatic(req, res, () => res.sendFile(KAY2OS_DIR + '/index.html'));
  }
  next();
});

// Marketing landing page: macpios.spikeradar.co.uk → public/macpios (static only,
// no /api). Mirrors the kay2os host-routing above; links out to the kay2os shell.
const MACPIOS_DIR = '/home/kay2/KAY2Tunnel/public/macpios';
const macpiosStatic = express.static(MACPIOS_DIR, { index: 'index.html' });
app.use((req, res, next) => {
  if (req.hostname === 'macpios.spikeradar.co.uk') {
    return macpiosStatic(req, res, () => res.sendFile(MACPIOS_DIR + '/index.html'));
  }
  next();
});

// Dedicated Stan Chat subdomain: stanchat.spikeradar.co.uk serves the standalone
// Claude Code chat PWA at the root, while /api + /ws fall through to this same
// server. Mirrors the kay2os/macpios host-routing above. Unknown paths (shared
// /icons, /vendor, /brand) fall through to the general static handler below.
const STANCHAT_DIR = path.join(__dirname, '../public/stanchat');
const stanchatStatic = express.static(STANCHAT_DIR, { index: 'index.html' });
app.use((req, res, next) => {
  if (req.hostname === 'stanchat.spikeradar.co.uk' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
    return stanchatStatic(req, res, next);
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// kay2OS — macOS-style desktop shell (additive, non-breaking). Source of truth
// lives in /home/kay2/MacPiOs; also reachable at /kay2os.html via the public symlink.
app.get('/kay2os', (req, res) => res.sendFile('/home/kay2/MacPiOs/kay2os.html'));

// Passkey (WebAuthn) login — PUBLIC routes only (status + the auth challenge/
// verify that grant a token). Mounted BEFORE the bearerAuth gate so the lock
// screen can sign in without already holding the token. Enrollment is mounted
// AFTER the gate (see below) so a passkey can only be added once authenticated.
const webauthn = require('./webauthn');
app.use('/api/webauthn', webauthn.authRouter);

// QR cross-device sign-in. `start` + `poll` are PUBLIC (the desktop has no token
// yet); `info` + `approve` are gated below (only an authenticated phone approves).
const qrlogin = require('./qrlogin');
app.use('/api/qr', qrlogin.publicRouter);

app.use('/api', bearerAuth);
app.use('/api/qr', qrlogin.approveRouter);
app.use('/api/webauthn', webauthn.registerRouter);
app.use('/api/files', filesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/diff', diffRouter);
app.use('/api/pi', piRouter);
app.use('/api/browser', browserRouter);
app.use('/api/android', androidRouter);
app.use('/api/ops', opsRouter);
app.use('/api/chat', chat.router);
app.use('/api/usage', usage.router);
app.use('/api/voice', voice.router);
app.use('/api/push', push.router);
app.get('/api/system', (req, res) => res.json({ cpu: system.cpu(), mem: system.mem(), load: system.load(), temp: system.temp(), uptime: system.uptime() }));
app.get('/api/term/sessions', (req, res) => res.json(listSessions()));
app.patch('/api/term/sessions/:id', express.json(), (req, res) => {
  const label = String(req.body?.label || '').trim();
  if (label.length > 64) return res.status(400).json({ error: 'Label is too long' });
  const session = renameSession(req.params.id, label || null);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true, id: session.id, label: session.label });
});
app.delete('/api/term/sessions/:id', (req, res) => {
  const session = killSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

app.post('/api/term/inject', express.json(), (req, res) => {
  const { text, sessionId, execute } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });
  // Auto-pick the most-recent REAL shell — never a chat mirror, or "send to
  // terminal" would type the command back into Claude instead of a shell.
  const sorted = listSessions().sort((a, b) => b.lastActive - a.lastActive);
  const session = sessionId
    ? getSession(sessionId)
    : sorted.filter(s => s.type !== 'chat').map(s => getSession(s.id)).find(Boolean);
  if (!session) return res.status(404).json({ error: 'no active terminal session' });
  session.write(text + (execute ? '\r' : ''));
  res.json({ ok: true, sessionId: session.id });
});

app.get('/api/clips/remote', async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7421/api/clips', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Clip API error' });
    res.json(await r.json());
  } catch {
    res.status(503).json({ error: 'Clip app unavailable' });
  }
});

// Push a new clip into the shared (cross-device) clipboard.
app.post('/api/clips/remote', express.json({ limit: '256kb' }), async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const r = await fetch('http://127.0.0.1:7421/api/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify({ text, type: req.body?.type, device: 'StanCLI' }),
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Clip API error' });
    res.json(await r.json().catch(() => ({ ok: true })));
  } catch {
    res.status(503).json({ error: 'Clip app unavailable' });
  }
});

// When an agent's process exits, push a notification to subscribed devices.
setExitNotifier(({ name, cwd, exitCode }) => {
  const agent = (name || '').replace(/^agent:/, '');
  const labels = { 'claude-code': 'Claude Code', codex: 'Codex', gemini: 'Gemini',
    'cursor-agent': 'Cursor', hermes: 'Hermes', clive: 'Clive' };
  const label = labels[agent] || agent || 'Agent';
  const repo = cwd ? cwd.split('/').pop() : '';
  push.notify({
    title: `${label} finished`,
    body: (repo ? `in ${repo}` : 'session ended') + (exitCode ? ` · exit ${exitCode}` : ''),
    tag: name, url: '/', category: 'agent',
  });
});

// kay2OS → Clive (OpenClaw gateway). Same agent/memory/skills as Telegram —
// this is just ANOTHER CLIENT on the gateway, not a new bot. Sits behind the
// existing /api bearerAuth, so the browser only ever sends the stan_token; the
// gateway token is injected here, server-side, and never reaches the client.
// Uses the OpenAI-compatible Responses API (/v1/responses), which is the
// endpoint enabled on this gateway (chat/completions is disabled). A stable
// x-openclaw-session-key keeps Clive's context continuous across messages.
const OPENCLAW_GW = 'http://127.0.0.1:18789';
const OPENCLAW_GW_ENV = '/home/kay2/clive-runtime/.openclaw-gateway.env';
let _openclawTok = null;
function openclawToken() {
  if (_openclawTok) return _openclawTok;
  if (process.env.OPENCLAW_TOKEN) return (_openclawTok = process.env.OPENCLAW_TOKEN);
  try {
    const txt = require('fs').readFileSync(OPENCLAW_GW_ENV, 'utf8');
    const m = txt.match(/OPENCLAW_GATEWAY_TOKEN\s*=\s*(\S+)/);
    if (m) return (_openclawTok = m[1]);
  } catch {}
  return '';
}
// Pull the assistant's text out of an OpenAI Responses-API payload.
function cliveReplyText(j) {
  if (!j) return '';
  if (typeof j.output_text === 'string' && j.output_text) return j.output_text;
  const out = Array.isArray(j.output) ? j.output : [];
  const parts = [];
  for (const item of out) {
    if (item && item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c && c.type === 'output_text' && c.text) parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim();
}
app.post('/api/clive', express.json({ limit: '256kb' }), async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const session = String(req.body?.session || 'kay2os').slice(0, 120);
  if (!message) return res.status(400).json({ error: 'message required' });
  const tok = openclawToken();
  if (!tok) return res.status(503).json({ error: 'Clive gateway token unavailable' });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120000); // agent turns can be slow
  try {
    const r = await fetch(`${OPENCLAW_GW}/v1/responses`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok}`,
        'x-openclaw-message-channel': 'kay2os',
        'x-openclaw-session-key': session,
      },
      body: JSON.stringify({ model: 'openclaw', input: message, stream: false }),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json())?.error?.message || ''; } catch {}
      return res.status(502).json({ error: 'Clive gateway error' + (detail ? ': ' + detail : ' (' + r.status + ')') });
    }
    const j = await r.json();
    const reply = cliveReplyText(j) || '(no response)';
    res.json({ reply });
  } catch (e) {
    res.status(e.name === 'AbortError' ? 504 : 503).json({
      error: e.name === 'AbortError' ? 'Clive timed out' : 'Clive gateway unavailable',
    });
  } finally {
    clearTimeout(timer);
  }
});

// kay2OS cockpit — read-only list of live tmux sessions so the desktop can light
// up "agent running" dots. Additive; behind the existing /api bearerAuth. Never
// touches/kills anything — just `tmux ls`.
app.get('/api/tmux', (req, res) => {
  require('child_process').execFile('tmux', ['ls', '-F', '#{session_name}'], { timeout: 4000 }, (err, stdout) => {
    if (err) return res.json({ sessions: [] }); // no tmux server / no sessions
    const sessions = String(stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
    res.json({ sessions });
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const deny = () => { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); };
  if (!wsAuth(req)) { deny(); return; }

  if (req.url.startsWith('/ws/term')) {
    wss.handleUpgrade(req, socket, head, ws => handleWs(ws, req));
  } else if (req.url.startsWith('/ws/chat')) {
    wss.handleUpgrade(req, socket, head, ws => chat.handleChatWs(ws, req));
  } else if (req.url.startsWith('/ws/vnc')) {
    wss.handleUpgrade(req, socket, head, ws => handleVncWs(ws));
  } else {
    socket.destroy();
  }
});

let _shuttingDown = false;
let _bootNotified = false;
function bindServer() {
  if (server.listening) return;
  server.listen(PORT, HOST, () => {
    const addr = server.address();
    console.log(`Stan CLI v4.2 — http://${addr.address}:${addr.port}`);
    // Boot/reboot push: a low system uptime means the whole Pi just came back;
    // otherwise it's a plain StanCLI restart. Once per process (not per rebind).
    if (!_bootNotified) {
      _bootNotified = true;
      const up = system.uptime() || 0;
      const reboot = up > 0 && up < 300;
      push.notify({
        title: reboot ? '🔌 kay2 Pi rebooted' : '♻️ StanCLI restarted',
        body: reboot ? 'The Pi came back online — StanCLI is up.' : 'StanCLI server is back online.',
        tag: 'boot', url: '/stanchat/', category: 'system',
      }).catch(() => {});
    }
  });
}
server.on('close', () => {
  if (_shuttingDown) return;
  console.error('[server] HTTP listener closed unexpectedly — rebinding in 1s');
  setTimeout(() => {
    try { bindServer(); } catch (e) { console.error('[server] rebind failed:', e.message); }
  }, 1000).unref?.();
});
server.on('error', (e) => {
  console.error('[server] HTTP listener error:', e && e.message ? e.message : e);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    _shuttingDown = true;
    try { server.close(() => process.exit(0)); } catch { process.exit(0); }
    setTimeout(() => process.exit(0), 3000).unref?.();
  });
}
bindServer();

// Self-heal the HTTP listener. Rarely, a stale PM2/Node state can report the
// server as listening while 127.0.0.1:PORT refuses connections; Cloudflare then
// serves a dead app. Probe loop forces a close+rebind instead of leaving StanCLI
// looking online-but-unreachable.
const net = require('net');
function probeListener() {
  if (_shuttingDown) return;
  const sock = net.createConnection({ host: HOST, port: PORT });
  let ok = false;
  const done = (healthy) => {
    if (ok) return; ok = true;
    try { sock.destroy(); } catch {}
    if (!healthy && !_shuttingDown) {
      console.error('[server] probe failed — forcing HTTP listener rebind');
      try { server.close(() => bindServer()); }
      catch { try { bindServer(); } catch (e) { console.error('[server] forced rebind failed:', e.message); } }
      setTimeout(() => { try { bindServer(); } catch {} }, 500).unref?.();
    }
  };
  sock.once('connect', () => done(true));
  sock.once('error', () => done(false));
  sock.setTimeout(1200, () => done(false));
}
setTimeout(probeListener, 1200).unref?.();
setInterval(probeListener, 10000).unref?.();

// System monitor — fires push notifications on reboots, phone connect/disconnect, low battery.
require('./monitor').start();

// Job runner — StanCLI's own scheduled/on-demand automation (Pi ops, phone, clips, Clive).
require('./jobs').start();
