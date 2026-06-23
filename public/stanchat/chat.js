// Stan Chat — StanAI premium chat client. See ./DESIGN.md.
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
  let pendingNew = null;    // one-shot config override for the next forNew connect (quick-auto)
  let queuedFirst = null;   // first message to fire once a freshly-spawned session is live
  let pending = [];         // staged attachments: {name,isImage,mediaType,blob,url}
  let awaitMeta = null;     // one-shot resolver, fires with sessionId once a session is live
  let fleetPoll = null;     // fleet-grid refresh interval
  const fanDirs = new Set();// fan-out: selected target dirs
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
      const c = pendingNew || cfg;
      u += `&name=${encodeURIComponent(c.name || c.dirLabel || 'Chat')}` +
           `&cwd=${encodeURIComponent(c.dir || '')}` +
           `&model=${encodeURIComponent(c.model || '')}` +
           `&mode=${encodeURIComponent(c.mode || 'plan')}`;
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
    if (forNew) pendingNew = null;   // consumed into the URL; don't reuse on reconnect
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
      if (awaitMeta) { const r = awaitMeta; awaitMeta = null; r(sessionId); }
      if (queuedFirst && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'send', text: queuedFirst }));
        queuedFirst = null;
      }
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

    if (it.t === 'assistant') {
      el.className = 'turn assistant';
      const caret = it.streaming ? '<span class="streaming-caret"></span>' : '';
      el.innerHTML =
        `<div class="turn-avatar"><span class="orb-mini">◉</span></div>` +
        `<div class="turn-body"><div class="turn-author">Stan</div>` +
        `<div class="prose">${mdToHtml(it.text)}${caret}</div></div>`;
      wireCopies(el);
    } else if (it.t === 'user') {
      el.className = 'turn user';
      let html = '';
      const atts = it.attachments || [];
      if (atts.length) {
        html += '<div class="user-atts">' + atts.map(a =>
          a.isImage
            ? `<img class="user-att-img" data-att="${esc(a.name)}" alt="${esc(a.name)}">`
            : `<span class="user-att-file">📄 ${esc(a.name)}</span>`
        ).join('') + '</div>';
      }
      if (it.text && it.text !== '(attachment)')
        html += `<div class="user-msg">${esc(it.text).replace(/\n/g, '<br>')}</div>`;
      el.innerHTML = html;
      el.querySelectorAll('[data-att]').forEach(img => thumbFor(img, img.dataset.att));
    } else if (it.t === 'thinking') {
      el.className = 'turn thinking';
      el.innerHTML =
        `<div class="turn-avatar"><span class="orb-mini">◉</span></div>` +
        `<div class="turn-body"><div class="think">` +
        `<span class="think-dots"><i></i><i></i><i></i></span>` +
        `<span class="think-text">${esc(it.text || 'Thinking')}</span></div></div>`;
    } else { // system
      el.className = 'turn system' + (it.level ? ' ' + it.level : '');
      el.innerHTML = `<div class="sys-pill">${esc(it.text)}</div>`;
    }
  }

  function renderTool(el, it) {
    el.className = 'turn tool';
    const st = toolStyle(it.name);
    el.innerHTML =
      `<div class="turn-avatar"></div>` +
      `<div class="turn-body">` +
      `<div class="tool-card" data-tool="${esc(it.toolId)}">` +
        `<div class="tool-head">` +
          `<div class="tool-badge" style="background:${st.c}">${st.g}</div>` +
          `<div class="tool-info">` +
            `<div class="tool-name">${esc(it.name)}</div>` +
            (it.summary ? `<div class="tool-sum">${esc(it.summary)}</div>` : '') +
          `</div>` +
          `<span class="tool-dur"></span>` +
          `<div class="tool-state run" title="running"></div>` +
          `<div class="tool-chevron">›</div>` +
        `</div>` +
        `<div class="tool-body">` +
          (Object.keys(it.input || {}).length ? `<div class="tool-input">${esc(prettyInput(it))}</div>` : '') +
          `<pre class="tool-out" style="display:none"></pre>` +
        `</div>` +
      `</div></div>`;
    const card = el.querySelector('.tool-card');
    card._t0 = Date.now();
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
    const dt = Date.now() - (card._t0 || 0);
    if (dt >= 120 && dt < 6e5) card.querySelector('.tool-dur').textContent = (dt / 1000).toFixed(1) + 's';
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
      requestAnimationFrame(() => { t.scrollTop = t.scrollHeight; updateJump(); });
    }
  }
  function updateJump() {
    const t = $('thread'), b = $('jump-btn'); if (!b) return;
    const far = (t.scrollHeight - t.scrollTop - t.clientHeight) > 280;
    b.classList.toggle('show', far);
  }

  // ── markdown ──────────────────────────────────────────
  // Block-level parser: headings, lists, blockquotes, rules, language-labelled
  // code blocks, plus inline code/bold/em/links. Tolerant of partial (streaming)
  // input — an unclosed ``` fence simply renders as text until it closes.
  function inlineMd(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function renderCode(c) {
    if (!c) return '';
    const lang = `<span class="code-lang">${esc(c.lang || 'code')}</span>`;
    return `<div class="codeblock"><div class="code-bar">${lang}` +
      `<button class="copy" data-code="${esc(c.body)}">Copy</button></div>` +
      `<pre><code>${esc(c.body)}</code></pre></div>`;
  }
  function mdToHtml(src) {
    src = String(src || '');
    const code = [];
    src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, body) => {
      const i = code.push({ lang, body: body.replace(/\n$/, '') }) - 1;
      return ` ${i} `;
    });
    const out = [];
    let para = [], list = null;
    const closeList = () => { if (list) { out.push(`<${list.type} class="md-list">${list.items.map(x => `<li>${x}</li>`).join('')}</${list.type}>`); list = null; } };
    const closePara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
    for (const line of src.split('\n')) {
      let m;
      if ((m = line.match(/^ (\d+) $/))) { closePara(); closeList(); out.push(renderCode(code[+m[1]])); continue; }
      if (/^\s*$/.test(line)) { closePara(); closeList(); continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)/))) { closePara(); if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; } list.items.push(inlineMd(m[1])); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { closePara(); if (!list || list.type !== 'ol') { closeList(); list = { type: 'ol', items: [] }; } list.items.push(inlineMd(m[1])); continue; }
      closeList();
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closePara(); const l = m[1].length; out.push(`<div class="md-h md-h${l}">${inlineMd(m[2])}</div>`); continue; }
      if ((m = line.match(/^>\s?(.*)/))) { closePara(); out.push(`<blockquote>${inlineMd(m[1])}</blockquote>`); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closePara(); out.push('<hr class="md-hr">'); continue; }
      para.push(inlineMd(line));
    }
    closePara(); closeList();
    return out.join('');
  }
  function wireCopies(scope) {
    scope.querySelectorAll('.copy').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard?.writeText(b.dataset.code);
      b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200);
    }));
  }

  // ── Quick auto session ────────────────────────────────
  // Spin up a brand-new autopilot (bypassPermissions) chat in one tap, reusing
  // the last project/model — no drawer round-trip. Optionally fire a first
  // message the instant the session is live.
  function startAuto(firstMessage) {
    pendingNew = {
      mode: 'bypassPermissions',
      model: cfg.model,
      dir: cfg.dir,
      dirLabel: cfg.dirLabel,
      name: '⚡ ' + (cfg.dirLabel || 'Home'),
    };
    queuedFirst = (firstMessage || '').trim() || null;
    sessionId = null;
    clearThread();
    closeDrawer();
    connect(true);
  }

  // ── Attachments (phone & device files → straight into the session) ────────
  // Images are downscaled in the browser to Claude's sweet-spot (≤1568px) so a
  // 4 MB phone photo becomes a ~150 KB upload; other files ride as-is.
  function downscaleImage(file) {
    return new Promise((resolve, reject) => {
      const u = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(u);
        const MAX = 1568;
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, MAX / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const png = /png/i.test(file.type);
        const type = png ? 'image/png' : 'image/jpeg';
        c.toBlob(b => b ? resolve({ blob: b, type, name: file.name.replace(/\.\w+$/, '') + (png ? '.png' : '.jpg') })
                        : reject(new Error('encode')), type, 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('load')); };
      img.src = u;
    });
  }

  async function addFiles(fileList) {
    for (const f of Array.from(fileList || [])) {
      if (pending.length >= 8) break;
      if (/^image\//.test(f.type)) {
        try {
          const { blob, type, name } = await downscaleImage(f);
          pending.push({ name, isImage: true, mediaType: type, blob, url: URL.createObjectURL(blob) });
        } catch {
          pending.push({ name: f.name, isImage: true, mediaType: f.type, blob: f, url: URL.createObjectURL(f) });
        }
      } else {
        pending.push({ name: f.name, isImage: false, mediaType: f.type || 'application/octet-stream', blob: f, url: null });
      }
    }
    renderTray();
  }

  function renderTray() {
    const tray = $('attach-tray'); if (!tray) return;
    tray.innerHTML = pending.map((p, i) =>
      p.isImage
        ? `<div class="att-chip img"><img src="${p.url}" alt=""><button class="att-x" data-x="${i}">✕</button></div>`
        : `<div class="att-chip"><span class="att-ico">📄</span><span class="att-nm">${esc(p.name)}</span><button class="att-x" data-x="${i}">✕</button></div>`
    ).join('');
    tray.classList.toggle('show', pending.length > 0);
    tray.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.x, p = pending[i];
      if (p && p.url) URL.revokeObjectURL(p.url);
      pending.splice(i, 1); renderTray();
    }));
  }

  // Lazy-load a stored attachment thumbnail with the bearer token (an <img src>
  // can't carry auth headers, so fetch → blob URL instead).
  function thumbFor(img, name) {
    if (!sessionId) return;
    api(`/api/chat/${sessionId}/file/${encodeURIComponent(name)}`)
      .then(r => r.ok ? r.blob() : null)
      .then(b => { if (b) img.src = URL.createObjectURL(b); })
      .catch(() => {});
  }

  // Guarantee a live session exists (creating one if needed) and resolve its id.
  function ensureSession() {
    if (sessionId && ws && ws.readyState === 1) return Promise.resolve(sessionId);
    return new Promise(resolve => {
      let done = false;
      const finish = id => { if (!done) { done = true; resolve(id); } };
      awaitMeta = finish;
      connect(!sessionId);
      setTimeout(() => { awaitMeta = null; finish(sessionId); }, 6000);
    });
  }

  // ── Composer ──────────────────────────────────────────
  async function send() {
    const ta = $('prompt');
    const text = ta.value.trim();
    if (!text && !pending.length) return;

    // /auto launches a fresh autopilot session — but only when sending plain
    // text; with attachments staged we just deliver them to the current chat.
    if (!pending.length) {
      const cmd = text.match(/^\/auto\b[ \t]*([\s\S]*)$/i);
      if (cmd) { ta.value = ''; autoGrow(ta); startAuto(cmd[1]); return; }
      if (!ws || ws.readyState !== 1) { connect(!sessionId); setTimeout(send, 400); return; }
      ws.send(JSON.stringify({ type: 'send', text }));
      ta.value = ''; autoGrow(ta);
      return;
    }

    // Attachments: ensure a session, upload the bytes, then send text + refs.
    const sendBtn = $('send-btn'); sendBtn.disabled = true;
    const atts = pending.slice();
    ta.value = ''; autoGrow(ta);
    pending = []; renderTray();
    try {
      const id = await ensureSession();
      if (!id) throw new Error('no session');
      const fd = new FormData();
      atts.forEach(a => fd.append('files', a.blob, a.name));
      const { files } = await api(`/api/chat/${id}/attach`, { method: 'POST', body: fd }).then(r => r.json());
      const refs = (files || []).map(f => ({ name: f.name, isImage: f.isImage, mediaType: f.mediaType }));
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'send', text, attachments: refs }));
      } else {
        await api(`/api/chat/${id}/send`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, attachments: refs }),
        });
      }
    } catch (e) {
      const t = $('thread');
      const pill = document.createElement('div');
      pill.className = 'turn system error';
      pill.innerHTML = `<div class="sys-pill">Attachment failed: ${esc(e.message)}</div>`;
      t.appendChild(pill); scrollDown(true);
    } finally {
      atts.forEach(a => { if (a.url) URL.revokeObjectURL(a.url); });
      sendBtn.disabled = false;
    }
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

  // ── Fleet — live grid of every agent + one-prompt fan-out ─────────────────
  async function openFleet() {
    $('fleet').classList.remove('hidden');
    await renderFleet();
    if (fleetPoll) clearInterval(fleetPoll);
    fleetPoll = setInterval(refreshFleet, 3000);
  }
  function closeFleet() {
    $('fleet').classList.add('hidden');
    if (fleetPoll) { clearInterval(fleetPoll); fleetPoll = null; }
  }

  async function renderFleet() {
    const body = $('fleet-body');
    let dirs = [{ label: 'Home', path: '' }];
    try { dirs = await api('/api/agents/launch-dirs').then(r => r.json()); } catch {}
    const dirChips = dirs.map(d => {
      const label = d.label || (d.path ? d.path.split('/').pop() : 'Home');
      return `<button class="fan-dir" data-dir="${esc(d.path || '')}" data-label="${esc(label)}">${esc(label)}</button>`;
    }).join('');
    const modeChips = MODES.map(m => `<button class="fan-mode${m.v === cfg.mode ? ' sel' : ''}" data-mode="${m.v}">${esc(m.label)}</button>`).join('');
    body.innerHTML = `
      <div class="fan-card">
        <div class="fan-title">⚡ Fan-out — one task, many agents</div>
        <textarea class="fan-prompt" id="fan-prompt" rows="2" placeholder="A task to run across every selected folder… (leave blank to just spawn idle agents)"></textarea>
        <div class="fan-label">Targets</div>
        <div class="fan-dirs">${dirChips}</div>
        <div class="fan-label">Mode</div>
        <div class="fan-modes">${modeChips}</div>
        <button class="drawer-cta" id="fan-go">Launch agents</button>
      </div>
      <div class="fleet-grid-label">Live agents</div>
      <div id="fleet-grid"><div class="fleet-empty">Loading…</div></div>`;

    let fanMode = cfg.mode;
    fanDirs.clear();
    body.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.dir;
      if (fanDirs.has(k)) fanDirs.delete(k); else fanDirs.add(k);
      b.classList.toggle('sel', fanDirs.has(k));
    }));
    body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      fanMode = b.dataset.mode;
      body.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    $('fan-go').addEventListener('click', () => {
      const text = $('fan-prompt').value.trim();
      const chosen = [...body.querySelectorAll('.fan-dir.sel')].map(b => ({ path: b.dataset.dir, label: b.dataset.label }));
      const go = $('fan-go');
      if (!chosen.length) { go.textContent = 'Pick at least one target'; setTimeout(() => go.textContent = 'Launch agents', 1500); return; }
      doFanOut(text, chosen, fanMode);
    });
    await refreshFleet();
  }

  async function doFanOut(text, dirs, mode) {
    const btn = $('fan-go');
    if (btn) { btn.disabled = true; btn.textContent = `Launching ${dirs.length}…`; }
    await Promise.all(dirs.map(async d => {
      try {
        const { id } = await api('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: text ? text.slice(0, 28) : (d.label || 'Agent'), cwd: d.path, mode, model: cfg.model }),
        }).then(r => r.json());
        if (id && text) await api(`/api/chat/${id}/send`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
        });
      } catch {}
    }));
    if ($('fan-prompt')) $('fan-prompt').value = '';
    document.querySelectorAll('.fan-dir.sel').forEach(b => b.classList.remove('sel'));
    fanDirs.clear();
    if (btn) { btn.disabled = false; btn.textContent = 'Launch agents'; }
    refreshFleet();
  }

  async function refreshFleet() {
    const grid = $('fleet-grid'); if (!grid) return;
    let list = [];
    try { list = await api('/api/chat').then(r => r.json()); } catch { return; }
    if (!list.length) { grid.innerHTML = '<div class="fleet-empty">No agents yet. Fan out a task above, or start a chat.</div>'; return; }
    grid.innerHTML = list.map(fleetCard).join('');
    grid.querySelectorAll('[data-open]').forEach(c => c.addEventListener('click', e => {
      if (e.target.closest('[data-del]')) return;
      sessionId = c.dataset.open; closeFleet(); clearThread(); connect(false);
    }));
    grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await api('/api/chat/' + b.dataset.del, { method: 'DELETE' }).catch(() => {});
      if (b.dataset.del === sessionId) { sessionId = null; localStorage.removeItem(LS.last); }
      refreshFleet();
    }));
  }

  function fleetCard(s) {
    const st = s.status || 'idle';
    const dotClass = st === 'thinking' ? 'thinking' : (st === 'exited' || st === 'error') ? 'exited' : 'idle';
    const statLabel = st === 'thinking' ? 'working…' : st === 'idle' ? 'ready' : st === 'exited' ? 'ended' : st;
    const dir = (s.cwd || '~').split('/').pop() || '~';
    const cost = s.lastResult && s.lastResult.costUsd != null ? `$${s.lastResult.costUsd.toFixed(3)}` : '';
    return `<div class="fleet-card" data-open="${esc(s.id)}">
      <div class="fleet-card-top">
        <span class="fleet-orb">◉</span>
        <div class="fleet-card-id">
          <div class="fleet-card-name">${esc(s.name || 'Chat')}</div>
          <div class="fleet-card-meta">${esc(dir)} · ${esc(modeLabel(s.permMode))}</div>
        </div>
        <span class="status-dot ${dotClass}"></span>
        <button class="fleet-del" data-del="${esc(s.id)}">✕</button>
      </div>
      <div class="fleet-card-last">${esc(s.lastText || '—')}</div>
      <div class="fleet-card-foot"><span>${esc(statLabel)}</span><span>${cost ? esc(cost) + ' · ' : ''}${esc(timeAgo(s.lastActive))}</span></div>
    </div>`;
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
    $('bolt-btn').addEventListener('click', () => startAuto());
    $('fleet-btn').addEventListener('click', openFleet);
    $('fleet-close').addEventListener('click', closeFleet);
    const ea = $('empty-auto'); if (ea) ea.addEventListener('click', () => startAuto());
    $('drawer-close').addEventListener('click', closeDrawer);
    $('drawer-scrim').addEventListener('click', closeDrawer);

    // Attachments: tap the clip → device picker (Photos / Camera / Files on iOS);
    // also accept pasted images straight into the composer.
    $('attach-btn').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
    $('prompt').addEventListener('paste', e => {
      const imgs = Array.from(e.clipboardData?.files || []).filter(f => /^image\//.test(f.type));
      if (imgs.length) { e.preventDefault(); addFiles(imgs); }
    });
    $('chip-mode').addEventListener('click', () => openDrawer('new'));
    $('chip-project').addEventListener('click', () => openDrawer('new'));
    $('thread').addEventListener('scroll', updateJump, { passive: true });
    const jb = $('jump-btn'); if (jb) jb.addEventListener('click', () => scrollDown(true));

    if (token) tryToken(token).then(ok => ok ? boot() : showAuth());
    else showAuth();

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);
})();
