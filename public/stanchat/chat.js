// Stan Chat — standalone Claude Code chat client.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const LS = {
    token: 'stan_token',
    last:  'stanchat_last',
    mode:  'stanchat_mode',
    model: 'stanchat_model',
    dir:   'stanchat_dir',
    dirLabel: 'stanchat_dirlabel',
  };

  let token = localStorage.getItem(LS.token) || '';
  let ws = null, wsClosedByUs = false, reconnectDelay = 500;
  let sessionId = null;
  let meta = null;
  const items = new Map();     // iid -> element
  const toolCards = new Map(); // toolId -> card element

  // new-chat config (persisted)
  let cfg = {
    mode: localStorage.getItem(LS.mode) || 'plan',
    model: localStorage.getItem(LS.model) || '',
    dir: localStorage.getItem(LS.dir) || '',
    dirLabel: localStorage.getItem(LS.dirLabel) || 'Home',
  };

  const MODES = [
    { v: 'plan',              label: 'Plan',      note: 'Read-only. Claude explores & proposes but runs nothing.' },
    { v: 'acceptEdits',      label: 'Auto-edits', note: 'Auto-approves file edits; still asks for risky commands.' },
    { v: 'bypassPermissions', label: 'Autopilot', note: 'Full autonomy — runs commands & edits with no gate. Like your terminal agents.' },
  ];
  const MODELS = [
    { v: '', label: 'Default' },
    { v: 'sonnet', label: 'Sonnet' },
    { v: 'opus', label: 'Opus' },
    { v: 'haiku', label: 'Haiku' },
  ];
  const modeLabel = v => (MODES.find(m => m.v === v) || MODES[0]).label;

  const TOOL_STYLE = {
    Bash:      { g: '›_', c: '#0E0C15' },
    Read:      { g: '◰',  c: '#007AFF' },
    Write:     { g: '✎',  c: '#34C759' },
    Edit:      { g: '✎',  c: '#FF9500' },
    MultiEdit: { g: '✎',  c: '#FF9500' },
    Glob:      { g: '⌕',  c: '#5856D6' },
    Grep:      { g: '⌕',  c: '#5856D6' },
    WebFetch:  { g: '🌐', c: '#00A0B0' },
    WebSearch: { g: '🔎', c: '#00A0B0' },
    Task:      { g: '◈',  c: '#FF3B5C' },
    TodoWrite: { g: '☑',  c: '#8E8E93' },
  };
  const toolStyle = n => TOOL_STYLE[n] || { g: '⚙', c: '#8E8E93' };

  // ── Auth ──────────────────────────────────────────────
  function showAuth() { $('auth-screen').classList.remove('hidden'); $('app').classList.add('hidden'); }
  function showApp() { $('auth-screen').classList.add('hidden'); $('app').classList.remove('hidden'); }

  async function tryToken(t) {
    const r = await fetch('/api/chat', { headers: { Authorization: 'Bearer ' + t } });
    return r.ok;
  }
  async function doLogin() {
    const t = $('token-input').value.trim();
    if (!t) return;
    if (await tryToken(t)) {
      token = t; localStorage.setItem(LS.token, t);
      $('auth-error').classList.add('hidden');
      boot();
    } else {
      $('auth-error').classList.remove('hidden');
    }
  }

  function api(path, opts = {}) {
    return fetch(path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } })
      .then(r => { if (r.status === 401) { localStorage.removeItem(LS.token); token = ''; showAuth(); throw new Error('401'); } return r; });
  }

  // ── WebSocket ─────────────────────────────────────────
  function wsUrl(forNew) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let u = `${proto}://${location.host}/ws/chat?token=${encodeURIComponent(token)}`;
    if (forNew) {
      u += `&name=${encodeURIComponent(cfg.dirLabel)}` +
           `&cwd=${encodeURIComponent(cfg.dir)}` +
           `&model=${encodeURIComponent(cfg.model)}` +
           `&mode=${encodeURIComponent(cfg.mode)}`;
    } else if (sessionId) {
      u += `&session=${encodeURIComponent(sessionId)}`;
    }
    return u;
  }

  function connect(forNew) {
    wsClosedByUs = true;
    if (ws) { try { ws.close(); } catch {} }
    wsClosedByUs = false;
    setStatus('connecting');
    ws = new WebSocket(wsUrl(forNew));
    ws.onopen = () => { reconnectDelay = 500; };
    ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => {
      if (wsClosedByUs) return;
      setStatus('offline');
      setTimeout(() => connect(false), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function onMsg(m) {
    if (m.type === 'meta') {
      meta = m.meta; sessionId = meta.id;
      localStorage.setItem(LS.last, sessionId);
      renderMeta();
    } else if (m.type === 'snapshot') {
      clearThread();
      m.transcript.forEach(renderItem);
      scrollDown(true);
    } else if (m.type === 'item') {
      renderItem(m.item);
      scrollDown();
    } else if (m.type === 'status') {
      if (meta) { meta.status = m.status; if (m.lastResult) meta.lastResult = m.lastResult; }
      renderMeta();
      if (m.lastResult) renderCost(m.lastResult);
    }
  }

  // ── Rendering ─────────────────────────────────────────
  function clearThread() { items.clear(); toolCards.clear(); $('thread').innerHTML = ''; }

  function hideEmpty() { const e = $('empty-state'); if (e) e.remove(); }

  function renderItem(it) {
    if (it.t === 'tool_result') return attachResult(it);
    hideEmpty();
    let el = items.get(it.iid);
    if (!el) {
      el = document.createElement('div');
      $('thread').appendChild(el);
      items.set(it.iid, el);
    }
    if (it.t === 'tool_use') return renderTool(el, it);
    el.className = 'msg ' + it.t + (it.level ? ' ' + it.level : '');
    const inner = it.t === 'assistant' ? mdToHtml(it.text) + (it.streaming ? '<span class="streaming-caret"></span>' : '')
                : it.t === 'user'      ? esc(it.text).replace(/\n/g, '<br>')
                : it.t === 'thinking'  ? '💭 ' + esc(it.text)
                : esc(it.text);
    el.innerHTML = `<div class="bubble">${inner}</div>`;
    if (it.t === 'assistant') wireCopies(el);
  }

  function renderTool(el, it) {
    el.className = 'msg tool';
    const st = toolStyle(it.name);
    el.innerHTML = `
      <div class="tool-card" data-tool="${esc(it.toolId)}">
        <div class="tool-head">
          <div class="tool-badge" style="background:${st.c}">${st.g}</div>
          <div class="tool-info">
            <div class="tool-name">${esc(it.name)}</div>
            ${it.summary ? `<div class="tool-sum">${esc(it.summary)}</div>` : ''}
          </div>
          <div class="tool-state run" title="running"></div>
          <div class="tool-chevron">▸</div>
        </div>
        <div class="tool-body">
          ${Object.keys(it.input || {}).length ? `<div class="tool-input">${esc(prettyInput(it))}</div>` : ''}
          <pre class="tool-out" style="display:none"></pre>
        </div>
      </div>`;
    const card = el.querySelector('.tool-card');
    toolCards.set(it.toolId, card);
    card.querySelector('.tool-head').addEventListener('click', () => card.classList.toggle('open'));
  }

  function prettyInput(it) {
    const i = it.input || {};
    if (it.name === 'Bash' && i.command) return i.command;
    if ((it.name === 'Write' || it.name === 'Edit') && i.file_path) {
      return i.file_path + (i.content ? '\n\n' + i.content.slice(0, 1200) : '');
    }
    try { return JSON.stringify(i, null, 2); } catch { return ''; }
  }

  function attachResult(it) {
    const card = toolCards.get(it.forId);
    if (!card) return;
    const state = card.querySelector('.tool-state');
    state.className = 'tool-state ' + (it.isError ? 'err' : 'ok');
    state.title = it.isError ? 'error' : 'done';
    const out = card.querySelector('.tool-out');
    if (it.text && it.text.trim()) {
      out.textContent = it.text;
      out.style.display = '';
    }
  }

  function renderMeta() {
    if (!meta) return;
    $('chat-name').textContent = meta.name || 'Stan Chat';
    const dot = $('status-dot'), txt = $('status-text');
    const s = meta.status || 'offline';
    dot.className = 'status-dot ' + (s === 'thinking' ? 'thinking' : s === 'exited' ? 'exited' : s === 'idle' ? 'idle' : '');
    txt.textContent = s === 'thinking' ? 'thinking…' : s === 'idle' ? 'ready' : s === 'exited' ? 'session ended' : s;
    $('chip-project-v').textContent = (meta.cwd || '~').split('/').pop() || '~';
    $('chip-mode-v').textContent = modeLabel(meta.permMode);
    $('send-btn').disabled = false;
  }
  function setStatus(s) {
    const dot = $('status-dot'), txt = $('status-text');
    if (dot) dot.className = 'status-dot';
    if (txt) txt.textContent = s;
  }
  function renderCost(lr) {
    if (!lr || lr.costUsd == null) return;
    const sec = lr.durationMs ? (lr.durationMs / 1000).toFixed(1) + 's' : '';
    $('meta-cost').textContent = `$${lr.costUsd.toFixed(4)} · ${sec}`;
  }

  function scrollDown(force) {
    const t = $('thread');
    if (force || (t.scrollHeight - t.scrollTop - t.clientHeight) < 200) {
      requestAnimationFrame(() => { t.scrollTop = t.scrollHeight; });
    }
  }

  // ── tiny markdown ─────────────────────────────────────
  function mdToHtml(src) {
    src = String(src || '');
    const blocks = [];
    src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const i = blocks.push(`<pre><button class="copy" data-code="${esc(code)}">Copy</button><code>${esc(code)}</code></pre>`) - 1;
      return ` ${i} `;
    });
    let html = esc(src)
      .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/^### (.*)$/gm, '<strong>$1</strong>')
      .replace(/^## (.*)$/gm, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    html = html.replace(/ (\d+) /g, (_, i) => blocks[+i]);
    return html;
  }
  function wireCopies(scope) {
    scope.querySelectorAll('.copy').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard?.writeText(b.dataset.code);
      b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200);
    }));
  }

  // ── Composer ──────────────────────────────────────────
  function send() {
    const ta = $('prompt');
    const text = ta.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== 1) { connect(!sessionId); setTimeout(send, 400); return; }
    ws.send(JSON.stringify({ type: 'send', text }));
    ta.value = ''; autoGrow(ta);
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }

  // ── Drawer ────────────────────────────────────────────
  function openDrawer(mode) {
    $('drawer').classList.remove('hidden');
    if (mode === 'new') renderNewChat(); else renderSessions();
  }
  function closeDrawer() { $('drawer').classList.add('hidden'); }

  async function renderSessions() {
    $('drawer-title').textContent = 'Chats';
    const body = $('drawer-body');
    body.innerHTML = '<div class="mode-note">Loading…</div>';
    let list = [];
    try { list = await api('/api/chat').then(r => r.json()); } catch { return; }
    const rows = list.map(s => {
      const when = timeAgo(s.lastActive);
      const dir = (s.cwd || '~').split('/').pop();
      const stat = s.status === 'thinking' ? '● thinking' : s.status === 'idle' ? 'ready' : s.status;
      return `<div class="sess-row" data-id="${esc(s.id)}">
        <div class="sess-icon">◉</div>
        <div class="sess-info">
          <div class="sess-name">${esc(s.name)} <span style="color:var(--text-dim);font-weight:400">· ${esc(dir)}</span></div>
          <div class="sess-meta">${esc(modeLabel(s.permMode))} · ${esc(stat)} · ${esc(when)}</div>
        </div>
        <button class="sess-del" data-del="${esc(s.id)}">✕</button>
      </div>`;
    }).join('');
    body.innerHTML = (rows || '<div class="mode-note">No chats yet. Tap “New chat” to start one.</div>') +
      `<button class="drawer-cta" id="cta-new">New chat</button>`;
    body.querySelectorAll('.sess-row').forEach(r => r.addEventListener('click', e => {
      if (e.target.closest('[data-del]')) return;
      sessionId = r.dataset.id; closeDrawer(); connect(false);
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await api('/api/chat/' + b.dataset.del, { method: 'DELETE' }).catch(() => {});
      if (b.dataset.del === sessionId) { sessionId = null; localStorage.removeItem(LS.last); clearThread(); }
      renderSessions();
    }));
    $('cta-new').addEventListener('click', () => renderNewChat());
  }

  async function renderNewChat() {
    $('drawer-title').textContent = 'New chat';
    const body = $('drawer-body');
    let dirs = [{ label: 'Home', path: '' }];
    try { dirs = await api('/api/agents/launch-dirs').then(r => r.json()); } catch {}
    const dirOpts = dirs.map(d => `<button class="opt ${cfg.dir === d.path ? 'sel' : ''}" data-dir="${esc(d.path)}" data-label="${esc(d.label)}">${esc(d.label)}</button>`).join('');
    const modelOpts = MODELS.map(m => `<button class="opt ${cfg.model === m.v ? 'sel' : ''}" data-model="${esc(m.v)}">${esc(m.label)}</button>`).join('');
    const modeOpts = MODES.map(m => `<button class="opt ${cfg.mode === m.v ? 'sel' : ''}" data-mode="${esc(m.v)}">${esc(m.label)}</button>`).join('');
    body.innerHTML = `
      <div class="drawer-section-label">Project</div><div class="opt-grid">${dirOpts}</div>
      <div class="drawer-section-label">Model</div><div class="opt-grid">${modelOpts}</div>
      <div class="drawer-section-label">Permissions</div><div class="opt-grid">${modeOpts}</div>
      <div class="mode-note" id="mode-note"></div>
      <button class="drawer-cta" id="start-chat">Start chat</button>`;
    const updateNote = () => { $('mode-note').textContent = (MODES.find(m => m.v === cfg.mode) || {}).note || ''; };
    updateNote();
    body.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
      cfg.dir = b.dataset.dir; cfg.dirLabel = b.dataset.label;
      body.querySelectorAll('[data-dir]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    body.querySelectorAll('[data-model]').forEach(b => b.addEventListener('click', () => {
      cfg.model = b.dataset.model;
      body.querySelectorAll('[data-model]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      cfg.mode = b.dataset.mode;
      body.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('sel', x === b));
      updateNote();
    }));
    $('start-chat').addEventListener('click', () => {
      localStorage.setItem(LS.mode, cfg.mode); localStorage.setItem(LS.model, cfg.model);
      localStorage.setItem(LS.dir, cfg.dir); localStorage.setItem(LS.dirLabel, cfg.dirLabel);
      sessionId = null; clearThread(); closeDrawer(); connect(true);
    });
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  const SUGGESTIONS = [
    "What's running on the Pi right now?",
    'Give me git status in this repo',
    'Summarise what this project does',
    'Tail the stan-cli pm2 logs',
  ];
  function renderEmptyChips() {
    const host = $('empty-chips'); if (!host) return;
    host.innerHTML = SUGGESTIONS.map(s => `<button class="empty-chip">${esc(s)}</button>`).join('');
    host.querySelectorAll('.empty-chip').forEach((b, i) => b.addEventListener('click', () => {
      $('prompt').value = SUGGESTIONS[i]; send();
    }));
  }

  // ── Boot ──────────────────────────────────────────────
  function boot() {
    showApp();
    renderEmptyChips();
    $('chip-mode-v').textContent = modeLabel(cfg.mode);
    $('chip-project-v').textContent = cfg.dirLabel || 'Home';
    sessionId = localStorage.getItem(LS.last) || null;
    if (sessionId) connect(false); else setStatus('— tap + to start');
  }

  function init() {
    $('token-submit').addEventListener('click', doLogin);
    $('token-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('send-btn').addEventListener('click', send);
    $('prompt').addEventListener('input', e => autoGrow(e.target));
    $('prompt').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('menu-btn').addEventListener('click', () => openDrawer('sessions'));
    $('new-btn').addEventListener('click', () => openDrawer('new'));
    $('drawer-close').addEventListener('click', closeDrawer);
    $('drawer-scrim').addEventListener('click', closeDrawer);
    $('chip-mode').addEventListener('click', () => openDrawer('new'));
    $('chip-project').addEventListener('click', () => openDrawer('new'));

    if (token) tryToken(token).then(ok => ok ? boot() : showAuth());
    else showAuth();

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);
})();
