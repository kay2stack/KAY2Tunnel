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
  ];

  function getMacros() {
    try { return JSON.parse(localStorage.getItem('stan_macros') || 'null') || DEFAULT_MACROS; }
    catch { return DEFAULT_MACROS; }
  }

  let term, fitAddon, ws, wsOpen = false;
  let sessionId = localStorage.getItem('stan_session');
  let sessionName = null;
  let backoff = BACKOFF_INIT, reconnectTimer = null;
  let ctrlSticky = false, altSticky = false;
  let statusDot, sessionLabel;

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
        sessionLabel.textContent = msg.name || 'bash';
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
    if (ws) { wsOpen = false; ws.close(); }
    sessionId = id;
    connect(id);
  }

  function newSession() {
    if (ws) { wsOpen = false; ws.close(); }
    sessionId = null; localStorage.removeItem('stan_session');
    term.clear();
    connect();
  }

  function sendMsg(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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
    try {
      const r = await App.apiFetch('/api/term/sessions');
      const sessions = await r.json();
      if (!sessions.length) { content.innerHTML = '<p style="color:var(--color-text-dim);font-size:14px">No active sessions</p>'; return; }
      content.innerHTML = sessions.map(s => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-border)">
          <span class="status-dot connected"></span>
          <span style="flex:1;font-size:14px">${esc(s.name || 'bash')}</span>
          <span style="font-size:11px;color:var(--color-text-dim);font-family:var(--font-mono)">${s.id.slice(0,8)}</span>
          <button class="top-bar-action" onclick="App.openTerminalForSession('${s.id}');document.getElementById('sessions-sheet').classList.add('hidden')">Attach</button>
        </div>
      `).join('');
    } catch (e) { content.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`; }
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
    if (ws) { wsOpen = false; ws.close(); }
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
        if (sessionLabel) sessionLabel.textContent = msg.name || 'bash';
      } else if (msg.type === 'output') { term.write(msg.data); }
      else if (msg.type === 'exit') { sessionId = null; if (sessionLabel) sessionLabel.textContent = 'bash'; }
    });
    ws.addEventListener('close', () => { wsOpen = false; setStatus('reconnecting'); showPill('Reconnecting…'); reconnectTimer = setTimeout(() => { backoff = Math.min(backoff*2, BACKOFF_MAX); connect(); }, backoff); });
    ws.addEventListener('error', () => { wsOpen = false; setStatus('offline'); });
    term.onData(data => wsOpen && sendMsg({ type: 'input', data }));
  }

  function focus() { term?.focus(); }
  function paste(text) { if (wsOpen) sendMsg({ type: 'input', data: text }); focus(); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, focus, paste, attachSession, newSession, connectWs };
})();
