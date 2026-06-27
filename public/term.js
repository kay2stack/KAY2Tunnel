// Stan CLI — Terminal tab: xterm.js + session management + mobile key bar

const Term = (() => {
  const BACKOFF_INIT = 500, BACKOFF_MAX = 8000;

  const KEY_DEFS = [
    { label: 'Esc', send: '\x1b' },
    { label: 'Tab', send: '\t' },
    { label: 'Ctrl', sticky: true },
    { label: 'Alt',  sticky: true },
    { label: '↑', send: '\x1b[A' },
    { label: '↓', send: '\x1b[B' },
    { label: '←', send: '\x1b[D' },
    { label: '→', send: '\x1b[C' },
    { label: '⌫', send: '\x7f' },
    { label: '|', send: '|' },
    { label: '~', send: '~' },
    { label: '/', send: '/' },
    { label: '-', send: '-' },
    { label: ':', send: ':' },
  ];

  const DEFAULT_MACROS = [
    { label: 'git pull', cmd: 'git pull\n' },
    { label: 'git status', cmd: 'git status\n' },
    { label: 'pm2 status', cmd: 'pm2 status\n' },
    { label: 'npm i', cmd: 'npm install\n' },
    { label: 'claude', cmd: 'claude\n' },
    { label: 'auto mode', cmd: 'claude --permission-mode auto\n' },
    { label: 'dangerous auto', cmd: 'claude --dangerously-skip-permissions\n' },
  ];

  function getMacros() {
    try { return JSON.parse(localStorage.getItem('stan_macros') || 'null') || DEFAULT_MACROS; }
    catch { return DEFAULT_MACROS; }
  }

  let term, fitAddon, ws, wsOpen = false;
  let sessionId = localStorage.getItem('stan_session');
  let sessionName = null;
  let backoff = BACKOFF_INIT, reconnectTimer = null;
  let ignoreNextClose = false;
  let ctrlSticky = false, altSticky = false;
  let statusDot, sessionLabel;
  let toastTimer = null;

  function init() {
    if (term) return;
    statusDot   = document.getElementById('term-status-dot');
    sessionLabel = document.getElementById('term-session-label');

    term = new Terminal({
      theme: {
        background: '#0E0C15',
        foreground: '#E8E6F0',
        cursor: '#7C5CFF',
        cursorAccent: '#0E0C15',
        selectionBackground: 'rgba(124,92,255,0.25)',
        black:        '#1C1929', red:    '#F2503F', green:  '#3DD68C',
        yellow:       '#F5A623', blue:   '#41D7FF', magenta:'#B18CFF',
        cyan:         '#3DD68C', white:  '#E8E6F0',
        brightBlack:  '#5C5578', brightRed:  '#FF6B5A', brightGreen: '#5EEEA8',
        brightYellow: '#FFB84D', brightBlue: '#66E3FF', brightMagenta:'#C9A8FF',
        brightCyan:   '#5EEEA8', brightWhite:'#FFFFFF',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      allowProposedApi: true,
      scrollback: 5000,
      cursorBlink: true,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
    term.open(document.getElementById('terminal-container'));
    requestAnimationFrame(() => { fitAddon.fit(); sendMsg({ type: 'resize', cols: term.cols, rows: term.rows }); });

    term.onData(data => wsOpen && sendMsg({ type: 'input', data }));

    buildKeybar();
    connect();
    setupResize();
    setupPinchZoom();
    setupSessionsSheet();
    setupClipboardControls();
    setupClipsPanel();

    document.getElementById('term-new-btn').addEventListener('click', newSession);
  }

  function setStatus(state) {
    if (!statusDot) return;
    statusDot.className = 'status-dot ' + state;
  }

  function connect(overrideSession = null) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const sid = overrideSession || sessionId;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let url = `${proto}://${location.host}/ws/term?token=${encodeURIComponent(App.token())}`;
    if (sid) url += `&session=${encodeURIComponent(sid)}`;

    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      wsOpen = true;
      backoff = BACKOFF_INIT;
      setStatus('connected');
      hidePill();
    });

    ws.addEventListener('message', ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'session') {
        sessionId = msg.id;
        sessionName = msg.name;
        localStorage.setItem('stan_session', sessionId);
        sessionLabel.textContent = sessionTitle(msg);
      } else if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.writeln('\r\n\x1b[2m[process exited]\x1b[0m');
        sessionId = null; sessionName = null;
        localStorage.removeItem('stan_session');
        sessionLabel.textContent = 'bash';
      }
    });

    ws.addEventListener('close', () => {
      if (ignoreNextClose) { ignoreNextClose = false; return; }
      wsOpen = false; setStatus('reconnecting');
      showPill('Reconnecting…');
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, BACKOFF_MAX);
        connect();
      }, backoff);
    });

    ws.addEventListener('error', () => { wsOpen = false; setStatus('offline'); });
  }

  function attachSession(id) {
    if (id === sessionId) return;
    closeWsForSwitch();
    sessionId = id;
    connect(id);
  }

  function newSession() {
    closeWsForSwitch();
    sessionId = null; localStorage.removeItem('stan_session');
    term.clear();
    connect();
  }

  function closeWsForSwitch() {
    if (!ws) return;
    wsOpen = false;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ignoreNextClose = true;
      ws.close();
    }
  }

  function sendMsg(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ── Clipboard controls ─────────────────────────────
  function setupClipboardControls() {
    document.getElementById('term-copy-btn')?.addEventListener('click', copyTerminalText);
    document.getElementById('term-paste-btn')?.addEventListener('click', pasteFromClipboard);

    const sheet = document.getElementById('term-paste-sheet');
    const input = document.getElementById('term-paste-input');
    document.getElementById('term-paste-cancel-btn')?.addEventListener('click', closePasteSheet);
    document.getElementById('term-paste-send-btn')?.addEventListener('click', () => {
      const text = input?.value || '';
      if (!text) { closePasteSheet(); return; }
      paste(text);
      input.value = '';
      closePasteSheet();
      showToast('Sent to terminal');
    });
    sheet?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closePasteSheet();
    });
  }

  async function copyTerminalText() {
    const selection = term?.getSelection?.() || '';
    const text = selection || getVisibleTerminalText();
    if (!text) { showToast('Nothing to copy'); return; }

    try {
      await writeClipboard(text);
      showToast(selection ? 'Copied selection' : 'Copied visible terminal');
      term?.clearSelection?.();
    } catch {
      showToast('Copy blocked');
    } finally {
      focus();
    }
  }

  async function pasteFromClipboard() {
    try {
      if (!navigator.clipboard?.readText || !window.isSecureContext) throw new Error('Clipboard read unavailable');
      const text = await navigator.clipboard.readText();
      if (!text) { showToast('Clipboard is empty'); focus(); return; }
      paste(text);
      showToast('Pasted');
    } catch {
      openPasteSheet();
    }
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return; } catch {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;z-index:-1';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Clipboard write failed');
  }

  function getVisibleTerminalText() {
    const buffer = term?.buffer?.active;
    if (!buffer) return '';
    const lines = [];
    const start = buffer.viewportY;
    const end = Math.min(buffer.length, start + term.rows);
    for (let i = start; i < end; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n').replace(/\n+$/g, '');
  }

  function openPasteSheet() {
    const sheet = document.getElementById('term-paste-sheet');
    const input = document.getElementById('term-paste-input');
    sheet?.classList.remove('hidden');
    input.value = '';
    requestAnimationFrame(() => input?.focus());
  }

  function closePasteSheet() {
    document.getElementById('term-paste-sheet')?.classList.add('hidden');
    focus();
  }

  function showToast(text) {
    let toast = document.getElementById('term-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'term-toast';
      document.getElementById('tab-term')?.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 1400);
  }

  // ── Key bar ────────────────────────────────────────
  function buildKeybar() {
    const bar = document.getElementById('keybar');
    bar.innerHTML = '';
    KEY_DEFS.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'key-btn';
      btn.textContent = k.label;
      btn.setAttribute('data-label', k.label);
      if (k.sticky) btn.addEventListener('click', () => toggleSticky(k.label, btn));
      else btn.addEventListener('click', () => {
        let data = k.send;
        if (ctrlSticky && data.length === 1) { data = String.fromCharCode(data.charCodeAt(0) & 0x1f); clearSticky('Ctrl'); }
        if (altSticky) { data = '\x1b' + data; clearSticky('Alt'); }
        sendMsg({ type: 'input', data }); term.focus();
      });
      bar.appendChild(btn);
    });

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:20px;background:var(--border);flex-shrink:0;margin:0 4px;align-self:center';
    bar.appendChild(sep);

    // Macro buttons
    getMacros().forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'key-btn macro-btn';
      btn.textContent = m.label;
      btn.title = m.cmd.trim();
      btn.addEventListener('click', () => { paste(m.cmd); });
      bar.appendChild(btn);
    });
  }

  function toggleSticky(label, btn) {
    if (label === 'Ctrl') { ctrlSticky = !ctrlSticky; btn.classList.toggle('sticky-active', ctrlSticky); if (altSticky) clearSticky('Alt'); }
    else { altSticky = !altSticky; btn.classList.toggle('sticky-active', altSticky); if (ctrlSticky) clearSticky('Ctrl'); }
  }

  function clearSticky(label) {
    if (label === 'Ctrl') { ctrlSticky = false; document.querySelector('.key-btn[data-label="Ctrl"]')?.classList.remove('sticky-active'); }
    else { altSticky = false; document.querySelector('.key-btn[data-label="Alt"]')?.classList.remove('sticky-active'); }
  }

  // ── Reconnect pill ─────────────────────────────────
  let pill = null;
  function showPill(text) {
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'reconnect-pill';
      document.getElementById('tab-term').appendChild(pill);
    }
    pill.textContent = text; pill.style.display = 'block';
  }
  function hidePill() { if (pill) pill.style.display = 'none'; }

  // ── Sessions sheet ─────────────────────────────────
  function setupSessionsSheet() {
    document.getElementById('term-sessions-btn').addEventListener('click', openSessionsSheet);
    document.getElementById('sessions-close-btn').addEventListener('click', () =>
      document.getElementById('sessions-sheet').classList.add('hidden')
    );
    document.getElementById('sessions-sheet').addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });
  }

  async function openSessionsSheet() {
    const sheet = document.getElementById('sessions-sheet');
    const content = document.getElementById('sessions-list-content');
    sheet.classList.remove('hidden');
    content.innerHTML = '<p class="session-empty">Loading sessions…</p>';
    try {
      const r = await App.apiFetch('/api/term/sessions');
      if (!r.ok) throw new Error('Could not load sessions');
      const sessions = await r.json();
      renderSessionsList(content, sessions);
    } catch (e) { content.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`; }
  }

  let _sessFilter = 'all';
  function renderSessionsList(content, sessions) {
    content.innerHTML = '';
    if (!sessions.length) {
      const empty = document.createElement('p');
      empty.className = 'session-empty';
      empty.textContent = 'No active sessions';
      content.appendChild(empty);
      return;
    }

    // All / Shells / Chats toggle — only worth showing once a chat mirror exists.
    if (sessions.some(s => s.type === 'chat')) {
      const bar = document.createElement('div');
      bar.className = 'session-filter';
      bar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
      [['all', 'All'], ['shell', 'Shells'], ['chat', '💬 Chats']].forEach(([v, label]) => {
        const b = document.createElement('button');
        b.className = 'top-bar-action' + (_sessFilter === v ? ' primary' : '');
        b.textContent = label;
        b.addEventListener('click', () => { _sessFilter = v; renderSessionsList(content, sessions); });
        bar.appendChild(b);
      });
      content.appendChild(bar);
    }

    const shown = sessions.filter(s =>
      _sessFilter === 'all' ? true : _sessFilter === 'chat' ? s.type === 'chat' : s.type !== 'chat');
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'session-empty';
      empty.textContent = _sessFilter === 'chat' ? 'No chat mirrors' : 'No shell sessions';
      content.appendChild(empty);
      return;
    }
    shown
      .sort((a, b) => b.lastActive - a.lastActive)
      .forEach(s => content.appendChild(sessionRow(s)));
  }

  function sessionRow(s) {
    const row = document.createElement('div');
    row.className = 'session-row';
    if (s.id === sessionId) row.classList.add('active');

    const dot = document.createElement('span');
    dot.className = 'status-dot connected';
    row.appendChild(dot);

    const info = document.createElement('div');
    info.className = 'session-info';

    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = sessionTitle(s);
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = `${s.id.slice(0, 8)} · ${s.clients} attached`;
    info.appendChild(meta);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    const attachBtn = document.createElement('button');
    attachBtn.className = 'top-bar-action primary';
    attachBtn.textContent = s.id === sessionId ? 'Current' : 'Continue';
    attachBtn.disabled = s.id === sessionId;
    attachBtn.addEventListener('click', () => {
      App.openTerminalForSession(s.id);
      document.getElementById('sessions-sheet').classList.add('hidden');
    });
    actions.appendChild(attachBtn);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'top-bar-action';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => renameSession(s));
    actions.appendChild(renameBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'top-bar-action danger';
    removeBtn.textContent = 'Remove';
    const isChat = s.type === 'chat';
    removeBtn.disabled = s.id === sessionId || isChat;
    removeBtn.title = isChat ? 'Manage from Stan Chat'
      : s.id === sessionId ? 'Switch sessions before removing the current shell'
      : 'Stop this shell and remove it from the list';
    if (!isChat) removeBtn.addEventListener('click', () => removeSession(s));
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    return row;
  }

  async function renameSession(s) {
    const next = await App.prompt('Rename session', s.label || sessionTitle(s));
    if (next === null) return;
    try {
      const r = await App.apiFetch(`/api/term/sessions/${encodeURIComponent(s.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: next.trim() }),
      });
      if (!r.ok) {
        const data = await safeJson(r);
        throw new Error(data.error || 'Could not rename session');
      }
      const data = await r.json();
      if (s.id === sessionId) sessionLabel.textContent = data.label || s.name || s.cmd || 'bash';
      showToast(data.label ? 'Session renamed' : 'Session name cleared');
      openSessionsSheet();
    } catch (e) {
      showToast(e.message);
    }
  }

  async function removeSession(s) {
    if (!await App.confirm(`Remove “${sessionTitle(s)}”? This stops its shell.`, { title: 'Remove session', okLabel: 'Remove' })) return;
    try {
      const removingCurrent = s.id === sessionId;
      const r = await App.apiFetch(`/api/term/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      if (!r.ok) {
        const data = await safeJson(r);
        throw new Error(data.error || 'Could not remove session');
      }
      showToast('Session removed');
      if (removingCurrent) {
        sessionId = null;
        sessionName = null;
        localStorage.removeItem('stan_session');
        sessionLabel.textContent = 'bash';
        term.clear();
      }
      openSessionsSheet();
    } catch (e) {
      showToast(e.message);
    }
  }

  async function safeJson(r) {
    try { return await r.json(); }
    catch { return {}; }
  }

  // ── Resize ─────────────────────────────────────────
  function setupResize() {
    const fit = () => { fitAddon.fit(); sendMsg({ type: 'resize', cols: term.cols, rows: term.rows }); };
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
  }

  // ── Pinch zoom ─────────────────────────────────────
  function setupPinchZoom() {
    let last = null;
    const el = document.getElementById('terminal-container');
    el.addEventListener('touchmove', e => {
      if (e.touches.length !== 2) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (last !== null && Math.abs(d - last) > 5) {
        const next = Math.max(9, Math.min(26, term.options.fontSize + (d > last ? 1 : -1)));
        if (next !== term.options.fontSize) { term.options.fontSize = next; fitAddon.fit(); }
        last = d;
      } else { last = d; }
    }, { passive: true });
    el.addEventListener('touchend', () => { last = null; });
  }

  // Called by Agents when launching a named agent session
  function connectWs(url) {
    if (!term) init();
    closeWsForSwitch();
    sessionId = null; localStorage.removeItem('stan_session');
    term.clear();
    // Override the URL directly this one time
    ws = new WebSocket(url);
    ws.addEventListener('open', () => { wsOpen = true; backoff = BACKOFF_INIT; setStatus('connected'); hidePill(); });
    ws.addEventListener('message', ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'session') {
        sessionId = msg.id; sessionName = msg.name;
        localStorage.setItem('stan_session', sessionId);
        if (sessionLabel) sessionLabel.textContent = sessionTitle(msg);
      } else if (msg.type === 'output') { term.write(msg.data); }
      else if (msg.type === 'exit') { sessionId = null; if (sessionLabel) sessionLabel.textContent = 'bash'; }
    });
    ws.addEventListener('close', () => {
      if (ignoreNextClose) { ignoreNextClose = false; return; }
      wsOpen = false; setStatus('reconnecting'); showPill('Reconnecting…'); reconnectTimer = setTimeout(() => { backoff = Math.min(backoff*2, BACKOFF_MAX); connect(); }, backoff);
    });
    ws.addEventListener('error', () => { wsOpen = false; setStatus('offline'); });
  }

  function focus() { term?.focus(); }
  function paste(text) { if (wsOpen) sendMsg({ type: 'input', data: text }); focus(); }
  function sessionTitle(s) {
    const base = s.label || s.name || s.cmd || 'bash';
    // Chat mirrors (server type 'chat', id 'chat:<uuid>') get a 💬 and lose the prefix.
    if (s.type === 'chat') return '💬 ' + String(base).replace(/^chat:/, '');
    return base;
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── Clips panel ────────────────────────────────────
  let _clipsPollTimer = null;

  function setupClipsPanel() {
    document.getElementById('term-clips-btn')?.addEventListener('click', openClipsPanel);
    document.getElementById('clips-panel-close-btn')?.addEventListener('click', closeClipsPanel);
    document.getElementById('clips-panel')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeClipsPanel();
    });
  }

  function openClipsPanel() {
    const panel = document.getElementById('clips-panel');
    panel?.classList.remove('hidden');
    loadClips();
    _clipsPollTimer = setInterval(loadClips, 3000);
  }

  function closeClipsPanel() {
    clearInterval(_clipsPollTimer);
    document.getElementById('clips-panel')?.classList.add('hidden');
    focus();
  }

  async function loadClips() {
    const list = document.getElementById('clips-panel-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:13px;">Loading…</div>';
    try {
      const r = await App.apiFetch('/api/clips/remote');
      if (!r.ok) throw new Error('error');
      const clips = await r.json();
      renderClipsList(clips);
    } catch {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:13px;">Clip app unavailable</div>';
    }
  }

  function renderClipsList(clips) {
    const list = document.getElementById('clips-panel-list');
    if (!list) return;
    if (!clips.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:13px;">No clips yet</div>';
      return;
    }
    list.innerHTML = clips.map(clip => {
      const preview = clip.text.length > 120 ? clip.text.slice(0, 120) + '…' : clip.text;
      const typeColor = clip.type === 'url' ? 'var(--accent)' : clip.type === 'code' ? 'var(--green)' : 'var(--text-dim)';
      return `
        <div class="clips-panel-row" data-id="${esc(clip.id)}">
          <div class="clips-panel-preview ${clip.type === 'code' ? 'mono' : ''}">${esc(preview)}</div>
          <div class="clips-panel-meta">
            <span style="color:${typeColor};font-size:10px;font-weight:700;text-transform:uppercase">${esc(clip.type)}</span>
            ${clip.device ? `<span>· ${esc(clip.device)}</span>` : ''}
          </div>
          <div class="clips-panel-actions">
            <button class="clips-paste-btn top-bar-action" data-text="${esc(clip.text)}">Paste</button>
            <button class="clips-run-btn top-bar-action primary" data-text="${esc(clip.text)}">Run</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.clips-paste-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        paste(btn.dataset.text);
        closeClipsPanel();
        showToast('Pasted to terminal');
      });
    });
    list.querySelectorAll('.clips-run-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        paste(btn.dataset.text + '\r');
        closeClipsPanel();
        showToast('Running in terminal');
      });
    });
  }

  return { init, focus, paste, attachSession, newSession, connectWs };
})();
