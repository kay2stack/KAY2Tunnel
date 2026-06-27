// Stan Chat — StanAI premium chat client. See ./DESIGN.md.
//
// ONE codebase, TWO surfaces (the Stan ecosystem unification):
//   • standalone StanChat PWA  — auto-mounts when <body data-stanchat-standalone>.
//   • native Chat tab in Stan CLI — the cockpit calls StanChat.mount({root: shadowRoot})
//     so this exact UI renders inside the cockpit (Shadow DOM = zero CSS collisions).
// `$` queries a configurable root (document, or a ShadowRoot when embedded).
(() => {
  'use strict';
  let _root = document;        // document (standalone) | ShadowRoot (embedded)
  let _standalone = true;
  const $ = id => _root.getElementById(id);
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
  let ws = null, reconnectDelay = 500, connTimer = 0;
  let stoppedByUs = false;  // true between a user-triggered Stop and the next send
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
  let transcript = [];         // raw items (upserted by iid) for /export + /copy
  // Scroll model: follow the live feed ONLY while the reader is pinned to the
  // bottom. The instant they scroll up to read, stop dragging them down.
  let stick = true;
  const pendingStream = new Map(); // el -> latest assistant item (coalesced per frame)
  let flushRaf = 0;
  let usage = null, usagePoll = 0;  // Claude Max-plan usage (from /api/usage)

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

  // ── Icons & little helpers ────────────────────────────
  const SEND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>';
  const ICON_SUN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.3"/><line x1="12" y1="2.5" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="21.5" y2="12"/><line x1="5.2" y1="5.2" x2="6.6" y2="6.6"/><line x1="17.4" y1="17.4" x2="18.8" y2="18.8"/><line x1="5.2" y1="18.8" x2="6.6" y2="17.4"/><line x1="17.4" y1="6.6" x2="18.8" y2="5.2"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>';
  const ICON_AUTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>';

  const haptic = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  // ── Theme (system → light → dark) — finishes the wired-but-hidden toggle ──
  const THEMES = ['system', 'light', 'dark'];
  const themeNow = () => localStorage.getItem('stan_theme') || 'system';
  function applyTheme(t) {
    if (t === 'dark') document.documentElement.dataset.theme = 'dark';
    else if (t === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }
  function renderThemeBtn() {
    const b = $('theme-btn'); if (!b) return;
    const t = themeNow();
    b.innerHTML = t === 'dark' ? ICON_MOON : t === 'light' ? ICON_SUN : ICON_AUTO;
    b.title = 'Theme: ' + t;
  }
  function cycleTheme() {
    const t = THEMES[(THEMES.indexOf(themeNow()) + 1) % THEMES.length];
    if (t === 'system') localStorage.removeItem('stan_theme'); else localStorage.setItem('stan_theme', t);
    applyTheme(t); renderThemeBtn(); haptic(8);
  }

  function sysPill(text, level) {
    const t = $('thread'); if (!t) return;
    const d = document.createElement('div');
    d.className = 'turn system' + (level ? ' ' + level : '');
    d.innerHTML = `<div class="sys-pill">${esc(text)}</div>`;
    t.appendChild(d); scheduleFlush();
  }

  // ── Auth ──────────────────────────────────────────────
  function showAuth() {
    const a = $('auth-screen'), p = $('app'); if (a) a.classList.remove('hidden'); if (p) p.classList.add('hidden');
    // Offer Face ID only once we confirm a passkey is enrolled for this account.
    const pk = $('passkey-login'); if (pk) { pk.classList.add('hidden'); pk.disabled = false; passkeyEnrolled().then(en => { if (en) pk.classList.remove('hidden'); }); }
  }
  function showApp() { const a = $('auth-screen'), p = $('app'); if (a) a.classList.add('hidden'); if (p) p.classList.remove('hidden'); }

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

  // ── Passkey (WebAuthn) ─────────────────────────────────
  // Passwordless Face ID / Touch ID sign-in on top of the shared token. The
  // server (server/webauthn.js) hands back the same token on a valid assertion,
  // so /api + /ws keep working unchanged. Credential private key never leaves
  // the device (and syncs across Apple devices via iCloud Keychain).
  const _b64uToBuf = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat(s.length % 4 ? 4 - (s.length % 4) : 0);
    const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const _bufToB64u = b => { const u = new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const passkeySupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  async function passkeyEnrolled() {
    if (!passkeySupported()) return false;
    try { const r = await fetch('/api/webauthn/status'); return r.ok && (await r.json()).enrolled === true; } catch { return false; }
  }
  async function passkeyLogin() {
    const r = await fetch('/api/webauthn/auth/options'); if (!r.ok) throw new Error('no passkeys');
    const o = await r.json(); o.challenge = _b64uToBuf(o.challenge);
    if (o.allowCredentials) o.allowCredentials = o.allowCredentials.map(c => ({ ...c, id: _b64uToBuf(c.id) }));
    const c = await navigator.credentials.get({ publicKey: o }), rsp = c.response;
    const body = { id: c.id, rawId: _bufToB64u(c.rawId), type: c.type,
      response: { authenticatorData: _bufToB64u(rsp.authenticatorData), clientDataJSON: _bufToB64u(rsp.clientDataJSON),
        signature: _bufToB64u(rsp.signature), userHandle: rsp.userHandle ? _bufToB64u(rsp.userHandle) : undefined },
      clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {} };
    const v = await fetch('/api/webauthn/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await v.json(); if (!v.ok || !j.verified || !j.token) throw new Error(j.error || 'verify failed');
    return j.token;
  }
  // Enrollment is gated by the bearer token upstream — only an already-signed-in
  // device can bind a new passkey to the account.
  async function passkeyEnroll(label) {
    const r = await api('/api/webauthn/register/options');
    if (!r.ok) throw new Error('options failed (' + r.status + ')');
    const o = await r.json(); o.challenge = _b64uToBuf(o.challenge); o.user.id = _b64uToBuf(o.user.id);
    if (o.excludeCredentials) o.excludeCredentials = o.excludeCredentials.map(c => ({ ...c, id: _b64uToBuf(c.id) }));
    const c = await navigator.credentials.create({ publicKey: o }), rsp = c.response;
    const body = { id: c.id, rawId: _bufToB64u(c.rawId), type: c.type, label: label || 'StanChat device',
      response: { attestationObject: _bufToB64u(rsp.attestationObject), clientDataJSON: _bufToB64u(rsp.clientDataJSON),
        transports: rsp.getTransports ? rsp.getTransports() : [] },
      clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {} };
    const v = await api('/api/webauthn/register/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await v.json(); if (!v.ok || !j.verified) throw new Error(j.error || 'verify failed');
    return j.count;
  }
  async function doPasskeyLogin() {
    const btn = $('passkey-login'); if (!btn) return;
    btn.disabled = true;
    try {
      const t = await passkeyLogin();
      token = t; localStorage.setItem(LS.token, t);
      $('auth-error').classList.add('hidden');
      boot();
    } catch (e) {
      btn.disabled = false;
      // User-cancelled Face ID isn't an error worth shouting about.
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
        const err = $('auth-error'); err.textContent = 'Face ID sign-in failed — use the token.'; err.classList.remove('hidden');
      }
    }
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

  // Reconnect with an identity guard. When we replace the socket, the OLD
  // socket's async onclose must NOT schedule another reconnect — that race (the
  // close-flag was reset before onclose fired) spawned duplicate sockets and was
  // the root cause of the offline/working flicker. Every handler compares its own
  // socket to the current `ws` and bails if it has been superseded.
  function connect(forNew) {
    if (ws) { try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch {} }
    setConn('connecting');
    const sock = new WebSocket(wsUrl(forNew));
    ws = sock;
    if (forNew) pendingNew = null;   // consumed into the URL; don't reuse on reconnect
    sock.onopen = () => { if (ws !== sock) return; reconnectDelay = 500; setConn('open'); };
    sock.onmessage = e => { if (ws !== sock) return; try { onMsg(JSON.parse(e.data)); } catch {} };
    sock.onclose = () => {
      if (ws !== sock) return;       // superseded by a newer socket — ignore
      setConn('offline');
      setTimeout(() => { if (ws === sock) connect(false); }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
    };
    sock.onerror = () => { if (ws === sock) { try { sock.close(); } catch {} } };
  }

  function onMsg(m) {
    if (m.type === 'meta') {
      meta = m.meta; sessionId = meta.id;
      localStorage.setItem(LS.last, sessionId);
      clearTimeout(connTimer);   // live now — cancel any pending "reconnecting…" paint
      renderMeta();
      if (awaitMeta) { const r = awaitMeta; awaitMeta = null; r(sessionId); }
      if (queuedFirst && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'send', text: queuedFirst }));
        queuedFirst = null;
      }
    } else if (m.type === 'snapshot') {
      clearThread();
      stick = true;                       // a fresh thread always opens at the bottom
      transcript = Array.isArray(m.transcript) ? m.transcript.slice() : [];
      m.transcript.forEach(renderItem);
      scheduleFlush();
    } else if (m.type === 'item') {
      trackItem(m.item);
      renderItem(m.item);
      scheduleFlush();
    } else if (m.type === 'tokens') {
      renderLiveTokens(m.n);
    } else if (m.type === 'status') {
      if (meta) { meta.status = m.status; if (m.lastResult) meta.lastResult = m.lastResult; }
      if (m.status === 'exited' && stoppedByUs) sysPill('Stopped — send a message to resume.');
      if (m.status === 'thinking') showTyping(); else hideTyping();
      renderMeta();
      if (m.lastResult) renderCost(m.lastResult);
      if (m.status === 'idle') fetchUsage();   // a turn just burned plan budget — refresh the bar
    }
  }

  // ── Rendering ─────────────────────────────────────────
  // The welcome empty-state ships in the initial markup, but clearThread() wipes
  // it and hideEmpty() removes it the moment content arrives — so it has to be
  // re-creatable, or New chat / a deleted chat / an empty session leaves a blank
  // void instead of the "Talk to StanAI" orb.
  const EMPTY_HTML =
    `<div id="empty-state" class="empty-state">` +
      `<div class="empty-orb">◉</div>` +
      `<div class="empty-title">Talk to StanAI</div>` +
      `<div class="empty-sub">Claude Code, live on the kay2 Pi — full repo access and every tool. Ask it to build, fix, explain or explore, and watch the work happen.</div>` +
      `<div class="empty-actions"><button class="empty-auto" id="empty-auto">⚡ Quick auto session</button></div>` +
      `<div class="empty-hint">or type <code>/auto</code> in the box to launch one instantly</div>` +
      `<div class="empty-chips" id="empty-chips"></div>` +
    `</div>`;
  function clearThread() { items.clear(); toolCards.clear(); transcript = []; $('thread').innerHTML = ''; hideTyping(); showEmpty(); }

  // Upsert by iid so streaming assistant items (re-broadcast as they grow) replace
  // their earlier copy rather than piling up duplicates in the export buffer.
  function trackItem(it) {
    if (!it || it.iid == null) { transcript.push(it); return; }
    const i = transcript.findIndex(x => x && x.iid === it.iid);
    if (i >= 0) transcript[i] = it; else transcript.push(it);
  }

  function hideEmpty() { const e = $('empty-state'); if (e) e.remove(); }

  // ── Typing bubble — Stan "is typing" between turn-start and first token ────
  function showTyping() {
    const t = $('thread'); if (!t || $('typing-turn')) return;
    hideEmpty();
    const d = document.createElement('div');
    d.id = 'typing-turn'; d.className = 'turn assistant typing';
    d.innerHTML = `<div class="turn-avatar"><span class="orb-mini">◉</span></div>` +
      `<div class="turn-body"><div class="turn-author">Stan</div>` +
      `<div class="typing-dots"><i></i><i></i><i></i></div></div>`;
    t.appendChild(d);
    if (stick) t.scrollTop = t.scrollHeight;
  }
  function hideTyping() { const e = $('typing-turn'); if (e) e.remove(); }
  // (Re)mount the welcome orb whenever the thread holds no real turns. Idempotent,
  // and re-wires its controls (starter chips + quick-auto) each call since the
  // node is freshly minted.
  function showEmpty() {
    const t = $('thread'); if (!t || items.size) return;
    if (!$('empty-state')) t.insertAdjacentHTML('afterbegin', EMPTY_HTML);
    renderEmptyChips();
    const ea = $('empty-auto'); if (ea) ea.onclick = () => startAuto();
  }

  function renderItem(it) {
    if (it.t === 'tool_result') return attachResult(it);
    hideEmpty(); hideTyping();
    let el = items.get(it.iid);
    if (!el) {
      el = document.createElement('div');
      $('thread').appendChild(el);
      items.set(it.iid, el);
    }
    if (it.t === 'tool_use') return renderTool(el, it);

    if (it.t === 'assistant') {
      // Build the turn structure once; subsequent streaming deltas only repaint
      // the .prose node, and even that is coalesced to one paint per frame in
      // doFlush(). (Re-rendering the whole turn on every token was O(n²) — the
      // jank that made scrolling up to read while Stan typed feel broken.)
      if (el._kind !== 'assistant') {
        el.className = 'turn assistant';
        el.innerHTML =
          `<div class="turn-avatar"><span class="orb-mini">◉</span></div>` +
          `<div class="turn-body"><div class="turn-author">Stan</div><div class="prose"></div></div>`;
        el._kind = 'assistant';
      }
      pendingStream.set(el, it);
      return;
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
    const bashCmd = it.name === 'Bash' && it.input && it.input.command ? String(it.input.command) : '';
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
          (bashCmd ? `<div class="tool-actions"><button class="term-send" data-term="${esc(bashCmd)}" title="Send to the cockpit terminal">▶ Terminal</button></div>` : '') +
          `<pre class="tool-out" style="display:none"></pre>` +
        `</div>` +
      `</div></div>`;
    const card = el.querySelector('.tool-card');
    card._t0 = Date.now();
    toolCards.set(it.toolId, card);
    card.querySelector('.tool-head').addEventListener('click', () => card.classList.toggle('open'));
    wireTermSend(card);
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
      fillToolOut(out, it.text);
      out.style.display = '';
    }
  }

  function renderMeta() {
    if (!meta) return;
    $('chat-name').textContent = meta.name || 'Stan Chat';
    const dot = $('status-dot'), txt = $('status-text');
    const s = meta.status || 'offline';
    dot.className = 'status-dot ' + (s === 'thinking' ? 'thinking' : s === 'exited' ? 'exited' : s === 'idle' ? 'idle' : '');
    txt.textContent = s === 'thinking' ? 'thinking…' : s === 'idle' ? 'ready'
      : s === 'exited' ? (stoppedByUs ? 'stopped' : 'session ended') : s;
    $('chip-project-v').textContent = (meta.cwd || '~').split('/').pop() || '~';
    $('chip-mode-v').textContent = modeLabel(meta.permMode);
    setSendMode(s === 'thinking');
  }
  function setStatus(s) {
    const dot = $('status-dot'), txt = $('status-text');
    if (dot) dot.className = 'status-dot';
    if (txt) txt.textContent = s;
    setSendMode(false);
  }
  // Connection-state display, debounced so a fast reconnect never flickers the
  // pill. 'open' immediately repaints the live session status; a 'connecting' /
  // 'offline' blip only paints "reconnecting…" if it outlasts the grace window —
  // so the common sub-second reattach (phone unlock) is invisible.
  function setConn(state) {
    clearTimeout(connTimer);
    if (state === 'open') { renderMeta(); return; }
    connTimer = setTimeout(() => {
      const dot = $('status-dot'), txt = $('status-text');
      if (dot) dot.className = 'status-dot';
      if (txt) txt.textContent = 'reconnecting…';
      setSendMode(false);
    }, 1200);
  }
  // The send control doubles as a Stop button while Claude is working: tap it to
  // halt the current turn (kills + auto-resumes on the next message) — essential
  // for reining in an autopilot session from a phone.
  function setSendMode(busy) {
    const b = $('send-btn'); if (!b) return;
    b.classList.toggle('stop', busy);
    b.innerHTML = busy ? STOP_SVG : SEND_SVG;
    b.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    b.disabled = false;
    if (!busy) updateSendDim();
  }
  function updateSendDim() {
    const b = $('send-btn'); if (!b || b.classList.contains('stop')) return;
    b.classList.toggle('send-idle', !$('prompt').value.trim() && !pending.length);
  }
  function stopGen() {
    stoppedByUs = true;
    haptic(22);
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'kill' })); } catch {}
  }
  const fmtTok = n => (n == null ? '' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));
  function renderCost(lr) {
    if (!lr) return;
    const el = $('meta-cost'); if (!el) return;
    const parts = [];
    const u = lr.usage || {};
    const out = u.output_tokens, inp = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (out != null) parts.push(`${fmtTok(inp)}↑ ${fmtTok(out)}↓`);
    if (lr.costUsd != null) parts.push(`$${lr.costUsd.toFixed(4)}`);
    if (lr.durationMs) parts.push((lr.durationMs / 1000).toFixed(1) + 's');
    el.classList.remove('live');
    el.textContent = parts.join(' · ');
  }
  // Live running output-token counter while a turn is being built (server streams
  // m.liveTokens on status frames). Cleared/overwritten by the final renderCost.
  function renderLiveTokens(n) {
    const el = $('meta-cost'); if (!el) return;
    el.classList.add('live');
    el.textContent = `${fmtTok(n)} tok · building…`;
  }

  // ── Claude Max-plan usage ─────────────────────────────────────────────────
  // StanChat is Claude Code on a Max plan — the per-turn "$" is API-equivalent
  // (handy for the API-billed bots), but the real budget is the plan's rolling
  // limits. `/api/usage` proxies them (token stays server-side). Pill in the
  // composer + a full breakdown in the drawer.
  const usageTone = p => (p == null ? '' : p >= 90 ? 'crit' : p >= 70 ? 'warn' : 'ok');
  function fmtReset(iso) {
    if (!iso) return '';
    const ms = new Date(iso).getTime() - Date.now();
    if (!(ms > 0)) return 'resetting…';
    const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return `resets in ${d}d ${h % 24}h`;
    if (h >= 1) return `resets in ${h}h ${m % 60}m`;
    return `resets in ${m}m`;
  }
  async function fetchUsage() {
    try {
      const r = await api('/api/usage');
      if (!r.ok) return;                 // 503/502 until the server picks up the new route
      const u = await r.json();
      if (u && !u.error) { usage = u; renderUsagePill(); if ($('usage-view')) renderUsage(); }
    } catch {}
  }
  function renderUsagePill() {
    const pill = $('usage-pill'); if (!pill) return;
    const s = usage && usage.session;
    if (!s || s.pct == null) { pill.hidden = true; return; }
    pill.hidden = false;
    pill.className = 'meta-usage ' + usageTone(s.pct);
    pill.innerHTML =
      `<span class="mu-k">plan</span>` +
      `<span class="mu-track"><i style="width:${Math.min(100, s.pct)}%"></i></span>` +
      `<span class="mu-pct">${s.pct}%</span>`;
    pill.title = `Claude ${usage.plan || 'Max'} · session ${s.pct}% · ${fmtReset(s.resetsAt)}`;
  }
  // Drawer breakdown — one bar per window the API reports.
  function renderUsage() {
    $('drawer-title').textContent = 'Plan usage';
    const body = $('drawer-body');
    const bar = (label, w) => {
      if (!w || w.pct == null) return '';
      const p = Math.min(100, w.pct);
      return `<div class="ubar ${usageTone(w.pct)}">
        <div class="ubar-top"><span class="ubar-label">${esc(label)}</span><span class="ubar-pct">${w.pct}%</span></div>
        <div class="ubar-track"><i style="width:${p}%"></i></div>
        <div class="ubar-reset">${esc(fmtReset(w.resetsAt))}</div>
      </div>`;
    };
    if (!usage) { body.innerHTML = '<div class="mode-note">Loading usage…</div>'; fetchUsage(); return; }
    body.innerHTML = `<div id="usage-view">
      <div class="usage-plan"><span class="usage-plan-badge">Claude ${esc((usage.plan || 'max').replace(/^\w/, c => c.toUpperCase()))}</span>${usage.stale ? '<span class="usage-stale">cached</span>' : ''}</div>
      ${bar('Session · 5-hour window', usage.session)}
      ${bar('Week · all models', usage.week)}
      ${bar('Week · Opus', usage.weekOpus)}
      ${bar('Week · Sonnet', usage.weekSonnet)}
      <div class="mode-note">Max-plan limits reset on a rolling window — no per-token billing. The “$” on the composer is the API-equivalent cost of this one session (useful next to the API-billed bots).</div>
      <button class="opt wide" id="usage-refresh">↻ Refresh</button>
      <button class="drawer-cta" id="usage-back">← Back to chats</button>
    </div>`;
    const rf = $('usage-refresh'); if (rf) rf.addEventListener('click', () => { rf.disabled = true; rf.textContent = 'Refreshing…'; fetchUsage(); });
    const bk = $('usage-back'); if (bk) bk.addEventListener('click', () => renderSessions());
  }
  function startUsagePoll() {
    fetchUsage();
    if (usagePoll) clearInterval(usagePoll);
    usagePoll = setInterval(() => { if (!document.hidden) fetchUsage(); }, 90000);
  }

  // ── Push notifications — get pinged when a turn finishes while you're away ──
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function _b64ToU8(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s), arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  async function pushIsOn() {
    if (!pushSupported()) return false;
    try { const reg = await navigator.serviceWorker.ready; return !!(await reg.pushManager.getSubscription()); } catch { return false; }
  }
  async function togglePush(btn) {
    if (!pushSupported()) { if (btn) btn.textContent = 'Not supported'; return; }
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      try { await api('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) }); } catch {}
      try { await existing.unsubscribe(); } catch {}
      haptic(8); renderPushRow(); return;
    }
    if ((await Notification.requestPermission()) !== 'granted') { renderPushRow(); return; }
    try {
      const { key } = await api('/api/push/vapid').then(r => r.json());
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToU8(key) });
      await api('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, prefs: notifPrefs() }) });
      haptic(14); api('/api/push/test', { method: 'POST' }).catch(() => {});
    } catch {}
    renderPushRow();
  }
  // Notification categories the user can mute independently. Mirrors the server's
  // push.CATEGORIES; the server skips a device for any category it has turned off.
  const NOTIF_CATS = [
    { k: 'reply',  label: 'Replies',      d: 'When Stan finishes a turn and you’re away' },
    { k: 'work',   label: 'Long tasks',   d: 'A turn that’s run quiet for minutes' },
    { k: 'error',  label: 'Errors',       d: 'Crashes & stalls you can resume' },
    { k: 'agent',  label: 'Other agents', d: 'Terminal agents (Codex, Clive…) finishing' },
    { k: 'system', label: 'System',       d: 'Pi reboots, phone & battery' },
  ];
  const LS_NOTIF = 'stanchat_notif_prefs';
  function notifPrefs() {
    let p = {}; try { p = JSON.parse(localStorage.getItem(LS_NOTIF) || '{}'); } catch {}
    const out = {};
    for (const c of NOTIF_CATS) out[c.k] = p[c.k] !== false;   // default on
    return out;
  }
  async function pushEndpoint() {
    try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); return s ? s.endpoint : null; } catch { return null; }
  }
  async function setNotifPref(k, on) {
    const p = notifPrefs(); p[k] = on;
    localStorage.setItem(LS_NOTIF, JSON.stringify(p));
    const endpoint = await pushEndpoint();
    if (endpoint) api('/api/push/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, prefs: p }) }).catch(() => {});
  }

  async function renderPushRow() {
    const btn = $('s-push'); if (!btn) return;
    if (!pushSupported()) { btn.textContent = 'Unsupported'; btn.disabled = true; btn.classList.remove('sel'); renderNotifCats(false); return; }
    const on = await pushIsOn();
    btn.textContent = on ? 'On' : 'Off';
    btn.classList.toggle('sel', on);
    renderNotifCats(on);
  }
  // The per-category toggle grid, shown only while push is enabled.
  function renderNotifCats(on) {
    const wrap = $('notif-cats'); if (!wrap) return;
    if (!on) { wrap.innerHTML = ''; return; }
    const p = notifPrefs();
    wrap.innerHTML =
      `<div class="drawer-section-label">Notify me about</div>` +
      NOTIF_CATS.map(c => `<button class="opt wide notif-cat${p[c.k] ? ' sel' : ''}" data-cat="${c.k}"><span class="notif-cat-l">${esc(c.label)}</span><span class="notif-cat-d">${esc(c.d)}</span></button>`).join('');
    wrap.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      const nowOn = !b.classList.contains('sel');
      b.classList.toggle('sel', nowOn);
      setNotifPref(b.dataset.cat, nowOn); haptic(8);
    }));
  }
  // Jump to a specific chat (push deep-link / SW focus message).
  function openChatId(id) {
    if (!id || id === sessionId) return;
    sessionId = id; localStorage.setItem(LS.last, id);
    closeDrawer(); clearThread(); stick = true; connect(false);
  }

  // ── Voice input — on-device dictation (whisper.cpp on the Pi) ──────────────
  let mediaRec = null, micChunks = [], micStream = null, recording = false;
  async function initVoice() {
    const mic = $('mic-btn'); if (!mic) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return;
    try {
      const r = await api('/api/voice/status');
      if (!r.ok) return;                       // route not live yet (pre-restart)
      const s = await r.json();
      if (!s || !s.available) return;          // engine not built → leave mic hidden
    } catch { return; }
    mic.hidden = false;
    mic.addEventListener('click', toggleRecord);
  }
  async function toggleRecord() {
    if (recording) return stopRecord();
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { sysPill('Microphone permission denied', 'error'); return; }
    micChunks = [];
    try { mediaRec = new MediaRecorder(micStream); } catch { sysPill('Recording unsupported here', 'error'); return; }
    mediaRec.ondataavailable = e => { if (e.data && e.data.size) micChunks.push(e.data); };
    mediaRec.onstop = onRecStop;
    mediaRec.start();
    recording = true; haptic(12);
    const mic = $('mic-btn'); mic.classList.add('recording'); mic.title = 'Tap to stop';
  }
  function stopRecord() {
    recording = false;
    const mic = $('mic-btn'); if (mic) { mic.classList.remove('recording'); mic.title = 'Tap to dictate'; }
    try { mediaRec && mediaRec.state !== 'inactive' && mediaRec.stop(); } catch {}
    try { micStream && micStream.getTracks().forEach(t => t.stop()); } catch {}
  }
  async function onRecStop() {
    const mic = $('mic-btn');
    if (!micChunks.length) return;
    const type = (mediaRec && mediaRec.mimeType) || 'audio/webm';
    const blob = new Blob(micChunks, { type });
    micChunks = [];
    mic.classList.add('busy'); mic.disabled = true;
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'rec.' + (type.includes('mp4') || type.includes('mpeg') ? 'm4a' : 'webm'));
      const j = await api('/api/voice/transcribe', { method: 'POST', body: fd }).then(r => r.json());
      if (j && j.text) {
        const ta = $('prompt');
        ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + j.text;
        autoGrow(ta); updateSendDim(); ta.focus(); haptic(10);
      } else if (j && j.error) { sysPill('Could not transcribe', 'error'); }
    } catch { sysPill('Transcription failed', 'error'); }
    finally { mic.classList.remove('busy'); mic.disabled = false; }
  }

  // ── Slash commands ────────────────────────────────────────────────────────
  // StanChat's own command layer — Claude's TUI /commands (/models, /clear…)
  // aren't available over stream-json, so these are native: typing "/" opens a
  // palette; a recognised command runs locally and never reaches Claude.
  const SLASH = [
    { c: 'help',     d: 'Show all commands',               run: () => slashHelp() },
    { c: 'auto',     a: '[task]',     d: 'Launch an autopilot session', run: a => startAuto(a) },
    { c: 'new',      d: 'Start a new chat',                run: () => openDrawer('new') },
    { c: 'models',   d: 'Switch model for the next turn',  run: () => slashModels() },
    { c: 'usage',    d: 'Claude plan usage',               run: () => openDrawer('usage') },
    { c: 'sessions', d: 'All chats',                       run: () => openDrawer('sessions') },
    { c: 'settings', d: 'Settings',                        run: () => openDrawer('settings') },
    { c: 'rename',   a: '[name]',     d: 'Rename this chat',            run: a => slashRename(a) },
    { c: 'terminal', d: 'Open this chat in the cockpit terminal', run: () => openInTerminal() },
    { c: 'export',   d: 'Share / copy the transcript',     run: () => slashExport() },
    { c: 'copy',     d: 'Copy Stan’s last reply',          run: () => slashCopy() },
    { c: 'pet',      d: 'Toggle the Stan mascot',          run: () => togglePet() },
    { c: 'btw',      a: '<question>', d: 'Quick aside to Stan', run: a => sendBtw(a) },
    { c: 'stop',     d: 'Stop the current turn',           run: () => stopGen() },
    { c: 'clear',    d: 'Clear this view (keeps context)', run: () => clearThread() },
  ];
  // Returns true if the text was a recognised command (so send() doesn't ship it).
  function runSlash(text) {
    const m = text.match(/^\/(\w+)\b[ \t]*([\s\S]*)$/);
    if (!m) return false;
    const cmd = SLASH.find(s => s.c === m[1].toLowerCase());
    if (!cmd) return false;
    hideSlashMenu(); haptic(8); cmd.run((m[2] || '').trim());
    return true;
  }
  function slashHelp() {
    const rows = SLASH.map(s => `<div class="cmd-row"><code>/${s.c}${s.a ? ' ' + esc(s.a) : ''}</code><span>${esc(s.d)}</span></div>`).join('');
    sysCard(`<div class="cmd-help-h">Commands</div>${rows}`);
  }
  function slashModels() {
    const rows = MODELS.map(m => `<button class="opt" data-sm="${esc(m.v)}">${esc(m.label)}${cfg.model === m.v ? ' ✓' : ''}</button>`).join('');
    const card = sysCard(`<div class="cmd-help-h">Model — next message onward</div><div class="opt-grid">${rows}</div>`);
    card.querySelectorAll('[data-sm]').forEach(b => b.addEventListener('click', () => switchModel(b.dataset.sm)));
  }
  function switchModel(v) {
    cfg.model = v; localStorage.setItem(LS.model, v);
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'setModel', model: v })); } catch {}
    sysPill('Model → ' + ((MODELS.find(m => m.v === v) || {}).label || v)); haptic(10);
  }
  function sendBtw(q) {
    if (!q) { const ta = $('prompt'); ta.value = '/btw '; ta.focus(); autoGrow(ta); return; }
    deliverText('By the way — ' + q);
  }

  // ── /rename · /export · /copy — chat management ───────────────────────────
  function slashRename(name) {
    if (!sessionId) { sysPill('Start the chat first, then rename it.'); return; }
    if (!name) {   // no arg → prefill the box with the current name for editing
      const ta = $('prompt'); ta.value = '/rename ' + (meta && meta.name ? meta.name : '');
      ta.focus(); autoGrow(ta); updateSendDim(); return;
    }
    name = name.slice(0, 64);
    if (meta) meta.name = name;                 // optimistic — server echoes back via meta
    const nameEl = $('chat-name'); if (nameEl) nameEl.textContent = name;
    api('/api/chat/' + sessionId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      .then(() => sysPill('Renamed to “' + name + '”'))
      .catch(() => sysPill('Rename failed', 'warn'));
    haptic(10);
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try {   // fallback for older WebViews / non-secure edge cases
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }

  // Render the current thread as clean Markdown — user turns, Stan's prose and a
  // compact one-line trace of each tool call (the work, not its raw output).
  function buildTranscriptMd() {
    const head = `# Stan Chat — ${(meta && meta.name) || 'Chat'}\n\n` +
      `\`${(meta && meta.cwd) || '~'}\` · exported ${new Date().toLocaleString()}\n`;
    const out = [head];
    for (const it of transcript) {
      if (!it) continue;
      if (it.t === 'user' && it.text && it.text !== '(attachment)') {
        const atts = (it.attachments || []).map(a => a.name).join(', ');
        out.push(`\n**You:** ${it.text}${atts ? `  _(📎 ${atts})_` : ''}`);
      } else if (it.t === 'assistant' && it.text && it.text.trim()) {
        out.push(`\n**Stan:**\n\n${it.text.trim()}`);
      } else if (it.t === 'tool_use') {
        out.push(`\n> \`${it.name}\`${it.summary ? ' — ' + it.summary : ''}`);
      }
    }
    return out.join('\n') + '\n';
  }

  async function slashExport() {
    if (!transcript.length) { sysPill('Nothing to export yet.'); return; }
    const md = buildTranscriptMd();
    const title = 'Stan Chat — ' + ((meta && meta.name) || 'Chat');
    if (navigator.share) {   // native share sheet on iOS/Android — the best mobile path
      try { await navigator.share({ title, text: md }); haptic(10); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }   // user cancelled — don't fall through to copy
    }
    const ok = await copyToClipboard(md);
    sysPill(ok ? 'Transcript copied to clipboard ✓' : 'Could not copy transcript', ok ? '' : 'warn');
    haptic(ok ? 10 : 6);
  }

  async function slashCopy() {
    let last = '';
    for (let i = transcript.length - 1; i >= 0; i--) {
      const it = transcript[i];
      if (it && it.t === 'assistant' && it.text && it.text.trim()) { last = it.text.trim(); break; }
    }
    if (!last) { sysPill('No reply to copy yet.'); return; }
    const ok = await copyToClipboard(last);
    sysPill(ok ? 'Last reply copied ✓' : 'Could not copy', ok ? '' : 'warn');
    haptic(ok ? 10 : 6);
  }
  // Send arbitrary text over the live socket as if typed (slash helpers / pet).
  function deliverText(text) {
    if (!text) return;
    stoppedByUs = false;
    if (!ws || ws.readyState !== 1) { connect(!sessionId); setTimeout(() => deliverText(text), 400); return; }
    ws.send(JSON.stringify({ type: 'send', text }));
  }
  // A richer-than-a-pill system card in the thread (command help, model list…).
  function sysCard(html) {
    const t = $('thread'); if (!t) return document.createElement('div');
    hideEmpty();
    const d = document.createElement('div');
    d.className = 'turn system'; d.innerHTML = `<div class="sys-card">${html}</div>`;
    t.appendChild(d); scheduleFlush();
    return d;
  }

  // ── Slash palette (autocomplete over the composer) ────────────────────────
  function updateSlashMenu() {
    const menu = $('slash-menu'); if (!menu) return;
    const m = $('prompt').value.match(/^\/(\w*)$/);   // only while typing the command word
    const matches = m ? SLASH.filter(s => s.c.startsWith(m[1].toLowerCase())) : [];
    if (!matches.length) { hideSlashMenu(); return; }
    menu.innerHTML = matches.map(s => `<button class="slash-row" data-c="${s.c}"><code>/${s.c}${s.a ? ' ' + esc(s.a) : ''}</code><span>${esc(s.d)}</span></button>`).join('');
    menu.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => pickSlash(b.dataset.c)));
    menu.classList.add('show');
  }
  function hideSlashMenu() { const m = $('slash-menu'); if (m) m.classList.remove('show'); }
  function pickSlash(c) {
    const cmd = SLASH.find(s => s.c === c); if (!cmd) return;
    const ta = $('prompt');
    hideSlashMenu();
    if (cmd.a) { ta.value = '/' + c + ' '; ta.focus(); autoGrow(ta); updateSendDim(); }
    else { ta.value = ''; autoGrow(ta); updateSendDim(); haptic(8); cmd.run(''); }
  }

  // ── /pet — an ASCII Stan mascot that lives in the chat ────────────────────
  const PET_FACE = ['.----.', '|o  o|', "'-__-'"].join('\n');
  const PET_BIG = ['   .------.', '  |  o  o |', '  |   __   |', "   '------'", '    S T A N'].join('\n');
  const PET_MOODS = ['watching the tools fly by…', 'ready when you are.', 'this repo has good bones.',
    'beep — all systems go.', 'ask me anything, even a /btw.', 'the Pi is warm and happy.', 'I never sleep.'];
  let petOn = localStorage.getItem('stanchat_pet') === '1';
  function togglePet(force) {
    petOn = force != null ? force : !petOn;
    localStorage.setItem('stanchat_pet', petOn ? '1' : '0');
    renderPet(); haptic(8);
  }
  function renderPet() {
    const app = $('app'); if (!app) return;
    let pet = $('stan-pet');
    if (!petOn) { if (pet) pet.remove(); closePetPop(); return; }
    if (pet) return;
    pet = document.createElement('button');
    pet.id = 'stan-pet'; pet.className = 'stan-pet'; pet.setAttribute('aria-label', 'Stan');
    pet.innerHTML = `<pre class="pet-face">${PET_FACE}</pre>`;
    app.appendChild(pet);
    pet.addEventListener('click', togglePetPop);
  }
  function petMood() { return PET_MOODS[Math.floor(Math.random() * PET_MOODS.length)]; }
  function togglePetPop() {
    if ($('pet-pop')) return closePetPop();
    const app = $('app'); if (!app) return;
    const pop = document.createElement('div');
    pop.id = 'pet-pop'; pop.className = 'pet-pop';
    pop.innerHTML =
      `<pre class="pet-big">${PET_BIG}</pre>` +
      `<div class="pet-mood">“${esc(petMood())}”</div>` +
      `<div class="pet-btw"><input id="pet-btw-in" placeholder="Ask a /btw aside…" autocomplete="off" spellcheck="false"><button id="pet-btw-go">Ask</button></div>` +
      `<button class="pet-x" id="pet-x">dismiss</button>`;
    app.appendChild(pop);
    const go = () => { const q = $('pet-btw-in').value.trim(); if (q) { sendBtw(q); closePetPop(); } };
    $('pet-btw-go').addEventListener('click', go);
    $('pet-btw-in').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    $('pet-x').addEventListener('click', closePetPop);
    setTimeout(() => $('pet-btw-in') && $('pet-btw-in').focus(), 30);
  }
  function closePetPop() { const p = $('pet-pop'); if (p) p.remove(); }

  // One rAF that paints any queued streaming prose AND follows the bottom — at
  // most once per frame no matter how many deltas arrived, and only scrolling
  // when the reader is still stuck to the bottom.
  function scheduleFlush() { if (!flushRaf) flushRaf = requestAnimationFrame(doFlush); }
  function doFlush() {
    flushRaf = 0;
    for (const [el, it] of pendingStream) {
      const pr = el.querySelector('.prose');
      if (!pr) continue;
      pr.innerHTML = mdToHtml(it.text) + (it.streaming ? '<span class="streaming-caret"></span>' : '');
      if (!it.streaming) { wireCopies(el); maybeChoices(el, it); }
    }
    pendingStream.clear();
    const t = $('thread'); if (!t) return;
    if (stick) t.scrollTop = t.scrollHeight;
    updateJump();
  }
  function jumpLatest() {
    stick = true;
    const t = $('thread'); if (!t) return;
    t.scrollTo ? t.scrollTo({ top: t.scrollHeight, behavior: 'smooth' }) : (t.scrollTop = t.scrollHeight);
    updateJump();
  }
  // Reader-intent tracking: a meaningful scroll-up un-sticks the feed so live
  // output stops dragging the viewport; scrolling back to the bottom re-sticks.
  function onThreadScroll() {
    const t = $('thread'); if (!t) return;
    stick = (t.scrollHeight - t.scrollTop - t.clientHeight) < 90;
    updateJump();
  }
  function updateJump() {
    const t = $('thread'), b = $('jump-btn'); if (!b || !t) return;
    b.classList.toggle('show', (t.scrollHeight - t.scrollTop - t.clientHeight) > 280);
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
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  // Code fence languages we treat as shell — these get a "Send to terminal" button.
  const isShellLang = l => /^(sh|bash|shell|zsh|console|terminal|shell-session|shellsession|bashsession)$/i.test(String(l || '').trim());
  function renderCode(c) {
    if (!c) return '';
    const lang = `<span class="code-lang">${esc(c.lang || 'code')}</span>`;
    const termBtn = isShellLang(c.lang)
      ? `<button class="term-send" data-term="${esc(c.body)}" title="Send to the cockpit terminal">▶ Terminal</button>`
      : '';
    return `<div class="codeblock"><div class="code-bar">${lang}` +
      termBtn +
      `<button class="copy" data-code="${esc(c.body)}">Copy</button></div>` +
      `<pre><code>${esc(c.body)}</code></pre></div>`;
  }
  // GFM table: split a "| a | b |" row into trimmed cells.
  const tableCells = line => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  function renderTable(rows) {
    const head = tableCells(rows[0]).map(c => `<th>${inlineMd(c)}</th>`).join('');
    const body = rows.slice(1).map(r => `<tr>${tableCells(r).map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="md-tablewrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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
    const closeList = () => { if (list) { out.push(`<${list.type} class="md-list${list.check ? ' checklist' : ''}">${list.items.map(x => `<li>${x}</li>`).join('')}</${list.type}>`); list = null; } };
    const closePara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
    const lines = src.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      let m;
      if ((m = line.match(/^ (\d+) $/))) { closePara(); closeList(); out.push(renderCode(code[+m[1]])); continue; }
      if (/^\s*$/.test(line)) { closePara(); closeList(); continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && li + 1 < lines.length && /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(lines[li + 1])) {
        closePara(); closeList();
        const rows = [line]; let j = li + 2;
        while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) rows.push(lines[j++]);
        out.push(renderTable(rows)); li = j - 1; continue;
      }
      if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
        closePara();
        if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [], check: false }; }
        const task = m[1].match(/^\[([ xX])\]\s+([\s\S]*)$/);
        if (task) { list.check = true; list.items.push(`<span class="md-task${task[1].toLowerCase() === 'x' ? ' done' : ''}"><i class="md-check"></i><span>${inlineMd(task[2])}</span></span>`); }
        else list.items.push(inlineMd(m[1]));
        continue;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { closePara(); if (!list || list.type !== 'ol') { closeList(); list = { type: 'ol', items: [], check: false }; } list.items.push(inlineMd(m[1])); continue; }
      closeList();
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closePara(); const l = m[1].length; out.push(`<div class="md-h md-h${l}">${inlineMd(m[2])}</div>`); continue; }
      if ((m = line.match(/^>\s?(.*)/))) { closePara(); out.push(`<blockquote>${inlineMd(m[1])}</blockquote>`); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closePara(); out.push('<hr class="md-hr">'); continue; }
      para.push(inlineMd(line));
    }
    closePara(); closeList();
    return out.join('');
  }
  // ── Tap-to-pick choices ───────────────────────────────────────────────────
  // When Stan ends a turn with a short numbered menu and is asking the user to
  // choose, surface the options as tap chips so picking is one thumb-tap instead
  // of typing the digit. Deliberately conservative: only a trailing 2–8 item
  // 1..N ordered list, in a message that actually reads like a question.
  const stripMd = s => String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>]/g, '').trim();
  function extractChoices(text) {
    const lines = String(text || '').split('\n');
    const opts = []; let lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*(\d+)[.)]\s+(\S.*)$/);
      if (m) { opts.push({ n: m[1], label: stripMd(m[2]) }); lastIdx = i; }
    }
    if (opts.length < 2 || opts.length > 8) return null;
    for (let i = 0; i < opts.length; i++) if (+opts[i].n !== i + 1) return null;   // strictly 1..N, in order
    if (opts.some(o => !o.label || o.label.length > 140)) return null;
    if (lines.slice(lastIdx + 1).join(' ').trim().length > 80) return null;         // menu must be the tail
    const asks = /\?|\bwhich\b|\bchoose\b|\boptions?\b|\bpick\b|\bprefer\b|would you like|want me to|shall i|\bselect\b|go with|how.*proceed|let me know/i;
    if (!asks.test(text)) return null;
    return opts;
  }
  function clearChoiceRows() { document.querySelectorAll('.choice-row').forEach(r => r.remove()); }
  // Only the latest turn gets chips — stale menus from earlier in the thread stay
  // plain text, and clearChoiceRows() sweeps them the moment the user sends.
  function maybeChoices(el, it) {
    const thread = $('thread');
    if (!thread || el.parentNode !== thread || thread.lastElementChild !== el) return;
    if (el.querySelector('.choice-row')) return;
    const opts = extractChoices(it.text);
    if (!opts) return;
    const body = el.querySelector('.turn-body'); if (!body) return;
    const row = document.createElement('div');
    row.className = 'choice-row';
    row.innerHTML = opts.map(o =>
      `<button class="choice-chip" type="button" data-pick="${esc(o.n)}">` +
        `<span class="choice-n">${esc(o.n)}</span>` +
        `<span class="choice-label">${esc(o.label)}</span>` +
      `</button>`).join('');
    body.appendChild(row);
    row.querySelectorAll('.choice-chip').forEach(b =>
      b.addEventListener('click', () => pickChoice(b.dataset.pick)));
  }
  function pickChoice(n) {
    haptic(12);
    clearChoiceRows();
    const ta = $('prompt');
    if (ta) ta.value = n;
    send();
  }
  function wireCopies(scope) {
    scope.querySelectorAll('.copy').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard?.writeText(b.dataset.code);
      b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200);
    }));
    wireTermSend(scope);
  }
  // ── Chat ⇄ terminal bridge (Part 2) ───────────────────────────────────────
  function wireTermSend(scope) {
    scope.querySelectorAll('.term-send').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      sendToTerminal(b.dataset.term, b);
    }));
  }
  function flashBtn(b, txt) {
    if (!b) return;
    const orig = b.dataset._orig || b.textContent;
    b.dataset._orig = orig;
    b.textContent = txt;
    setTimeout(() => { b.textContent = b.dataset._orig || orig; }, 1500);
  }
  // Paste a proposed command into the live shell (execute:false — the user runs it
  // there, matching "AI suggestions are never auto-run"). With no sessionId the
  // server targets the most-recent real PTY (chat mirrors are excluded).
  async function sendToTerminal(text, btn) {
    if (!text) return;
    haptic(10);
    try {
      const r = await api('/api/term/inject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, execute: false }),
      });
      if (r.status === 404) { sysPill('Open a terminal session first, then send.'); flashBtn(btn, '✕'); return; }
      if (!r.ok) throw new Error('inject');
      flashBtn(btn, '✓ Sent');
      sysPill('Sent to terminal — review, then run it there.');
    } catch { flashBtn(btn, '✕'); sysPill('Could not reach the terminal', 'warn'); }
  }
  // Jump to the cockpit Terminal tab attached to this chat's mirror session.
  // Cockpit-only (needs the host App + a Terminal tab); degrades to a hint.
  function openInTerminal() {
    if (!sessionId) { sysPill('Start the chat first.'); return; }
    if (!_standalone && window.App && typeof window.App.openTerminalForSession === 'function') {
      window.App.openTerminalForSession('chat:' + sessionId);
      haptic(12);
    } else {
      sysPill('Open the Stan CLI cockpit → Terminal to watch this chat live.');
    }
  }
  // Tap a file path in tool output → copy it (universal, no new endpoint).
  function onPathTap(p) {
    haptic(8);
    copyToClipboard(p).then(ok => sysPill(ok ? 'Copied ' + p : p, ok ? '' : 'warn'));
  }
  // Render plain text into a <pre>, turning absolute-ish paths into tappable spans.
  // Built with DOM nodes (no innerHTML) so tool output can never inject markup.
  const PATH_RE = /((?:\/[A-Za-z0-9._-]+){2,})/g;
  function fillToolOut(preEl, text) {
    if (text.length > 4000) { preEl.textContent = text; return; }   // skip huge dumps
    preEl.textContent = '';
    let last = 0, m, n = 0;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(text)) !== null && n < 60) {
      const p = m[0];
      if (m.index > last) preEl.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'tool-path';
      span.textContent = p;
      span.title = 'Tap to copy path';
      span.addEventListener('click', e => { e.stopPropagation(); onPathTap(p); });
      preEl.appendChild(span);
      last = m.index + p.length;
      n++;
    }
    if (last < text.length) preEl.appendChild(document.createTextNode(text.slice(last)));
  }

  // ── Quick auto session ────────────────────────────────
  // Spin up a brand-new autopilot (bypassPermissions) chat in one tap, reusing
  // the last project/model — no drawer round-trip. Optionally fire a first
  // message the instant the session is live.
  function startAuto(firstMessage) {
    stoppedByUs = false; haptic(14);
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
    updateSendDim();
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
    stoppedByUs = false; haptic(9);
    clearChoiceRows();   // any pending tap-menu is now answered

    // /auto launches a fresh autopilot session — but only when sending plain
    // text; with attachments staged we just deliver them to the current chat.
    if (!pending.length) {
      // Slash command? Run it locally and don't ship it to Claude. If the command
      // repopulated the box (e.g. /btw with no arg), leave that; else clear.
      if (text[0] === '/' && runSlash(text)) {
        if ($('prompt').value === text) { ta.value = ''; autoGrow(ta); updateSendDim(); }
        return;
      }
      if (!ws || ws.readyState !== 1) { connect(!sessionId); setTimeout(send, 400); return; }
      ws.send(JSON.stringify({ type: 'send', text }));
      ta.value = ''; autoGrow(ta); updateSendDim(); hideSlashMenu();
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
      const r = await api(`/api/chat/${id}/attach`, { method: 'POST', body: fd });
      if (!r.ok) { let msg = 'upload failed (' + r.status + ')'; try { msg = (await r.json()).error || msg; } catch {} throw new Error(msg); }
      const { files } = await r.json();
      if (!files || !files.length) throw new Error('file was not saved on the Pi');
      const refs = files.map(f => ({ name: f.name, isImage: f.isImage, mediaType: f.mediaType }));
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
      t.appendChild(pill); scheduleFlush();
    } finally {
      atts.forEach(a => { if (a.url) URL.revokeObjectURL(a.url); });
      sendBtn.disabled = false;
    }
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }

  // ── Drawer ────────────────────────────────────────────
  function openDrawer(mode) {
    $('drawer').classList.remove('hidden');
    if (mode === 'new') renderNewChat();
    else if (mode === 'settings') renderSettings();
    else if (mode === 'usage') renderUsage();
    else renderSessions();
  }
  function closeDrawer() { $('drawer').classList.add('hidden'); }

  // A chat has a live process (Ongoing) vs none (Disconnected — resumable on tap).
  const isLive = s => s.status === 'idle' || s.status === 'thinking' || s.status === 'starting';

  async function renderSessions() {
    $('drawer-title').textContent = 'Chats';
    const body = $('drawer-body');
    body.innerHTML = '<div class="mode-note">Loading…</div>';
    let list = [];
    try { list = await api('/api/chat').then(r => r.json()); } catch { return; }

    // Split connected (live process) from disconnected (resumable). Within the
    // live group, surface the ones actually working first.
    const rank = s => s.status === 'thinking' ? 0 : s.status === 'starting' ? 1 : 2;
    const live = list.filter(isLive).sort((a, b) => rank(a) - rank(b) || b.lastActive - a.lastActive);
    const ended = list.filter(s => !isLive(s)).sort((a, b) => b.lastActive - a.lastActive);
    const head = (label, cls, n, extra = '') =>
      `<div class="sess-section-h ${cls}">${label}<span class="sess-count">${n}</span>${extra}</div>`;

    body.innerHTML =
      `<div class="sess-search-wrap"><input id="sess-search" class="sess-search" placeholder="Search chats…" autocomplete="off" spellcheck="false"></div>` +
      `<div id="sess-list">` +
        (list.length
          ? (live.length ? head('Ongoing', 'live', live.length) + live.map(sessionRow).join('') : '') +
            (ended.length ? head('Disconnected', 'off', ended.length, '<button class="sess-clear" id="clear-ended">Clear all</button>') + ended.map(sessionRow).join('') : '')
          : '<div class="mode-note">No chats yet. Tap “New chat” to start one.</div>') +
      `</div>` +
      `<button class="drawer-cta" id="cta-new">＋ New chat</button>`;

    wireSessionRows(body);
    const search = $('sess-search');
    if (search) search.addEventListener('input', () => filterSessions(body, search.value.trim().toLowerCase()));
    const clr = $('clear-ended');
    if (clr) clr.addEventListener('click', async () => {
      clr.disabled = true; clr.textContent = 'Clearing…';
      await Promise.all(ended.map(s => api('/api/chat/' + s.id, { method: 'DELETE' }).catch(() => {})));
      renderSessions();
    });
    $('cta-new').addEventListener('click', () => renderNewChat());
  }

  function sessionRow(s) {
    const dir = (s.cwd || '~').split('/').pop() || '~';
    const dotClass = s.status === 'thinking' ? 'thinking' : isLive(s) ? 'idle' : 'exited';
    const stat = s.status === 'thinking' ? 'working…' : s.status === 'idle' ? 'ready'
      : s.status === 'starting' ? 'starting…' : s.status === 'error' ? 'error' : 'resumable';
    const cur = s.id === sessionId ? ' cur' : '';
    const hay = ((s.name || '') + ' ' + dir).toLowerCase();
    const prev = s.lastText ? `<div class="sess-prev">${esc(s.lastText)}</div>` : '';
    return `<div class="sess-row${cur}" data-id="${esc(s.id)}" data-hay="${esc(hay)}">
      <div class="sess-icon${isLive(s) ? '' : ' off'}">◉</div>
      <div class="sess-info">
        <div class="sess-name">${esc(s.name)}<span class="sess-dir"> · ${esc(dir)}</span></div>
        <div class="sess-meta"><span class="status-dot ${dotClass}"></span>${esc(modeLabel(s.permMode))} · ${esc(stat)} · ${esc(timeAgo(s.lastActive))}</div>
        ${prev}
      </div>
      <button class="sess-del" data-del="${esc(s.id)}">✕</button>
    </div>`;
  }

  function wireSessionRows(scope) {
    scope.querySelectorAll('.sess-row').forEach(r => r.addEventListener('click', e => {
      if (e.target.closest('[data-del]')) return;
      sessionId = r.dataset.id; closeDrawer(); clearThread(); stick = true; connect(false);
    }));
    scope.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await api('/api/chat/' + b.dataset.del, { method: 'DELETE' }).catch(() => {});
      if (b.dataset.del === sessionId) { sessionId = null; localStorage.removeItem(LS.last); clearThread(); }
      renderSessions();
    }));
  }

  // Live filter: hide non-matching rows, then hide any section header left empty.
  function filterSessions(scope, q) {
    scope.querySelectorAll('.sess-row').forEach(r => {
      r.style.display = (!q || r.dataset.hay.includes(q)) ? '' : 'none';
    });
    scope.querySelectorAll('.sess-section-h').forEach(h => {
      let n = h.nextElementSibling, any = false;
      while (n && n.classList.contains('sess-row')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; }
      h.style.display = any ? '' : 'none';
    });
  }

  // ── Settings ──────────────────────────────────────────
  function renderSettings() {
    $('drawer-title').textContent = 'Settings';
    const body = $('drawer-body');
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const themeBtns = THEMES.map(t => `<button class="opt ${themeNow() === t ? 'sel' : ''}" data-stheme="${t}">${cap(t)}</button>`).join('');
    const modeOpts = MODES.map(m => `<button class="opt ${cfg.mode === m.v ? 'sel' : ''}" data-smode="${m.v}">${esc(m.label)}</button>`).join('');
    const modelOpts = MODELS.map(m => `<button class="opt ${cfg.model === m.v ? 'sel' : ''}" data-smodel="${esc(m.v)}">${esc(m.label)}</button>`).join('');
    body.innerHTML = `
      <div class="drawer-section-label">Appearance</div><div class="opt-grid">${themeBtns}</div>
      <div class="drawer-section-label">Notifications</div>
      <div class="opt-grid"><button class="opt" id="s-push">Off</button></div>
      <div class="mode-note">Push when a turn finishes while StanChat is closed or your phone's locked — rein in an autopilot from anywhere.</div>
      <div id="notif-cats" class="notif-cats"></div>
      <div class="drawer-section-label">Default mode · new chats</div><div class="opt-grid">${modeOpts}</div>
      <div class="mode-note" id="s-note">${esc((MODES.find(m => m.v === cfg.mode) || {}).note || '')}</div>
      <div class="drawer-section-label">Default model · new chats</div><div class="opt-grid">${modelOpts}</div>
      <div class="drawer-section-label">Face ID sign-in</div>
      <div id="passkey-list"></div>
      <button class="opt wide" id="s-passkey-add">Add Face ID to this device</button>
      <div class="mode-note" id="s-passkey-note">Sign in with Face ID / Touch ID instead of the token. Syncs across your Apple devices via iCloud Keychain.</div>
      <div class="drawer-section-label">Maintenance</div>
      <button class="opt wide danger" id="s-clear">Clear all disconnected chats</button>
      <button class="drawer-cta" id="s-back">← Back to chats</button>`;
    body.querySelectorAll('[data-stheme]').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.stheme;
      if (t === 'system') localStorage.removeItem('stan_theme'); else localStorage.setItem('stan_theme', t);
      applyTheme(t); renderThemeBtn();
      body.querySelectorAll('[data-stheme]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    body.querySelectorAll('[data-smode]').forEach(b => b.addEventListener('click', () => {
      cfg.mode = b.dataset.smode; localStorage.setItem(LS.mode, cfg.mode);
      const c = $('chip-mode-v'); if (c) c.textContent = modeLabel(cfg.mode);
      $('s-note').textContent = (MODES.find(m => m.v === cfg.mode) || {}).note || '';
      body.querySelectorAll('[data-smode]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    body.querySelectorAll('[data-smodel]').forEach(b => b.addEventListener('click', () => {
      cfg.model = b.dataset.smodel; localStorage.setItem(LS.model, cfg.model);
      body.querySelectorAll('[data-smodel]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    $('s-clear').addEventListener('click', async () => {
      const btn = $('s-clear'); btn.disabled = true; btn.textContent = 'Clearing…';
      let l = []; try { l = await api('/api/chat').then(r => r.json()); } catch {}
      await Promise.all(l.filter(s => !isLive(s)).map(s => api('/api/chat/' + s.id, { method: 'DELETE' }).catch(() => {})));
      renderSessions();
    });
    renderPushRow();
    const sp = $('s-push'); if (sp) sp.addEventListener('click', () => togglePush());
    renderPasskeyRow();
    $('s-back').addEventListener('click', () => renderSessions());
  }

  // Face ID enrollment + management, inside Settings. Enroll endpoints are
  // token-gated, so this only works once signed in (which, in Settings, we are).
  async function renderPasskeyRow() {
    const add = $('s-passkey-add'), note = $('s-passkey-note'), list = $('passkey-list');
    if (!add) return;
    if (!passkeySupported()) {
      add.disabled = true; note.textContent = 'This browser doesn’t support passkeys.';
      return;
    }
    const refresh = async () => {
      let creds = [];
      try { creds = (await api('/api/webauthn/credentials').then(r => r.json())).credentials || []; } catch {}
      list.innerHTML = creds.map(c =>
        `<div class="passkey-item"><span>${esc(c.label || 'Passkey')}</span>` +
        `<button class="passkey-del" data-id="${esc(c.id)}" aria-label="Remove passkey">Remove</button></div>`).join('');
      list.querySelectorAll('.passkey-del').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api('/api/webauthn/credentials/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) }); }
        catch {}
        refresh();
      }));
    };
    refresh();
    add.addEventListener('click', async () => {
      add.disabled = true; add.textContent = 'Waiting for Face ID…';
      try {
        await passkeyEnroll('StanChat (' + (navigator.platform || 'device') + ')');
        note.textContent = '✓ Face ID enabled — you’ll see it on the sign-in screen.';
      } catch (e) {
        if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') note.textContent = '⚠ ' + (e.message || 'enroll failed');
      }
      add.disabled = false; add.textContent = 'Add Face ID to this device';
      refresh();
    });
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
    _root.querySelectorAll('.fan-dir.sel').forEach(b => b.classList.remove('sel'));
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
    showEmpty();
    $('chip-mode-v').textContent = modeLabel(cfg.mode);
    $('chip-project-v').textContent = cfg.dirLabel || 'Home';
    // Deep-link from a push notification: /stanchat/?c=<chatId> opens that chat.
    let deepChat = null;
    if (_standalone) {
      try {
        const p = new URLSearchParams(location.search).get('c');
        if (p) { deepChat = p; history.replaceState(null, '', location.pathname); }
      } catch {}
    }
    sessionId = deepChat || localStorage.getItem(LS.last) || null;
    if (sessionId) connect(false); else setStatus('— tap + to start');
    updateSendDim();
    startUsagePoll();
    initVoice();
    renderPet();
  }

  function init() {
    const tSubmit = $('token-submit'), tInput = $('token-input');   // standalone-only
    if (tSubmit) tSubmit.addEventListener('click', doLogin);
    if (tInput) tInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    const pkBtn = $('passkey-login'); if (pkBtn) pkBtn.addEventListener('click', doPasskeyLogin);
    $('send-btn').addEventListener('click', () => {
      if ($('send-btn').classList.contains('stop')) stopGen(); else send();
    });
    $('prompt').addEventListener('input', e => { autoGrow(e.target); updateSendDim(); updateSlashMenu(); });
    $('prompt').addEventListener('blur', () => setTimeout(hideSlashMenu, 150));
    $('theme-btn').addEventListener('click', cycleTheme);
    renderThemeBtn();
    $('prompt').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('menu-btn').addEventListener('click', () => openDrawer('sessions'));
    $('new-btn').addEventListener('click', () => openDrawer('new'));
    const up = $('usage-pill'); if (up) up.addEventListener('click', () => openDrawer('usage'));
    $('bolt-btn').addEventListener('click', () => startAuto());
    $('fleet-btn').addEventListener('click', openFleet);
    $('fleet-close').addEventListener('click', closeFleet);
    // empty-auto is wired by showEmpty() (the orb is re-created on clear/new chat).
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
    const sb = $('settings-btn'); if (sb) sb.addEventListener('click', () => openDrawer('settings'));
    $('thread').addEventListener('scroll', onThreadScroll, { passive: true });
    const jb = $('jump-btn'); if (jb) jb.addEventListener('click', jumpLatest);

    // Instant reattach on unlock/foreground — iOS suspends the socket while
    // backgrounded; don't wait out the reconnect backoff, snap back live the
    // moment the user returns. This is the "survives a phone lock" promise.
    const ensureLive = () => {
      if (!token || !sessionId || document.hidden) return;
      if (!ws || ws.readyState > 1) { reconnectDelay = 500; connect(false); }
    };
    document.addEventListener('visibilitychange', ensureLive);
    window.addEventListener('focus', ensureLive);

    if (token) tryToken(token).then(ok => ok ? boot() : showAuth());
    else showAuth();

    if (_standalone && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
      // Tapping a push when a window is already open: the SW focuses us and posts
      // which chat to show.
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'open-chat' && e.data.url) {
          try { const id = new URL(e.data.url, location.origin).searchParams.get('c'); if (id) openChatId(id); } catch {}
        }
      });
    }
  }
  // ── Mount API — one client, two surfaces ─────────────────────────────────
  // Markup injected into a ShadowRoot when embedded in the Stan CLI cockpit.
  // (The standalone PWA already has this markup inline in its index.html.)
  const EMBED_CSS = `
    :host {
      position: absolute; inset: 0; display: block;
      font-family: var(--font-ui); color: var(--text-primary);
      /* chat.css sets these on :root, which doesn't match inside a shadow tree,
         so redefine them on :host (inherited by shadow descendants). --canvas
         follows --bg from tokens.css, so it stays theme-aware automatically. */
      --canvas: var(--bg);
      --rail-w: 34px;
      --col-max: 740px;
      --halo: rgba(255,59,92,0.28);
      --blur: saturate(180%) blur(22px);
    }
    #app { position: absolute; }
    #auth-screen { display: none !important; }
    #drawer, #fleet { position: absolute; }
  `;
  const CHAT_HTML = `
  <div id="app">
    <header id="topbar">
      <button class="icon-btn" id="menu-btn" aria-label="Chats">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
      </button>
      <div class="topbar-title">
        <div class="topbar-name" id="chat-name">Stan Chat</div>
        <div class="topbar-sub" id="chat-status"><span class="status-dot" id="status-dot"></span><span id="status-text">offline</span></div>
      </div>
      <button class="icon-btn" id="fleet-btn" aria-label="Fleet" title="Agent fleet">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
      </button>
      <button class="icon-btn bolt" id="bolt-btn" aria-label="Quick auto session" title="Quick auto session">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z"/></svg>
      </button>
      <button class="icon-btn" id="new-btn" aria-label="New chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </header>
    <div id="thread">
      <div id="empty-state" class="empty-state">
        <div class="empty-orb">◉</div>
        <div class="empty-title">Talk to StanAI</div>
        <div class="empty-sub">Claude Code, live on the kay2 Pi — full repo access and every tool. Ask it to build, fix, explain or explore, and watch the work happen.</div>
        <div class="empty-actions"><button class="empty-auto" id="empty-auto">⚡ Quick auto session</button></div>
        <div class="empty-hint">or type <code>/auto</code> in the box to launch one instantly</div>
        <div class="empty-chips" id="empty-chips"></div>
      </div>
    </div>
    <button id="jump-btn" aria-label="Jump to latest">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
    </button>
    <div id="composer">
      <div id="composer-inner">
        <div id="slash-menu"></div>
        <div id="composer-meta">
          <button class="meta-chip" id="chip-project"><span class="meta-chip-k">dir</span><span id="chip-project-v">~</span></button>
          <button class="meta-chip" id="chip-mode"><span class="meta-chip-k">mode</span><span id="chip-mode-v">Plan</span></button>
          <button class="meta-usage" id="usage-pill" aria-label="Claude plan usage" hidden></button>
          <span class="meta-cost" id="meta-cost"></span>
        </div>
        <div id="attach-tray"></div>
        <div id="composer-row">
          <input id="file-input" type="file" multiple accept="image/*,.txt,.md,.json,.js,.ts,.py,.sh,.css,.html,.csv,.log,.pdf,.yml,.yaml,.toml" hidden>
          <button id="attach-btn" aria-label="Attach files" title="Attach files & photos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <button id="mic-btn" aria-label="Voice input" title="Tap to dictate" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
          </button>
          <textarea id="prompt" rows="1" placeholder="Message StanAI…  (/auto = autopilot)" spellcheck="false"></textarea>
          <button id="send-btn" aria-label="Send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
  <div id="fleet" class="hidden">
    <header class="fleet-head"><div class="fleet-title">Agent Fleet</div><button class="text-btn" id="fleet-close">Done</button></header>
    <div id="fleet-body"></div>
  </div>
  <div id="drawer" class="hidden">
    <div class="drawer-scrim" id="drawer-scrim"></div>
    <div class="drawer-panel">
      <div class="drawer-head">
        <span id="drawer-title">Chats</span>
        <button class="icon-sm" id="settings-btn" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
        <button class="icon-sm" id="theme-btn" aria-label="Theme" title="Theme"></button>
        <button class="text-btn" id="drawer-close">Done</button>
      </div>
      <div id="drawer-body"></div>
    </div>
  </div>`;

  function mount(opts = {}) {
    _root = opts.root || document;
    _standalone = opts.standalone !== false;
    token = localStorage.getItem(LS.token) || token;   // re-read: cockpit may auth after load
    if (!_standalone && !_root.getElementById('app')) {
      _root.innerHTML =
        (opts.css ? `<style>${opts.css}</style>` : '') +
        `<style>${EMBED_CSS}</style>` + CHAT_HTML;
    }
    init();
  }
  // Cockpit calls this when the Chat tab is re-shown: snap the socket back live.
  function show() {
    try {
      if (token && sessionId && (!ws || ws.readyState > 1)) { reconnectDelay = 500; connect(false); }
      stick = true; scheduleFlush(); fetchUsage();
    } catch {}
  }
  window.StanChat = { mount, show };

  // Standalone page auto-mounts; the cockpit embeds via StanChat.mount() instead.
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body && document.body.hasAttribute('data-stanchat-standalone'))
      mount({ root: document, standalone: true });
  });
})();
