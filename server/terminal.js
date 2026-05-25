const pty = require('node-pty');
const crypto = require('crypto');
const { ROOT_DIR } = require('./config');

const SCROLLBACK_LIMIT = 256 * 1024;
const HEARTBEAT_INTERVAL = 20_000;
const HEARTBEAT_MISSES = 2;

const sessions = new Map(); // id → Session

class Session {
  constructor({ name = null, cmd = 'bash', args = [], cwd = ROOT_DIR } = {}) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.cmd = cmd;
    this.cwd = cwd;
    this.clients = new Set();
    this.scrollback = Buffer.alloc(0);
    this.lastActive = Date.now();
    this.createdAt = Date.now();

    this.pty = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    this.pty.onData((data) => {
      this._appendScrollback(data);
      this.lastActive = Date.now();
      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    this.pty.onExit(() => {
      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit' }));
      }
      sessions.delete(this.id);
    });
  }

  _appendScrollback(data) {
    const combined = Buffer.concat([this.scrollback, Buffer.from(data)]);
    this.scrollback = combined.length > SCROLLBACK_LIMIT
      ? combined.slice(combined.length - SCROLLBACK_LIMIT)
      : combined;
  }

  attach(ws) {
    this.clients.add(ws);
    if (this.scrollback.length > 0) {
      ws.send(JSON.stringify({ type: 'output', data: this.scrollback.toString() }));
    }
    this._heartbeat(ws);
  }

  detach(ws) { this.clients.delete(ws); }

  _heartbeat(ws) {
    let misses = 0;
    ws._pongReceived = true;
    ws.on('pong', () => { ws._pongReceived = true; misses = 0; });
    const iv = setInterval(() => {
      if (!this.clients.has(ws)) { clearInterval(iv); return; }
      if (!ws._pongReceived && ++misses >= HEARTBEAT_MISSES) {
        clearInterval(iv); this.detach(ws); ws.terminate(); return;
      }
      ws._pongReceived = false;
      if (ws.readyState === ws.OPEN) ws.ping();
    }, HEARTBEAT_INTERVAL);
    ws.on('close', () => clearInterval(iv));
  }

  write(data) { this.pty.write(data); this.lastActive = Date.now(); }
  resize(cols, rows) { this.pty.resize(cols, rows); }
  kill() { this.pty.kill(); }

  // last N bytes of scrollback as a plain string (for agent card previews)
  tail(bytes = 4096) {
    const buf = this.scrollback;
    return buf.slice(Math.max(0, buf.length - bytes)).toString();
  }
}

function handleWs(ws, req) {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('session');
  const sessionName = url.searchParams.get('name');
  const cmd = url.searchParams.get('cmd') || 'bash';
  const cwd = url.searchParams.get('cwd') || ROOT_DIR;

  let session = null;

  // Try reattach by id
  if (sessionId) session = sessions.get(sessionId);

  // Try reattach by name
  if (!session && sessionName) {
    session = [...sessions.values()].find(s => s.name === sessionName) || null;
  }

  // Create new
  if (!session) {
    session = new Session({ name: sessionName || null, cmd, cwd });
    sessions.set(session.id, session);
  }

  session.attach(ws);
  ws.send(JSON.stringify({ type: 'session', id: session.id, name: session.name }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'input') session.write(msg.data);
    else if (msg.type === 'resize') session.resize(msg.cols, msg.rows);
    else if (msg.type === 'kill') session.kill();
  });

  ws.on('close', () => session.detach(ws));
  ws.on('error', () => session.detach(ws));
}

function listSessions() {
  return [...sessions.values()].map(s => ({
    id: s.id,
    name: s.name,
    cmd: s.cmd,
    cwd: s.cwd,
    clients: s.clients.size,
    lastActive: s.lastActive,
    createdAt: s.createdAt,
  }));
}

function getSession(id) { return sessions.get(id) || null; }

module.exports = { handleWs, listSessions, getSession };
