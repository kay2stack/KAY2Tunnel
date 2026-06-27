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
const term = require('./terminal');   // one-directional: terminal.js never requires chat.js, so no cycle
const { ROOT_DIR } = require('./config');

// Mirror typed keystrokes back into the chat as a real turn. Read-only mirror
// ships near-zero-risk; this flag (on by default) enables bidirectional input.
const MIRROR_INPUT = process.env.MIRROR_INPUT !== '0';

// Attachments from a phone/device land here (central, outside any repo) so a
// chat session can hand real files + images straight to Claude Code. Images are
// also injected inline as base64 image blocks so Claude *sees* them; every file
// is saved to disk so Claude can Read it with its tools too.
const UPLOAD_ROOT = path.join(ROOT_DIR, '.stanchat-uploads');
const upload = multer({ dest: '/tmp/stan-cli-uploads/', limits: { fileSize: 30 * 1024 * 1024, files: 8 } });
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// Cross-device-safe move. multer writes to /tmp (tmpfs on the Pi) but UPLOAD_ROOT
// lives on the SD card — a bare fs.renameSync throws EXDEV there, which silently
// dropped EVERY attachment (route returned files:[]). Fall back to copy+unlink.
function moveInto(src, dest) {
  try { fs.renameSync(src, dest); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dest);
    try { fs.unlinkSync(src); } catch {}
  }
}

// Run multer but turn its errors (esp. LIMIT_FILE_SIZE) into clean JSON instead
// of Express's default HTML 500 — the HTML made the client's r.json() throw,
// surfacing as "Attachment failed".
function attachUpload(req, res, next) {
  upload.array('files', 8)(req, res, err => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File too large (max 30 MB each)' : ('Upload error: ' + (err.message || err.code || 'failed')) });
  });
}
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

// ── Auto fast-mode + model routing ──────────────────────────────────────────
// Short/simple turns run on a snappy model; substantive turns use the user's
// default. On an unexpected crash we route to a more-available model so the
// resume is reliable. Only active while a chat is in "Auto" model mode (the
// default); picking a fixed model in the UI disables it.
const FAST_MODEL = 'sonnet';        // quick replies for short talk
const FULL_MODEL = null;            // null = the user's configured Claude default
const FALLBACK_MODEL = 'sonnet';    // routed to after an unexpected exit
function isShortTalk(text, atts) {
  if (atts && atts.length) return false;
  const t = String(text || '').trim();
  if (!t || t.length > 72 || /[\n`]/.test(t) || t[0] === '/') return false;
  if (t.split(/\s+/).length > 12) return false;
  if (/\b(build|fix|refactor|implement|debug|write|create|code|deploy|install|run|review|analy[sz]e|error|stack|trace|test|migrate)\b/i.test(t)) return false;
  return true;
}

class ChatSession {
  constructor({ name, cwd, model, permMode }) {
    this.id = uuid();
    this.name = (name && String(name).slice(0, 64)) || 'Chat';
    this.cwd = resolveCwd(cwd) || ROOT_DIR;
    this.model = model || null;
    this.autoModel = !model;   // Auto model mode on unless a fixed model was chosen
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
    this._liveTok = 0;            // running output-token estimate for the current turn
    this._tokAt = 0;              // last live-token broadcast (throttle)
    this._restarting = false;     // intentional respawn (model switch) — suppress 'exited'
    // Companion "virtual" terminal session — the same conversation, watchable and
    // typeable from the cockpit Terminal tab. Namespaced id avoids any clash with
    // bare-UUID PTY ids and lets the UI detect mirrors by prefix.
    this.mirrorId = 'chat:' + this.id;
    this._mirroredIids = new Set();
    this._registerMirror();
    this._spawn(false);
  }

  // ── Terminal mirror ───────────────────────────────────────────────────────
  _registerMirror() {
    try {
      const m = term.registerVirtual({
        id: this.mirrorId,
        name: 'chat:' + this.name,
        cwd: this.cwd,
        onInput: MIRROR_INPUT ? (line => this.send(line, [])) : null,
        onKill: () => {},
      });
      if (m) m.appendOutput(
        '\x1b[2m── Live mirror of Stan Chat · ' + this.name + ' ──\x1b[0m\r\n' +
        (MIRROR_INPUT
          ? '\x1b[2mType a message + Enter to send it into this chat.\x1b[0m\r\n\r\n'
          : '\x1b[2mRead-only transcript.\x1b[0m\r\n\r\n')
      );
    } catch { /* terminal module unavailable — mirror is best-effort */ }
  }

  // Render one transcript item as ANSI for the terminal mirror. Colours track the
  // xterm theme in public/term.js. Returns '' for nothing-to-show.
  _renderItem(item) {
    if (!item || !item.t) return '';
    const NL = s => String(s == null ? '' : s).replace(/\r?\n/g, '\r\n');
    switch (item.t) {
      case 'user': {
        const atts = (item.attachments || []).map(a => a.name).join(', ');
        const body = item.text && item.text !== '(attachment)' ? item.text : (atts ? '(attachment)' : '');
        const tail = atts ? '  \x1b[2m📎 ' + atts + '\x1b[0m' : '';
        return '\x1b[1;35m› \x1b[0m\x1b[1m' + NL(body) + '\x1b[0m' + tail + '\r\n\r\n';
      }
      case 'assistant': {
        const t = (item.text || '').trim();
        return t ? NL(t) + '\r\n\r\n' : '';
      }
      case 'tool_use': {
        const sum = item.summary ? ' \x1b[2m· ' + item.summary + '\x1b[0m' : '';
        return '\x1b[36m⚙ ' + (item.name || 'tool') + '\x1b[0m' + sum + '\r\n';
      }
      case 'tool_result': {
        let txt = (item.text || '').trim();
        if (!txt) return '';
        // Hard-truncate (~6 lines / ~400 chars) so a noisy tool can't eat the 256KB
        // terminal ring — the chat itself keeps the fuller 6000-char copy.
        txt = txt.split('\n').slice(0, 6).join('\n');
        if (txt.length > 400) txt = txt.slice(0, 400) + '…';
        const color = item.isError ? '\x1b[31m' : '\x1b[2m';
        return color + NL(txt) + '\x1b[0m\r\n';
      }
      case 'thinking': {
        const t = (item.text || '').trim();
        if (!t) return '';
        return '\x1b[2;3m' + t.split('\n')[0].slice(0, 200) + '\x1b[0m\r\n';
      }
      case 'system': {
        const color = item.level === 'error' ? '\x1b[31m' : item.level === 'warn' ? '\x1b[33m' : '\x1b[2m';
        return color + NL(item.text || '') + '\x1b[0m\r\n';
      }
      default: return '';
    }
  }

  // Append an item to the mirror, deduped by iid (a streamed assistant item is
  // finalized at two points — only mirror it once).
  _mirrorRender(item) {
    if (!item) return;
    if (item.iid != null) {
      if (this._mirroredIids.has(item.iid)) return;
      this._mirroredIids.add(item.iid);
    }
    const out = this._renderItem(item);
    if (!out) return;
    try {
      const m = term.getSession(this.mirrorId);
      if (m && typeof m.appendOutput === 'function') m.appendOutput(out);
    } catch {}
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
        category: 'reply',
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
      const wasBusy = this.busy;
      this.proc = null;
      this.busy = false;
      this._stream = null;
      if (this._restarting) { this._restarting = false; this.status = 'idle'; return; }  // model switch — not a real exit
      this.status = 'exited';
      this._broadcast({ type: 'status', status: this.status, lastResult: this.lastResult, exitCode: code });
      // Crashed mid-turn (Claude/Pi hiccup) → alert; it's resumable on the next send.
      if (wasBusy && code) {
        let _extra = '';
        if (this.autoModel && this.model !== FALLBACK_MODEL) { this.model = FALLBACK_MODEL; _extra = ' Routed to a more available model (' + FALLBACK_MODEL + ').'; }
        this._push({ t: 'system', level: 'error', text: 'Claude stopped unexpectedly (exit ' + code + '). Resend to resume — full context is kept.' + _extra });
        try { push.notify({ title: 'Stan · ' + this.name, body: 'Claude stopped mid-task — resend to resume.', tag: 'crash-' + this.id, url: '/stanchat/?c=' + this.id, category: 'error' }); } catch {}
      }
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

  // Live running output-token count while a turn builds (throttled).
  _emitTokens() {
    const t = now();
    if (t - this._tokAt < 350) return;
    this._tokAt = t;
    this._broadcast({ type: 'tokens', n: this._liveTok });
  }

  // Switch the model for subsequent turns. The model is a spawn arg, so we drop
  // the idle proc and let the next send() resume the SAME session (--resume keeps
  // full context) with the new --model. Guarded so the respawn doesn't surface as
  // a scary "session ended".
  setModel(model, isAuto) {
    if (model === 'auto') model = null;
    model = model ? String(model).slice(0, 80) : null;
    if (!isAuto) this.autoModel = (model == null);   // user choice toggles Auto mode
    if (model === this.model) return;
    this.model = model;
    if (this.proc && !this.busy) {
      this._restarting = true;
      try { this.proc.stdin.end(); } catch {}
      try { this.proc.kill('SIGTERM'); } catch {}
      this.proc = null;
    }
    this.lastActive = now();
    this._broadcast({ type: 'meta', meta: this.meta() });
  }

  // Rename the chat (affects the topbar, sessions list and fleet card). Pure
  // metadata — never touches the live process or its context.
  setName(name) {
    name = String(name || '').trim().slice(0, 64);
    if (!name || name === this.name) return false;
    this.name = name;
    this.lastActive = now();
    try {
      const m = term.getSession(this.mirrorId);
      if (m) { m.name = 'chat:' + name; if (typeof m.rename === 'function') m.rename(name); }
    } catch {}
    this._broadcast({ type: 'meta', meta: this.meta() });
    return true;
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
        this._liveTok += Math.ceil((d.text || '').length / 4);   // ~4 chars/token
        this._emitTokens();
        this._update(this._stream);
      }
    } else if (event.type === 'content_block_stop') {
      if (this._stream) { this._stream.streaming = false; this._update(this._stream); this._mirrorRender(this._stream); this._stream = null; }
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
          this._mirrorRender(this._stream);
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
    // Mirror to the terminal — but NOT the streaming assistant stub (per-token
    // growth would flood the ring). Streamed prose is mirrored once on finalize.
    if (!(item.t === 'assistant' && item.streaming)) this._mirrorRender(item);
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
    // Auto fast-mode: snappy model for short/simple turns, default for substantive ones.
    if (this.autoModel) {
      const want = isShortTalk(text, atts) ? FAST_MODEL : FULL_MODEL;
      if (want !== this.model) this.setModel(want, true);
    }
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
    this._liveTok = 0; this._tokAt = 0;        // fresh token count for this turn
    this._alertedSilence = false;              // reset watchdog for the new turn
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
    try { term.unregisterVirtual(this.mirrorId); } catch {}
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

// Health watchdog — a chat stuck "thinking" with no output for a long stretch is
// probably wedged (Claude/Pi hiccup). Alert once per turn; do NOT kill, since a
// single long tool (build, install) is legitimately quiet. Real crashes are
// caught by the proc 'exit' handler, which pushes + leaves the chat resumable.
const SILENCE_MS = 8 * 60 * 1000;
setInterval(() => {
  const t = now();
  for (const s of sessions.values()) {
    if (s.busy && s.status === 'thinking' && s.proc && (t - s.lastActive) > SILENCE_MS && !s._alertedSilence) {
      s._alertedSilence = true;
      const mins = Math.round((t - s.lastActive) / 60000);
      s._push({ t: 'system', level: 'warn', text: `Still working — no update for ${mins}m. Tap Stop if it looks wedged.` });
      try { push.notify({ title: 'Stan · ' + s.name, body: `Working ${mins}m with no update — tap to check.`, tag: 'silence-' + s.id, url: '/stanchat/?c=' + s.id, category: 'work' }); } catch {}
    }
  }
}, 60 * 1000).unref?.();

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
    if (m.type === 'send')          session.send(m.text, m.attachments);
    else if (m.type === 'kill')     session.kill();
    else if (m.type === 'setModel') session.setModel(m.model);
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
router.patch('/:id', express.json(), (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  if (name.length > 64) return res.status(400).json({ error: 'Name is too long' });
  s.setName(name);
  res.json({ ok: true, id: s.id, name: s.name });
});
router.delete('/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.destroy();
  res.json({ ok: true });
});

// Attach files/photos from a device → saved under UPLOAD_ROOT/<sessionId>/.
// Returns sanitized descriptors; the client passes these back on the next send.
router.post('/:id/attach', attachUpload, (req, res) => {
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
      moveInto(f.path, dest);
      files.push({ name: nm, isImage: !!mediaTypeFor(nm), mediaType: mediaTypeFor(nm), size: f.size });
    } catch (e) { console.error('[attach] save failed:', e.code || e.message); try { fs.unlinkSync(f.path); } catch {} }
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
