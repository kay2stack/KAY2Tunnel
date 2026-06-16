// Stan CLI — Screen tab: Pi desktop via VNC over WebSocket
// On-screen keyboard (RPi-Connect style) sends X11 keysyms via RFB.sendKey,
// so a touchscreen with no physical keyboard can drive the real desktop.
const Screen = (() => {
  let _initialized = false;
  let _rfb = null;
  let _connected = false;

  // ── On-screen keyboard state ───────────────────────
  let _kbdOpen = false;
  let _shift = false;   // one-shot layer (or locked via Caps)
  let _caps = false;    // locks the shift layer
  const _mods = { Ctrl: false, Alt: false, Super: false };

  // X11 keysyms for special / modifier keys
  const SPECIAL = {
    Esc:   { ks: 0xff1b, code: 'Escape' },
    Tab:   { ks: 0xff09, code: 'Tab' },
    Bksp:  { ks: 0xff08, code: 'Backspace' },
    Enter: { ks: 0xff0d, code: 'Enter' },
    Del:   { ks: 0xffff, code: 'Delete' },
    Space: { ks: 0x0020, code: 'Space' },
    '←':   { ks: 0xff51, code: 'ArrowLeft' },
    '↑':   { ks: 0xff52, code: 'ArrowUp' },
    '↓':   { ks: 0xff54, code: 'ArrowDown' },
    '→':   { ks: 0xff53, code: 'ArrowRight' },
  };
  const MODKEYS = {
    Ctrl:  { ks: 0xffe3, code: 'ControlLeft' },
    Alt:   { ks: 0xffe9, code: 'AltLeft' },
    Super: { ks: 0xffeb, code: 'MetaLeft' },
    Shift: { ks: 0xffe1, code: 'ShiftLeft' },
  };

  // Keyboard layout. Printable keys are "lU" pairs (lower, shifted).
  // Objects are special keys ({sp}), modifiers ({mod}); `w` = width units.
  const ROWS = [
    ['`~','1!','2@','3#','4$','5%','6^','7&','8*','9(','0)','-_','=+',{ sp:'Bksp', w:2 }],
    [{ sp:'Tab', w:1.5 },'qQ','wW','eE','rR','tT','yY','uU','iI','oO','pP','[{',']}','\\|'],
    [{ sp:'Esc', w:1.5 },'aA','sS','dD','fF','gG','hH','jJ','kK','lL',';:','\'"',{ sp:'Enter', w:2.2 }],
    [{ mod:'Shift', w:2 },'zZ','xX','cC','vV','bB','nN','mM',',<','.>','/?',{ sp:'Del', w:1.5 }],
    [{ mod:'Ctrl', w:1.4 },{ mod:'Super', w:1.4 },{ mod:'Alt', w:1.4 },{ sp:'Space', w:5 },{ sp:'←' },{ sp:'↑' },{ sp:'↓' },{ sp:'→' }],
  ];

  function init() { _initialized = true; }

  function activate() {
    if (!_initialized) init();
    if (!_connected) renderIdle();
  }

  function deactivate() { /* keep connection alive across tab switches */ }

  async function ensureRFB() {
    if (window.RFB) return true;
    if (!document.querySelector('script[data-novnc]')) {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = '/vendor/novnc-loader.js';
      s.dataset.novnc = '1';
      document.head.appendChild(s);
    }
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (window.RFB) return true;
    }
    return false;
  }

  function renderIdle() {
    const panel = document.getElementById('tab-screen');
    if (!panel) return;
    const body = panel.querySelector('#screen-body');
    if (!body) return;
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;gap:24px;padding:40px 24px;text-align:center">
        <div style="width:72px;height:72px;border-radius:18px;
                    background:var(--bg-card);border:1px solid var(--border);
                    display:flex;align-items:center;justify-content:center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none"
               stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div>
          <div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-bottom:8px">Pi Desktop</div>
          <div style="font-size:15px;color:var(--text-dim);max-width:280px;line-height:1.5">
            Stream the Raspberry Pi display live to your device.
          </div>
        </div>
        <button id="screen-connect-btn" style="
          background:var(--accent);color:#fff;border:none;cursor:pointer;
          border-radius:var(--r-pill);padding:15px 40px;
          font-size:16px;font-weight:600;font-family:var(--font-ui);">
          Connect
        </button>
        <div id="screen-err-msg" style="color:var(--red);font-size:13px;display:none"></div>
      </div>
    `;
    document.getElementById('screen-connect-btn').addEventListener('click', connect);
    toggleTopbarButtons(false);
  }

  async function connect() {
    const btn = document.getElementById('screen-connect-btn');
    const err = document.getElementById('screen-err-msg');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    if (err) err.style.display = 'none';

    const loaded = await ensureRFB();
    if (!loaded || !window.RFB) {
      showErr('VNC client failed to load');
      if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
      return;
    }

    const body = document.getElementById('screen-body');
    if (!body) return;

    body.innerHTML = `
      <div id="screen-vnc-wrap" style="flex:1;overflow:hidden;background:#000;
           display:flex;align-items:center;justify-content:center;position:relative;">
        <button id="screen-kbd-toggle" class="screen-kbd-toggle" title="On-screen keyboard"
                aria-label="Toggle keyboard">⌨</button>
      </div>
      <div id="screen-kbd" class="screen-kbd hidden" aria-hidden="true"></div>
    `;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/vnc?token=${encodeURIComponent(App.token())}`;

    try {
      _rfb = new window.RFB(body.querySelector('#screen-vnc-wrap'), wsUrl, {
        credentials: { password: '' },
      });
    } catch (e) {
      showErr('Connection failed: ' + e.message);
      renderIdle();
      return;
    }

    _rfb.scaleViewport = true;
    _rfb.clipViewport = false;
    _rfb.resizeSession = false;

    _rfb.addEventListener('connect', () => {
      _connected = true;
      updateStatus('connected', 'Pi Desktop');
      toggleTopbarButtons(true);
    });

    _rfb.addEventListener('disconnect', e => {
      _connected = false;
      _rfb = null;
      closeKeyboard();
      const clean = e.detail?.clean;
      if (!clean && e.detail?.reason) {
        renderIdle();
        setTimeout(() => showErr(e.detail.reason), 50);
      } else {
        renderIdle();
      }
    });

    _rfb.addEventListener('credentialsrequired', () => {
      _rfb.sendCredentials({ password: '' });
    });

    buildKeyboard();
    document.getElementById('screen-kbd-toggle')?.addEventListener('click', toggleKeyboard);
  }

  function disconnect() {
    _rfb?.disconnect();
    _rfb = null;
    _connected = false;
    closeKeyboard();
    updateStatus('idle', 'Not connected');
    renderIdle();
  }

  // ── On-screen keyboard ─────────────────────────────
  function buildKeyboard() {
    const kbd = document.getElementById('screen-kbd');
    if (!kbd) return;
    kbd.innerHTML = '';
    ROWS.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'screen-kbd-row';
      row.forEach(key => rowEl.appendChild(buildKey(key)));
      kbd.appendChild(rowEl);
    });
    refreshKeyLabels();
  }

  function buildKey(key) {
    const btn = document.createElement('button');
    btn.className = 'screen-key';
    const w = (typeof key === 'object' && key.w) || 1;
    btn.style.flexGrow = String(w);
    btn.style.flexBasis = (w * 30) + 'px';

    if (typeof key === 'string') {
      // Printable "lU" pair
      const lower = key[0], upper = key[1] ?? key[0];
      btn.dataset.lower = lower;
      btn.dataset.upper = upper;
      btn.classList.add('screen-key-char');
      btn.textContent = lower;
      btn.addEventListener('click', () => onPrintable(btn));
    } else if (key.sp) {
      const def = SPECIAL[key.sp];
      btn.textContent = key.sp;
      btn.classList.add('screen-key-special');
      btn.addEventListener('click', () => { vncSendKey(def.ks, def.code); flash(btn); });
    } else if (key.mod) {
      btn.textContent = key.mod;
      btn.classList.add('screen-key-mod');
      btn.dataset.mod = key.mod;
      btn.addEventListener('click', () => onModifier(key.mod, btn));
      if (key.mod === 'Shift') {
        // double-tap Shift → Caps lock
        btn.addEventListener('dblclick', () => { _caps = true; _shift = true; syncMods(); refreshKeyLabels(); });
      }
    }
    return btn;
  }

  function onPrintable(btn) {
    const ch = (_shift || _caps) ? btn.dataset.upper : btn.dataset.lower;
    const ks = ch.codePointAt(0);
    vncSendKey(ks, codeForChar(ch));
    flash(btn);
    if (_shift && !_caps) { _shift = false; syncMods(); refreshKeyLabels(); }
  }

  function onModifier(name, btn) {
    if (name === 'Shift') {
      if (_caps) { _caps = false; _shift = false; }
      else _shift = !_shift;
    } else {
      _mods[name] = !_mods[name];
    }
    syncMods();
    refreshKeyLabels();
  }

  // Send a key through noVNC, wrapping with any held real modifiers.
  function vncSendKey(ks, code) {
    if (!_rfb) return;
    const held = [];
    if (_mods.Ctrl)  held.push(MODKEYS.Ctrl);
    if (_mods.Alt)   held.push(MODKEYS.Alt);
    if (_mods.Super) held.push(MODKEYS.Super);
    try {
      for (const m of held) _rfb.sendKey(m.ks, m.code, true);
      _rfb.sendKey(ks, code, true);
      _rfb.sendKey(ks, code, false);
      for (const m of held.reverse()) _rfb.sendKey(m.ks, m.code, false);
    } catch (e) { /* RFB gone mid-send */ }
    // one-shot real modifiers clear after use
    if (held.length) { _mods.Ctrl = _mods.Alt = _mods.Super = false; syncMods(); }
  }

  function codeForChar(ch) {
    if (/[a-zA-Z]/.test(ch)) return 'Key' + ch.toUpperCase();
    if (/[0-9]/.test(ch)) return 'Digit' + ch;
    if (ch === ' ') return 'Space';
    return null;
  }

  function refreshKeyLabels() {
    const up = _shift || _caps;
    document.querySelectorAll('#screen-kbd .screen-key-char').forEach(b => {
      b.textContent = up ? b.dataset.upper : b.dataset.lower;
    });
  }

  function syncMods() {
    document.querySelectorAll('#screen-kbd .screen-key-mod').forEach(b => {
      const m = b.dataset.mod;
      const on = m === 'Shift' ? (_shift || _caps) : _mods[m];
      b.classList.toggle('active', !!on);
      b.classList.toggle('locked', m === 'Shift' && _caps);
    });
  }

  function flash(btn) {
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 120);
  }

  function toggleKeyboard() {
    _kbdOpen ? closeKeyboard() : openKeyboard();
  }

  function openKeyboard() {
    const kbd = document.getElementById('screen-kbd');
    const toggle = document.getElementById('screen-kbd-toggle');
    if (!kbd) return;
    kbd.classList.remove('hidden');
    kbd.setAttribute('aria-hidden', 'false');
    toggle?.classList.add('active');
    _kbdOpen = true;
  }

  function closeKeyboard() {
    const kbd = document.getElementById('screen-kbd');
    const toggle = document.getElementById('screen-kbd-toggle');
    kbd?.classList.add('hidden');
    kbd?.setAttribute('aria-hidden', 'true');
    toggle?.classList.remove('active');
    _kbdOpen = false;
  }

  function toggleTopbarButtons(connected) {
    const c = document.getElementById('screen-topbar-connect-btn');
    const d = document.getElementById('screen-topbar-disconnect-btn');
    if (c) c.style.display = connected ? 'none' : '';
    if (d) d.style.display = connected ? '' : 'none';
  }

  function updateStatus(state, text) {
    const dot = document.getElementById('screen-status-dot');
    const label = document.getElementById('screen-status-label');
    if (dot) dot.style.background = state === 'connected' ? 'var(--green)'
                                  : state === 'error'     ? 'var(--red)'
                                                          : 'var(--text-dim)';
    if (label) label.textContent = text;
  }

  function showErr(msg) {
    const el = document.getElementById('screen-err-msg');
    if (el) { el.textContent = msg; el.style.display = ''; }
  }

  return { init, activate, deactivate, connect, disconnect, toggleKeyboard };
})();
