const pty = require('node-pty');
const crypto = require('crypto');
const { ROOT_DIR } = require('./config');

const SCROLLBACK_LIMIT = 256 * 1024;
const HEARTBEAT_INTERVAL = 20_000;
const HEARTBEAT_MISSES = 2;

const sessions = new Map(); // id → Session

// Optional hook fired when an agent session's process exits (for push notifs).
let exitNotifier = null;
function setExitNotifier(cb) { exitNotifier = cb; }

class Session {
  constructor({ name = null, cmd = 'bash', args = [], cwd = ROOT_DIR } = {}) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.label = null;
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

    this.pty.onExit((e) => {
      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit' }));
      }
      sessions.delete(this.id);
      // Notify on agent process exit (named agent:<id> sessions only).
      if (exitNotifier && this.name && this.name.startsWith('agent:')) {
        try { exitNotifier({ name: this.name, cwd: this.cwd, exitCode: e && e.exitCode }); } catch {}
      }
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

  write(data) {
    try { this.pty.write(data); this.lastActive = Date.now(); } catch { /* pty gone */ }
  }
  resize(cols, rows) {
    if (!cols || !rows) return;
    try { this.pty.resize(cols, rows); } catch { /* pty gone — ioctl EBADF on a dead fd */ }
  }
  kill() {
    try { this.pty.kill(); } catch { /* already dead */ }
  }
  rename(label) {
    this.label = label;
    this.lastActive = Date.now();
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'session', id: this.id, name: this.name, label: this.label }));
    }
  }

  // last N bytes of scrollback as a plain string (for agent card previews)
  tail(bytes = 4096) {
    const buf = this.scrollback;
    return buf.slice(Math.max(0, buf.length - bytes)).toString();
  }
}

// A "virtual" session — same client/scrollback/heartbeat machinery as a real
// PTY Session, but with NO process behind it. Used to mirror a Stan Chat
// conversation into the terminal: chat.js pushes an ANSI-formatted transcript in
// via appendOutput(), and keystrokes typed by a terminal client are line-
// buffered + locally echoed (there's no PTY to echo them) and handed back to the
// chat via onInput(). The PTY path above is deliberately left untouched.
class VirtualSession {
  constructor({ id, name = null, label = null, cwd = ROOT_DIR, onInput = null, onKill = null } = {}) {
    this.id = id;
    this.type = 'chat';
    this.name = name;
    this.label = label;
    this.cmd = 'chat';
    this.cwd = cwd;
    this.clients = new Set();
    this.scrollback = Buffer.alloc(0);
    this.lastActive = Date.now();
    this.createdAt = Date.now();
    this._lineBuf = '';
    this._onInput = typeof onInput === 'function' ? onInput : null;
    this._onKill = typeof onKill === 'function' ? onKill : null;
  }

  // The bridge: append text to the ring + broadcast it to attached terminals.
  // (The body of Session's pty.onData, minus the PTY.)
  appendOutput(text) {
    const data = String(text == null ? '' : text);
    if (!data) return;
    this._appendScrollback(data);
    this.lastActive = Date.now();
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data }));
    }
  }

  // No PTY to echo, so we line-buffer + local-echo printable chars ourselves and
  // fire onInput(line) on Enter. Handles CR/LF, backspace and Ctrl-C.
  write(data) {
    const s = String(data == null ? '' : data);
    for (const ch of s) {
      if (ch === '\r' || ch === '\n') {
        const line = this._lineBuf;
        this._lineBuf = '';
        this.appendOutput('\r\n');
        if (line.trim() && this._onInput) { try { this._onInput(line); } catch { /* chat gone */ } }
      } else if (ch === '\x7f' || ch === '\b') {
        if (this._lineBuf.length) { this._lineBuf = this._lineBuf.slice(0, -1); this.appendOutput('\b \b'); }
      } else if (ch === '\x03') {            // Ctrl-C — abandon the current line
        this._lineBuf = '';
        this.appendOutput('^C\r\n');
      } else if (ch >= ' ') {                // printable (incl. multi-byte)
        this._lineBuf += ch;
        this.appendOutput(ch);
      }
    }
    this.lastActive = Date.now();
  }

  resize() { /* no PTY — nothing to resize */ }

  // A terminal client asked to kill: tell that surface the process exited and
  // run any hook, but DON'T remove it from the Map — the chat owns its lifecycle.
  kill() {
    if (this._onKill) { try { this._onKill(); } catch {} }
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit' }));
    }
  }
}
// Reuse the PTY-free Session methods verbatim — same scrollback/attach/heartbeat.
for (const m of ['_appendScrollback', 'attach', 'detach', '_heartbeat', 'tail', 'rename']) {
  VirtualSession.prototype[m] = Session.prototype[m];
}

// Idempotent insert of a chat-mirror session into the shared sessions Map.
function registerVirtual({ id, name = null, label = null, cwd = ROOT_DIR, onInput = null, onKill = null } = {}) {
  if (!id) return null;
  const existing = sessions.get(id);
  if (existing) return existing;
  const s = new VirtualSession({ id, name, label, cwd, onInput, onKill });
  sessions.set(id, s);
  return s;
}

// Remove a chat mirror and tell any watchers the process exited.
function unregisterVirtual(id) {
  const s = sessions.get(id);
  if (!s) return;
  for (const ws of s.clients) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit' }));
  }
  sessions.delete(id);
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
  ws.send(JSON.stringify({ type: 'session', id: session.id, name: session.name, label: session.label }));

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
    label: s.label,
    cmd: s.cmd,
    cwd: s.cwd,
    type: s.type || 'shell',
    clients: s.clients.size,
    lastActive: s.lastActive,
    createdAt: s.createdAt,
  }));
}

function getSession(id) { return sessions.get(id) || null; }

function renameSession(id, label) {
  const session = getSession(id);
  if (!session) return null;
  session.rename(label);
  return session;
}

function killSession(id) {
  const session = getSession(id);
  if (!session) return null;
  if (session.type === 'chat') return null;   // chat mirrors are owned by chat.js — can't orphan one here
  session.kill();
  sessions.delete(id);
  return session;
}

module.exports = { handleWs, listSessions, getSession, renameSession, killSession, setExitNotifier, registerVirtual, unregisterVirtual };
