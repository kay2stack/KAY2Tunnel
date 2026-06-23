// server/chat.js — Claude Code as a chat surface ("Stan Chat").
//
// Instead of running Claude Code inside the xterm TUI, we drive it headless in
// stream-json mode and render its events as a proper chat (bubbles + tool-call
// cards) — the Claude iOS-app experience.
//
// One `claude` process stays alive per chat: persistent + reattachable, exactly
// like terminal.js. We assign the session id up front (`--session-id <uuid>`),
// so a dead process can be brought back with `--resume <uuid>` (full context
// intact) — the reliability win KAY2Tunnel is built around.
//
//   stdin  : {type:'user', message:{role,content:[{type:'text',text}]}}  per turn
//   stdout : a stream of JSON events (system/init, assistant, user, result, and
//            partial stream_event deltas) which we normalize into chat items.

const express = require('express');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const push = require('./push');
const { ROOT_DIR } = require('./config');

// Attachments from a phone/device land here (central, outside any repo) so a
// chat session can hand real files + images straight to Claude Code. Images are
// also injected inline as base64 image blocks so Claude *sees* them; every file
// is saved to disk so Claude can Read it with its tools too.
const UPLOAD_ROOT = path.join(ROOT_DIR, '.stanchat-uploads');
const upload = multer({ dest: '/tmp/stan-cli-uploads/', limits: { fileSize: 12 * 1024 * 1024, files: 8 } });
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const mediaTypeFor = n => IMAGE_TYPES[path.extname(String(n || '')).toLowerCase()] || null;
const safeName = n => (String(n || 'file').replace(/[\\/]/g, '_').replace(/[^\w.\- ]/g, '').slice(0, 120) || 'file');

// Resolve the claude binary robustly — pm2's PATH may not include ~/.local/bin.
const CLAUDE_BIN = (() => {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const candidates = [
    path.join(process.env.HOME || '/home/kay2', '.local/bin/claude'),
    '/usr/local/bin/claude',
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return 'claude';
})();

const MAX_TRANSCRIPT = 500;                  // normalized items kept per chat
const IDLE_TTL_MS = 1000 * 60 * 60 * 8;      // reap idle, process-less chats after 8h
const PERM_MODES = new Set(['plan', 'acceptEdits', 'bypassPermissions', 'default']);

const sessions = new Map();   // id -> ChatSession

const now = () => Date.now();
const uuid = () => crypto.randomUUID();

function resolveCwd(p) {
  if (!p) return ROOT_DIR;
  const raw = String(p).trim();
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + path.sep)) return null;
  return resolved;
}

// Short human label for a tool call, shown as the card subtitle.
function toolSummary(name, input) {
  const i = input || {};
  const base = p => (p ? String(p).split('/').pop() : '');
  try {
    switch (name) {
      case 'Bash':      return String(i.command || '').split('\n')[0].slice(0, 140);
      case 'Read':      return base(i.file_path);
      case 'Write':     return base(i.file_path);
      case 'Edit':
      case 'MultiEdit': return base(i.file_path);
      case 'Glob':      return i.pattern || '';
      case 'Grep':      return i.pattern || '';
      case 'WebFetch':  return i.url || '';
      case 'WebSearch': return i.query || '';
      case 'Task':      return i.description || i.subagent_type || '';
      case 'TodoWrite': return (i.todos ? i.todos.length + ' items' : '');
      default:
        const s = JSON.stringify(i);
        return s.length > 120 ? s.slice(0, 120) + '…' : (s === '{}' ? '' : s);
    }
  } catch { return ''; }
}

// Flatten a tool_result content payload (string | array of blocks) to text.
function resultText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => (typeof b === 'string' ? b : (b && b.text) || '')).join('');
  }
  if (typeof content === 'object' && content.text) return content.text;
  return '';
}

class ChatSession {
  constructor({ name, cwd, model, permMode }) {
    this.id = uuid();
    this.name = (name && String(name).slice(0, 64)) || 'Chat';
    this.cwd = resolveCwd(cwd) || ROOT_DIR;
    this.model = model || null;
    // Safe-by-default: read-only 'plan' unless the user explicitly opts into a
    // writing/autonomous mode per chat in the UI. Autopilot is never the default.
    this.permMode = PERM_MODES.has(permMode) ? permMode : 'plan';
    this.createdAt = now();
    this.lastActive = now();
    this.clients = new Set();
    this.transcript = [];
    this.status = 'starting';     // starting | idle | thinking | exited | error
    this.busy = false;
    this.proc = null;
    this.stdoutBuf = '';
    this.claudeSessionId = this.id;
    this.lastResult = null;       // { costUsd, durationMs, usage }
    this._iid = 0;
    this._stream = null;          // current streaming assistant item
    this._everStarted = false;
    this._spawn(false);
  }

  meta() {
    return {
      id: this.id, name: this.name, cwd: this.cwd,
      model: this.model, permMode: this.permMode, status: this.status,
      busy: this.busy, lastResult: this.lastResult,
      createdAt: this.createdAt, lastActive: this.lastActive,
      clients: this.clients.size, items: this.transcript.length,
      lastText: this._lastText(),     // live one-line preview for the fleet grid
    };
  }

  // Newest meaningful line in the transcript — assistant prose preferred, else
  // the user's last message — for the fleet card preview.
  _lastText() {
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const it = this.transcript[i];
      if (it.t === 'assistant' && it.text && it.text.trim())
        return it.text.replace(/\s+/g, ' ').trim().slice(0, 160);
      if (it.t === 'tool_use')
        return '⚙ ' + (it.name || 'tool') + (it.summary ? ' · ' + it.summary : '');
      if (it.t === 'user' && it.text && it.text.trim())
        return '› ' + it.text.replace(/\s+/g, ' ').trim().slice(0, 140);
    }
    return '';
  }

  // Turn finished and NO client is attached → the user walked away (locked the
  // phone, backgrounded the app — iOS drops the socket). Push so they can rein in
  // an autopilot from anywhere. If someone's watching live, stay silent.
  _notifyDone() {
    if (this.clients.size > 0) return;
    try {
      push.notify({
        title: 'Stan · ' + this.name,
        body: (this._lastText() || 'Turn complete — tap to open').slice(0, 180),
        tag: 'chat-' + this.id,
        url: '/stanchat/?c=' + this.id,
      });
    } catch {}
  }

  _spawn(resume) {
    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode', this.permMode,
    ];
    if (resume) args.push('--resume', this.id);
    else        args.push('--session-id', this.id);
    if (this.model) args.push('--model', this.model);
    args.push('--append-system-prompt',
      'You are running inside Stan Chat — a mobile chat surface for Claude Code on the kay2 ' +
      'Raspberry Pi (the Stan CLI cockpit). Keep replies concise and easy to read on a phone.');

    try {
      this.proc = spawn(CLAUDE_BIN, args, {
        cwd: this.cwd,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      this.status = 'error';
      this._push({ t: 'system', level: 'error', text: 'Failed to start Claude: ' + e.message });
      return;
    }

    this._everStarted = true;
    this.status = this.busy ? 'thinking' : 'idle';
    this.stdoutBuf = '';

    this.proc.stdout.on('data', d => this._onStdout(d));
    this.proc.stderr.on('data', d => {
      const s = d.toString();
      // claude logs assorted diagnostics to stderr; only surface real errors.
      if (/error|fatal|unauthorized|invalid|not found/i.test(s)) {
        this._push({ t: 'system', level: 'warn', text: s.trim().slice(0, 300) });
      }
    });
    this.proc.on('exit', (code) => {
      this.proc = null;
      this.busy = false;
      this._stream = null;
      this.status = 'exited';
      this._broadcast({ type: 'status', status: this.status, lastResult: this.lastResult, exitCode: code });
    });
    this.proc.on('error', (e) => {
      this.status = 'error';
      this._push({ t: 'system', level: 'error', text: 'Claude process error: ' + e.message });
    });
    this._broadcast({ type: 'meta', meta: this.meta() });
  }

  // Ensure a live process exists, resuming if a previous one exited.
  _ensureProc() {
    if (this.proc) return;
    this._spawn(this._everStarted);   // resume if we've run before
  }

  _onStdout(buf) {
    this.stdoutBuf += buf.toString();
    let nl;
    while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      try { this._handle(ev); } catch (e) { /* defensive: never let one bad event kill the stream */ }
    }
  }

  _handle(ev) {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          if (ev.session_id) this.claudeSessionId = ev.session_id;
          if (ev.model) this.model = ev.model;
          this.status = this.busy ? 'thinking' : 'idle';
          this._broadcast({ type: 'meta', meta: this.meta() });
        }
        break;

      case 'stream_event':
        this._handleStream(ev.event);
        break;

      case 'assistant':
        this._handleAssistant(ev.message);
        break;

      case 'user':
        this._handleToolResults(ev.message);
        break;

      case 'result':
        this.busy = false;
        this.status = 'idle';
        this._stream = null;
        this.lastResult = {
          costUsd: ev.total_cost_usd ?? null,
          durationMs: ev.duration_ms ?? null,
          usage: ev.usage || null,
          subtype: ev.subtype || null,
        };
        if (ev.subtype && ev.subtype !== 'success') {
          this._push({ t: 'system', level: 'warn', text: 'Turn ended: ' + ev.subtype });
        }
        this._broadcast({ type: 'status', status: this.status, lastResult: this.lastResult });
        this._notifyDone();
        break;
    }
  }

  // Token-level streaming (--include-partial-messages) for the live-typing feel.
  _handleStream(event) {
    if (!event) return;
    if (event.type === 'content_block_start') {
      const b = event.content_block;
      if (b && b.type === 'text') {
        this._stream = this._push({ t: 'assistant', text: '', streaming: true });
      } else { this._stream = null; }   // tool_use/thinking handled via full messages
    } else if (event.type === 'content_block_delta') {
      const d = event.delta;
      if (d && d.type === 'text_delta' && this._stream) {
        this._stream.text += d.text || '';
        this._update(this._stream);
      }
    } else if (event.type === 'content_block_stop') {
      if (this._stream) { this._stream.streaming = false; this._update(this._stream); this._stream = null; }
    }
  }

  _handleAssistant(msg) {
    if (!msg || !Array.isArray(msg.content)) return;
    this.status = 'thinking'; this.busy = true;
    for (const block of msg.content) {
      if (block.type === 'text') {
        if (this._stream) {
          // finalize the streamed item with authoritative text
          this._stream.text = block.text || this._stream.text;
          this._stream.streaming = false;
          this._update(this._stream);
          this._stream = null;
        } else if ((block.text || '').trim()) {
          this._push({ t: 'assistant', text: block.text, streaming: false });
        }
      } else if (block.type === 'thinking') {
        if ((block.thinking || '').trim())
          this._push({ t: 'thinking', text: block.thinking });
      } else if (block.type === 'tool_use') {
        this._push({
          t: 'tool_use', toolId: block.id, name: block.name,
          input: block.input || {}, summary: toolSummary(block.name, block.input),
        });
      }
    }
    this._broadcast({ type: 'status', status: this.status, lastResult: this.lastResult });
  }

  _handleToolResults(msg) {
    if (!msg || !Array.isArray(msg.content)) return;
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        const text = resultText(block.content);
        this._push({
          t: 'tool_result', forId: block.tool_use_id,
          isError: !!block.is_error,
          text: text.length > 6000 ? text.slice(0, 6000) + '\n… (truncated)' : text,
        });
      }
    }
  }

  // ── transcript helpers ──────────────────────────────────────────────────
  _push(item) {
    item.iid = ++this._iid;
    item.ts = now();
    this.transcript.push(item);
    if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.shift();
    this.lastActive = now();
    this._broadcast({ type: 'item', item });
    return item;
  }
  _update(item) {
    this.lastActive = now();
    this._broadcast({ type: 'item', item });
  }
  _broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) { try { ws.send(s); } catch {} }
  }

  // ── public API ──────────────────────────────────────────────────────────
  // text          — the user's message (may be empty if attachments-only)
  // attachments[] — [{ name, isImage, mediaType }] already uploaded via /attach;
  //                 bytes are read from disk here, never trusted from the client.
  send(text, attachments) {
    text = String(text || '').trim();
    const atts = Array.isArray(attachments) ? attachments : [];
    if (!text && !atts.length) return;
    this._ensureProc();
    if (!this.proc) return;

    const sessionDir = path.join(UPLOAD_ROOT, this.id);
    const content = [];        // content blocks sent to Claude
    const display = [];        // {name,isImage} echoed into the transcript
    const noteLines = [];      // path hints so Claude can Read non-image files

    for (const a of atts) {
      const nm = safeName(a && a.name);
      const abs = path.join(sessionDir, nm);
      if (!abs.startsWith(sessionDir + path.sep)) continue;   // jail
      let ok = false; try { ok = fs.statSync(abs).isFile(); } catch {}
      if (!ok) continue;
      const mt = mediaTypeFor(nm);
      if (mt) {
        try {
          const data = fs.readFileSync(abs).toString('base64');
          content.push({ type: 'image', source: { type: 'base64', media_type: mt, data } });
          noteLines.push(`• image "${nm}" (also saved at ${abs})`);
          display.push({ name: nm, isImage: true });
        } catch {}
      } else {
        noteLines.push(`• file: ${abs}`);
        display.push({ name: nm, isImage: false });
      }
    }

    let claudeText = text;
    if (noteLines.length) {
      claudeText = (text ? text + '\n\n' : '') +
        'Attached from my device (already on disk — read them with your tools):\n' + noteLines.join('\n');
    }
    if (claudeText) content.unshift({ type: 'text', text: claudeText });
    if (!content.length) return;

    this._push({ t: 'user', text: text || '(attachment)', attachments: display });
    this.busy = true; this.status = 'thinking';
    this._broadcast({ type: 'status', status: this.status });
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
    try { this.proc.stdin.write(line); } catch (e) {
      this._push({ t: 'system', level: 'error', text: 'Could not send: ' + e.message });
    }
  }

  attach(ws) {
    this.clients.add(ws);
    this.lastActive = now();
    try {
      ws.send(JSON.stringify({ type: 'meta', meta: this.meta() }));
      ws.send(JSON.stringify({ type: 'snapshot', transcript: this.transcript }));
    } catch {}
  }
  detach(ws) { this.clients.delete(ws); this.lastActive = now(); }

  kill() {
    if (this.proc) { try { this.proc.stdin.end(); } catch {} try { this.proc.kill('SIGTERM'); } catch {} }
    this.proc = null;
    this.status = 'exited';
  }
  destroy() {
    this.kill();
    try { fs.rmSync(path.join(UPLOAD_ROOT, this.id), { recursive: true, force: true }); } catch {}
    sessions.delete(this.id);
  }
}

// ── manager ─────────────────────────────────────────────────────────────────
function create(opts) {
  const s = new ChatSession(opts || {});
  sessions.set(s.id, s);
  return s;
}
function get(id) { return sessions.get(id); }
function list() {
  return [...sessions.values()]
    .sort((a, b) => b.lastActive - a.lastActive)
    .map(s => s.meta());
}

// Reap idle, process-less chats so memory doesn't grow unbounded.
setInterval(() => {
  const t = now();
  for (const s of sessions.values()) {
    if (!s.proc && s.clients.size === 0 && (t - s.lastActive) > IDLE_TTL_MS) s.destroy();
  }
}, 1000 * 60 * 30).unref?.();

// ── WebSocket ───────────────────────────────────────────────────────────────
function handleChatWs(ws, req) {
  const url = new URL(req.url, 'http://x');
  const q = url.searchParams;
  let session = null;

  const wantId = q.get('session');
  if (wantId && sessions.has(wantId)) {
    session = sessions.get(wantId);
  } else {
    session = create({
      name: q.get('name'),
      cwd: q.get('cwd'),
      model: q.get('model'),
      permMode: q.get('mode'),
    });
  }
  session.attach(ws);

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'send')      session.send(m.text, m.attachments);
    else if (m.type === 'kill') session.kill();
  });
  ws.on('close', () => session.detach(ws));
  ws.on('error', () => session.detach(ws));
}

// ── REST ────────────────────────────────────────────────────────────────────
const router = express.Router();
router.get('/', (req, res) => res.json(list()));
router.post('/', express.json(), (req, res) => {
  const cwd = resolveCwd(req.body?.cwd);
  if (cwd === null) return res.status(400).json({ error: 'Path outside home directory' });
  const s = create({ name: req.body?.name, cwd: req.body?.cwd, model: req.body?.model, permMode: req.body?.mode });
  res.json({ id: s.id, meta: s.meta() });
});
router.delete('/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.destroy();
  res.json({ ok: true });
});

// Attach files/photos from a device → saved under UPLOAD_ROOT/<sessionId>/.
// Returns sanitized descriptors; the client passes these back on the next send.
router.post('/:id/attach', upload.array('files', 8), (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) { (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch {} }); return res.status(404).json({ error: 'No such chat' }); }
  const dir = path.join(UPLOAD_ROOT, s.id);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const files = [];
  for (const f of (req.files || [])) {
    const nm = safeName(f.originalname);
    const dest = path.join(dir, nm);
    if (!dest.startsWith(dir + path.sep)) { try { fs.unlinkSync(f.path); } catch {} continue; }
    try {
      fs.renameSync(f.path, dest);
      files.push({ name: nm, isImage: !!mediaTypeFor(nm), mediaType: mediaTypeFor(nm), size: f.size });
    } catch { try { fs.unlinkSync(f.path); } catch {} }
  }
  res.json({ files });
});

// Serve a stored attachment back (thumbnails / re-view across devices). Jailed.
router.get('/:id/file/:name', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).end();
  const dir = path.join(UPLOAD_ROOT, s.id);
  const abs = path.join(dir, safeName(req.params.name));
  if (!abs.startsWith(dir + path.sep)) return res.status(400).end();
  fs.stat(abs, (e, st) => {
    if (e || !st.isFile()) return res.status(404).end();
    res.sendFile(abs);
  });
});

// REST send — used by the fleet fan-out (one prompt → many agents) without
// opening a WebSocket to each new session.
router.post('/:id/send', express.json({ limit: '256kb' }), (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'No such chat' });
  s.send(req.body?.text, req.body?.attachments);
  res.json({ ok: true });
});

module.exports = { router, handleChatWs, create, get, list };
