// Stan CLI — Phone tab: live Android screen mirror + touch control over ADB.
// Polls /api/android/screen for frames and forwards taps/swipes/keys/text back.
// Same idea as the Pi Desktop (VNC) tab, but for Kane's connected Nokia.
const Phone = (() => {
  let _initialized = false;
  let _streaming = false;
  let _dev = { width: 1080, height: 2408 };   // device pixels
  let _frameTimer = null;
  let _statusTimer = null;
  let _lastUrl = null;
  let _pointer = null;                          // { x, y, t } at pointerdown

  const FRAME_GAP_MS = 450;                     // ~2 fps; gentle on battery + USB

  function init() { _initialized = true; }

  function activate() {
    if (!_initialized) init();
    if (!_streaming) renderIdle();
  }

  function deactivate() { stop(); }

  // ── Idle / connect screen ──────────────────────────
  function renderIdle() {
    const body = document.getElementById('phone-body');
    if (!body) return;
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;gap:24px;padding:40px 24px;text-align:center">
        <div style="width:72px;height:72px;border-radius:18px;background:var(--bg-card);
                    border:1px solid var(--border);display:flex;align-items:center;justify-content:center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/>
          </svg>
        </div>
        <div>
          <div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-bottom:8px">Android Phone</div>
          <div style="font-size:15px;color:var(--text-dim);max-width:300px;line-height:1.5" id="phone-idle-sub">
            Mirror the connected phone and drive it by touch.
          </div>
        </div>
        <button id="phone-connect-btn" style="background:var(--accent);color:#fff;border:none;cursor:pointer;
          border-radius:var(--r-pill);padding:15px 40px;font-size:16px;font-weight:600;font-family:var(--font-ui)">
          Connect
        </button>
        <div id="phone-err-msg" style="color:var(--red);font-size:13px;display:none"></div>
      </div>`;
    document.getElementById('phone-connect-btn').addEventListener('click', start);
    toggleTopbarButtons(false);
    // Probe device so the idle screen shows what we'd connect to.
    App.apiFetch('/api/android/status').then(r => r.json()).then(s => {
      const sub = document.getElementById('phone-idle-sub');
      if (sub && s.connected) sub.textContent = `${s.model} · Android ${s.android} · ${s.width}×${s.height}`;
      else if (sub) sub.textContent = 'No device detected — plug in over USB and allow debugging.';
    }).catch(() => {});
  }

  // ── Live mirror ────────────────────────────────────
  async function start() {
    const err = document.getElementById('phone-err-msg');
    if (err) err.style.display = 'none';

    let s;
    try { s = await App.apiFetch('/api/android/status').then(r => r.json()); }
    catch { return showErr('Could not reach server'); }
    if (!s.connected) return showErr(s.error || 'No phone connected');
    _dev = { width: s.width, height: s.height };

    const body = document.getElementById('phone-body');
    body.innerHTML = `
      <div id="phone-stage">
        <img id="phone-screen" alt="phone screen" draggable="false"/>
      </div>
      <div id="phone-keybar">
        <button class="phone-key" data-key="recents" title="Recents">▢</button>
        <button class="phone-key" data-key="home" title="Home">○</button>
        <button class="phone-key" data-key="back" title="Back">‹</button>
        <input id="phone-text" class="phone-text" placeholder="type text…" autocapitalize="off"
               autocomplete="off" autocorrect="off" spellcheck="false"/>
        <button class="phone-key" id="phone-send" title="Send text + Enter">⏎</button>
      </div>`;

    _streaming = true;
    updateStatus('connected', `${s.model} · ${s.battery ?? '?'}%${s.charging ? ' ⚡' : ''}`);
    toggleTopbarButtons(true);

    const img = document.getElementById('phone-screen');
    img.addEventListener('pointerdown', onPointerDown);
    img.addEventListener('pointerup', onPointerUp);
    img.addEventListener('contextmenu', e => e.preventDefault());

    document.querySelectorAll('#phone-keybar .phone-key[data-key]').forEach(b =>
      b.addEventListener('click', () => sendInput({ type: 'key', key: b.dataset.key })));
    document.getElementById('phone-send').addEventListener('click', sendText);
    document.getElementById('phone-text').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); sendText(); }
    });

    loopFrames();
    _statusTimer = setInterval(refreshStatus, 5000);
  }

  function stop() {
    _streaming = false;
    if (_frameTimer) { clearTimeout(_frameTimer); _frameTimer = null; }
    if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
    if (_lastUrl) { URL.revokeObjectURL(_lastUrl); _lastUrl = null; }
  }

  function disconnect() {
    stop();
    updateStatus('idle', 'Not connected');
    renderIdle();
  }

  async function loopFrames() {
    if (!_streaming) return;
    try {
      const blob = await App.apiFetch('/api/android/screen').then(r => {
        if (!r.ok) throw new Error('frame ' + r.status);
        return r.blob();
      });
      const img = document.getElementById('phone-screen');
      if (img) {
        const url = URL.createObjectURL(blob);
        img.src = url;
        if (_lastUrl) URL.revokeObjectURL(_lastUrl);
        _lastUrl = url;
      }
    } catch (e) { /* transient — keep last frame, retry */ }
    if (_streaming) _frameTimer = setTimeout(loopFrames, FRAME_GAP_MS);
  }

  async function refreshStatus() {
    try {
      const s = await App.apiFetch('/api/android/status').then(r => r.json());
      if (s.connected) updateStatus('connected', `${s.model} · ${s.battery ?? '?'}%${s.charging ? ' ⚡' : ''}`);
    } catch {}
  }

  // ── Touch → device coordinate mapping ──────────────
  function toDevice(ev, img) {
    const r = img.getBoundingClientRect();
    // The image is object-fit:contain inside the stage; rect is the drawn area.
    const x = ((ev.clientX - r.left) / r.width) * _dev.width;
    const y = ((ev.clientY - r.top) / r.height) * _dev.height;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function onPointerDown(e) {
    e.preventDefault();
    _pointer = { ...toDevice(e, e.currentTarget), t: Date.now() };
  }

  function onPointerUp(e) {
    if (!_pointer) return;
    const end = toDevice(e, e.currentTarget);
    const dx = end.x - _pointer.x, dy = end.y - _pointer.y;
    const dist = Math.hypot(dx, dy);
    const dt = Date.now() - _pointer.t;
    if (dist < 20) {
      sendInput({ type: 'tap', x: _pointer.x, y: _pointer.y });
    } else {
      sendInput({ type: 'swipe', x1: _pointer.x, y1: _pointer.y, x2: end.x, y2: end.y,
                  dur: Math.max(80, Math.min(800, dt)) });
    }
    _pointer = null;
    setTimeout(loopOnce, 180);   // refresh promptly after an action
  }

  function sendText() {
    const inp = document.getElementById('phone-text');
    if (!inp || !inp.value) return;
    sendInput({ type: 'text', text: inp.value })
      .then(() => sendInput({ type: 'key', key: 'enter' }));
    inp.value = '';
    setTimeout(loopOnce, 200);
  }

  function sendInput(payload) {
    return App.apiFetch('/api/android/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  // grab a single fresh frame out of band (after an action)
  async function loopOnce() {
    if (!_streaming) return;
    try {
      const blob = await App.apiFetch('/api/android/screen').then(r => r.blob());
      const img = document.getElementById('phone-screen');
      if (img) { const u = URL.createObjectURL(blob); img.src = u; if (_lastUrl) URL.revokeObjectURL(_lastUrl); _lastUrl = u; }
    } catch {}
  }

  // ── Topbar helpers (mirror screen.js) ──────────────
  function toggleTopbarButtons(connected) {
    const c = document.getElementById('phone-topbar-connect-btn');
    const d = document.getElementById('phone-topbar-disconnect-btn');
    if (c) c.style.display = connected ? 'none' : '';
    if (d) d.style.display = connected ? '' : 'none';
  }

  function updateStatus(state, text) {
    const dot = document.getElementById('phone-status-dot');
    const label = document.getElementById('phone-status-label');
    if (dot) dot.style.background = state === 'connected' ? 'var(--green)'
                                  : state === 'error' ? 'var(--red)' : 'var(--text-dim)';
    if (label) label.textContent = text;
  }

  function showErr(msg) {
    const el = document.getElementById('phone-err-msg');
    if (el) { el.textContent = msg; el.style.display = ''; }
  }

  return { init, activate, deactivate, connect: start, disconnect };
})();
