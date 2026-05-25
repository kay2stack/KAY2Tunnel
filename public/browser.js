// Stan CLI — Remote Browser tab (Chromium CDP bridge)

const Browser = (() => {
  let _initialized = false;
  let _pollInterval = null;
  let _connected = false;
  let _imgW = 1280;
  let _imgH = 720;

  function init() {}

  function activate() {
    if (!_initialized) { _initialized = true; buildUI(); }
    checkStatus();
    _startPolling();
  }

  function deactivate() { _stopPolling(); }

  function _startPolling() {
    _stopPolling();
    _pollInterval = setInterval(_tick, 800);
  }

  function _stopPolling() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  function _tick() {
    if (_connected) _refreshFrame();
  }

  // ── Build static UI ──────────────────────────────
  function buildUI() {
    const panel = document.getElementById('browser-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="browser-toolbar">
        <button class="browser-nav-btn" id="br-back" title="Back">←</button>
        <button class="browser-nav-btn" id="br-fwd" title="Forward">→</button>
        <button class="browser-nav-btn" id="br-refresh" title="Refresh">↺</button>
        <input class="browser-url-input" id="br-url" type="url" placeholder="https://…" spellcheck="false" autocomplete="off">
        <button class="browser-nav-btn" id="br-go">Go</button>
      </div>
      <div class="browser-viewport" id="br-viewport">
        <div class="browser-offline" id="br-offline">
          <div class="browser-offline-inner">
            <div class="browser-offline-icon">🖥</div>
            <div class="browser-offline-title">Browser offline</div>
            <div class="browser-offline-hint">
              Start Chromium with remote debugging enabled:
            </div>
            <code class="browser-offline-cmd">chromium-browser --remote-debugging-port=9222 --no-sandbox --disable-gpu &amp;</code>
            <button class="agent-btn primary" id="br-connect-btn" style="margin-top:16px;width:100%">Connect</button>
          </div>
        </div>
        <img class="browser-frame" id="br-frame" draggable="false" alt="">
      </div>
      <div class="browser-type-row">
        <input class="browser-type-input" id="br-type-input" type="text" placeholder="Type text in browser…" autocomplete="off">
        <button class="browser-nav-btn" id="br-type-send">Send</button>
        <button class="browser-nav-btn" id="br-enter">↵</button>
      </div>
    `;

    // Toolbar events
    document.getElementById('br-back').addEventListener('click', () => apiBrowser('back'));
    document.getElementById('br-fwd').addEventListener('click', () => apiBrowser('forward'));
    document.getElementById('br-refresh').addEventListener('click', () => apiBrowser('refresh'));
    document.getElementById('br-go').addEventListener('click', navigate);
    document.getElementById('br-url').addEventListener('keydown', e => { if (e.key === 'Enter') navigate(); });
    document.getElementById('br-connect-btn').addEventListener('click', checkStatus);

    // Click forwarding
    document.getElementById('br-frame').addEventListener('click', onFrameClick);

    // Type row
    document.getElementById('br-type-send').addEventListener('click', sendType);
    document.getElementById('br-enter').addEventListener('click', () => apiBrowser('key', { key: 'Return' }));
    document.getElementById('br-type-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendType(); });
  }

  async function checkStatus() {
    try {
      const r = await App.apiFetch('/api/browser/status');
      const s = await r.json();
      _connected = s.connected;
      updateConnectedState(s);
    } catch { _connected = false; setOffline(); }
  }

  function updateConnectedState(s) {
    const frame = document.getElementById('br-frame');
    const offline = document.getElementById('br-offline');
    const urlInput = document.getElementById('br-url');

    if (!frame || !offline) return;

    if (s.connected) {
      offline.style.display = 'none';
      frame.style.display = 'block';
      if (urlInput && s.url) urlInput.value = s.url;
      _refreshFrame();
    } else {
      setOffline();
    }
  }

  function setOffline() {
    _connected = false;
    const frame = document.getElementById('br-frame');
    const offline = document.getElementById('br-offline');
    if (frame) frame.style.display = 'none';
    if (offline) offline.style.display = 'flex';
  }

  function _refreshFrame() {
    const frame = document.getElementById('br-frame');
    if (!frame) return;
    const token = App.token();
    const url = `/api/browser/screenshot?token=${encodeURIComponent(token)}&_t=${Date.now()}`;
    const tmp = new Image();
    tmp.onload = () => {
      _imgW = tmp.naturalWidth;
      _imgH = tmp.naturalHeight;
      frame.src = url;
    };
    tmp.onerror = () => { _connected = false; };
    tmp.src = url;
  }

  function onFrameClick(e) {
    if (!_connected) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const scaleX = _imgW / rect.width;
    const scaleY = _imgH / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    apiBrowser('click', { x, y });
  }

  function navigate() {
    let url = (document.getElementById('br-url')?.value || '').trim();
    if (!url) return;
    if (!url.startsWith('http')) url = 'https://' + url;
    apiBrowser('navigate', { url });
  }

  function sendType() {
    const input = document.getElementById('br-type-input');
    const text = input?.value || '';
    if (!text) return;
    input.value = '';
    apiBrowser('type', { text });
  }

  async function apiBrowser(action, body = {}) {
    const methods = { back: 'POST', forward: 'POST', refresh: 'POST', navigate: 'POST', click: 'POST', type: 'POST', key: 'POST' };
    const method = methods[action] || 'POST';
    try {
      const r = await App.apiFetch('/api/browser/' + action, {
        method,
        headers: Object.keys(body).length ? { 'Content-Type': 'application/json' } : {},
        body: Object.keys(body).length ? JSON.stringify(body) : undefined,
      });
      const result = await r.json();
      if (!result.ok && action === 'navigate' && result.error) {
        console.warn('navigate failed:', result.error);
        _connected = false; setOffline(); checkStatus();
      }
      if (action === 'navigate' || action === 'refresh') {
        setTimeout(_refreshFrame, 500);
        const url = body.url;
        if (url) { const el = document.getElementById('br-url'); if (el) el.value = url; }
      }
    } catch (e) {
      _connected = false; setOffline(); checkStatus();
    }
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, activate, deactivate };
})();
