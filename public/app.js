// Stan CLI — app bootstrap, auth, tab routing

const App = (() => {
  let _token = null;
  let _activeTab = 'home';

  function token() { return _token; }

  function apiFetch(path, opts = {}) {
    return fetch(path, {
      ...opts,
      headers: { 'Authorization': 'Bearer ' + _token, ...(opts.headers || {}) },
    }).then(r => {
      if (r.status === 401) { logout(); throw new Error('401'); }
      return r;
    });
  }

  function logout() {
    localStorage.removeItem('stan_token');
    _token = null;
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
  }

  function showTab(name) {
    // Deactivate current
    if (_activeTab === 'agents'  && typeof Agents  !== 'undefined' && name !== 'agents')  Agents.deactivate?.();
    if (_activeTab === 'pi'      && typeof Pi       !== 'undefined' && name !== 'pi')      Pi.deactivate?.();
    if (_activeTab === 'browser' && typeof Browser  !== 'undefined' && name !== 'browser') Browser.deactivate?.();
    if (_activeTab === 'phone'   && typeof Phone    !== 'undefined' && name !== 'phone')   Phone.deactivate?.();

    // Hide all panels, clear active tab buttons
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    const panel = document.getElementById('tab-' + name);
    if (!panel) return;
    panel.classList.remove('hidden');

    // Activate the correct tab button (pi/browser don't have tab buttons — highlight 'more')
    const tabName = (name === 'pi' || name === 'browser' || name === 'phone' || name === 'ops') ? 'more' : name;
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');

    _activeTab = name;

    // Back buttons for secondary panels
    const piBack = document.getElementById('pi-back-btn');
    const browserBack = document.getElementById('browser-back-btn');
    if (piBack) piBack.style.display = name === 'pi' ? '' : 'none';
    if (browserBack) browserBack.style.display = name === 'browser' ? '' : 'none';

    // Activate
    if (name === 'term')     { Term.init(); Term.focus(); }
    if (name === 'projects') Projects.activate();
    if (name === 'agents')   Agents.activate();
    if (name === 'pi')       Pi?.activate();
    if (name === 'browser')  Browser?.activate();
    if (name === 'screen')   Screen?.activate();
    if (name === 'phone')    Phone?.activate();
    if (name === 'ops')      Ops?.activate();
    if (name === 'home')     loadHomeStats();
    if (name === 'more')     { loadMoreStats(); loadSettings(); refreshNotifUI(); }

    // Split view (wide screens): keep the terminal pinned beside the active tab.
    applySplit();
    if (splitActive() && name !== 'term') {
      document.getElementById('tab-term')?.classList.remove('hidden');
      Term.init();
    }
    if (splitActive()) window.dispatchEvent(new Event('resize'));
  }

  function openTerminalForSession(sessionId) {
    showTab('term');
    Term.attachSession(sessionId);
  }

  // Single source of truth — also consumed by agents.js via App.AGENT_ICONS
  const AGENT_ICONS = {
    'claude-code':  { letter: 'C', bg: '#D4763B' },
    'codex':        { letter: 'X', bg: '#10A37F' },
    'gemini':       { letter: 'G', bg: '#4285F4' },
    'cursor-agent': { letter: '▸', bg: '#0E0E0E' },
    'hermes':       { letter: 'H', bg: '#D4A017' },
    'clive':        { letter: '◈', bg: '#0AA6C2' },
    'stan':         { letter: '◉', bg: '#FF3B5C' },
  };

  // ── Toasts + dialogs (replace blocking alert/confirm/prompt) ──────────
  function toast(msg, type = 'info', ms = 3200) {
    let host = document.getElementById('toast-host');
    if (!host) { host = document.createElement('div'); host.id = 'toast-host'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = String(msg);
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 250); }, ms);
  }

  function _dialog({ title, message, value, input = false, okLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'app-dialog-overlay';
      ov.innerHTML = `
        <div class="app-dialog">
          ${title ? `<div class="app-dialog-title">${esc(title)}</div>` : ''}
          ${message ? `<div class="app-dialog-msg">${esc(message)}</div>` : ''}
          ${input ? `<input class="app-dialog-input" type="text" autocapitalize="off" autocomplete="off" spellcheck="false">` : ''}
          <div class="app-dialog-actions">
            <button class="app-dialog-btn cancel">${esc(cancelLabel)}</button>
            <button class="app-dialog-btn ok${danger ? ' danger' : ''}">${esc(okLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const inp = ov.querySelector('.app-dialog-input');
      if (inp) { inp.value = value || ''; setTimeout(() => { inp.focus(); inp.select(); }, 60); }
      const done = (result) => { ov.classList.add('hide'); setTimeout(() => ov.remove(), 200); resolve(result); };
      ov.querySelector('.cancel').addEventListener('click', () => done(input ? null : false));
      ov.querySelector('.ok').addEventListener('click', () => done(input ? inp.value : true));
      ov.addEventListener('click', e => { if (e.target === ov) done(input ? null : false); });
      if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } });
      requestAnimationFrame(() => ov.classList.add('show'));
    });
  }
  function confirmDialog(message, opts = {}) {
    return _dialog({ title: opts.title || 'Confirm', message, okLabel: opts.okLabel || 'Confirm',
      cancelLabel: opts.cancelLabel || 'Cancel', danger: opts.danger !== false });
  }
  function promptDialog(label, value = '') {
    return _dialog({ title: label, input: true, value, okLabel: 'OK' });
  }

  // ── Bottom sheet (reusable) ───────────────────────────────────────────
  function _bottomSheet(title, build) {
    const ov = document.createElement('div');
    ov.className = 'app-sheet-overlay';
    ov.innerHTML = `
      <div class="app-sheet">
        <div class="app-sheet-head">
          <span class="app-sheet-title">${esc(title)}</span>
          <button class="app-sheet-close">Done</button>
        </div>
        <div class="app-sheet-body"></div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.classList.add('hide'); setTimeout(() => ov.remove(), 200); };
    ov.querySelector('.app-sheet-close').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    build(ov.querySelector('.app-sheet-body'), close);
    requestAnimationFrame(() => ov.classList.add('show'));
    return close;
  }

  // ── Open Claude (claude.ai → native app via universal link on iOS) ────
  function openClaude() { window.open('https://claude.ai', '_blank', 'noopener'); }

  // External URL other devices use to reach the Pi (matches Connection row).
  function tunnelBase() { return 'https://stan.spikeradar.co.uk'; }

  function _makeQR(text, ec = 'M') {
    if (typeof qrcode === 'undefined') return null;
    try { const q = qrcode(0, ec); q.addData(text); q.make(); return q; }
    catch {
      for (let t = 4; t <= 25; t++) {
        try { const q = qrcode(t, ec); q.addData(text); q.make(); return q; } catch {}
      }
      return null;
    }
  }

  // ── QR to add a device ────────────────────────────────────────────────
  function openDeviceQR() {
    _bottomSheet('Add a device', (body) => {
      let withToken = true;
      const render = () => {
        const url = tunnelBase() + (withToken && _token ? '/#t=' + encodeURIComponent(_token) : '/');
        let svg = '';
        const qr = _makeQR(url);
        if (qr) { try { svg = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch {} }
        body.innerHTML = `
          <div class="qr-card">${svg || '<div style="padding:48px;color:var(--text-dim)">QR unavailable</div>'}</div>
          <div class="qr-url">${esc(url)}</div>
          <label class="qr-toggle"><input type="checkbox" ${withToken ? 'checked' : ''}> Include token (auto sign-in)</label>
          <div class="qr-note">${withToken ? 'Scan on a trusted device — it signs in automatically.' : 'Scan to open the app, then enter the token manually.'}</div>`;
        body.querySelector('.qr-toggle input').addEventListener('change', e => { withToken = e.target.checked; render(); });
      };
      render();
    });
  }

  // ── App-wide shared clipboard (synced across devices by the clip app) ──
  function openClipboard() {
    _bottomSheet('Shared Clipboard', (body) => {
      body.innerHTML = `
        <div class="clip-add">
          <input class="clip-add-input" placeholder="Add to shared clipboard…" autocapitalize="off" autocomplete="off">
          <button class="clip-add-btn">Add</button>
        </div>
        <div class="clip-list"><div class="sheet-empty">Loading…</div></div>`;
      const listEl = body.querySelector('.clip-list');
      const addInput = body.querySelector('.clip-add-input');
      const addBtn = body.querySelector('.clip-add-btn');

      const loadList = async () => {
        let clips = [];
        try {
          const r = await apiFetch('/api/clips/remote');
          if (!r.ok) throw new Error('x');
          clips = await r.json();
        } catch { listEl.innerHTML = '<div class="sheet-empty">Clip service unavailable</div>'; return; }
        if (!Array.isArray(clips) || !clips.length) {
          listEl.innerHTML = '<div class="sheet-empty">No clips yet — copy something on any device.</div>'; return;
        }
        listEl.innerHTML = '';
        clips.forEach(clip => {
          const preview = clip.text.length > 160 ? clip.text.slice(0, 160) + '…' : clip.text;
          const row = document.createElement('div');
          row.className = 'clip-item';
          row.innerHTML = `
            <div class="clip-item-text ${clip.type === 'code' ? 'mono' : ''}">${esc(preview)}</div>
            <div class="clip-item-actions">
              <button class="clip-copy">Copy</button>
              <button class="clip-term">→ Terminal</button>
            </div>`;
          row.querySelector('.clip-copy').addEventListener('click', () => {
            navigator.clipboard?.writeText(clip.text)
              .then(() => toast('Copied to this device', 'success', 1300))
              .catch(() => toast('Copy failed', 'error'));
          });
          row.querySelector('.clip-term').addEventListener('click', () => {
            showTab('term'); setTimeout(() => { try { Term.paste(clip.text); } catch {} }, 120);
          });
          listEl.appendChild(row);
        });
      };

      const doAdd = async () => {
        const t = addInput.value.trim();
        if (!t) return;
        addBtn.disabled = true;
        try {
          await apiFetch('/api/clips/remote', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: t }),
          });
          addInput.value = ''; toast('Added to clipboard', 'success', 1300); await loadList();
        } catch (e) { toast('Add failed: ' + e.message, 'error'); }
        addBtn.disabled = false;
      };
      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      loadList();
    });
  }

  // ── Push notifications ────────────────────────────────────────────────
  function _b64ToU8(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64); const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function _pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  async function refreshNotifUI() {
    const val = document.getElementById('more-notif-val');
    if (!val) return;
    if (!_pushSupported()) { val.textContent = 'Not supported'; return; }
    let on = false;
    try { const reg = await navigator.serviceWorker.ready; on = !!(await reg.pushManager.getSubscription()); } catch {}
    val.textContent = on ? 'On' : 'Off';
    val.style.color = on ? 'var(--green)' : 'var(--text-dim)';
  }
  async function toggleNotifications() {
    if (!_pushSupported()) { toast('Notifications not supported on this device', 'error'); return; }
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      try { await apiFetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) }); } catch {}
      try { await existing.unsubscribe(); } catch {}
      toast('Notifications off', 'info', 1500); refreshNotifUI(); return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notification permission denied', 'error'); refreshNotifUI(); return; }
    try {
      const { key } = await apiFetch('/api/push/vapid').then(r => r.json());
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToU8(key) });
      await apiFetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
      toast('Notifications on ✓', 'success', 1800);
      apiFetch('/api/push/test', { method: 'POST' }).catch(() => {});
    } catch (e) {
      toast('Could not enable: ' + (e.message || e), 'error');
    }
    refreshNotifUI();
  }

  // ── Split view (wide screens) ─────────────────────────────────────────
  let _split = localStorage.getItem('stan_split') === '1';
  function splitActive() { return _split && window.matchMedia('(min-width: 920px)').matches; }
  function applySplit() { document.body.classList.toggle('split', splitActive()); }
  function refreshSplitUI() {
    const v = document.getElementById('more-split-val');
    if (!v) return;
    v.textContent = _split ? 'On' : 'Off';
    v.style.color = _split ? 'var(--green)' : 'var(--text-dim)';
  }
  function toggleSplit() {
    _split = !_split; localStorage.setItem('stan_split', _split ? '1' : '0');
    refreshSplitUI();
    showTab(_activeTab);  // re-applies layout + terminal pinning
  }

  // QR/handoff: a token in the URL hash signs this device in, then is stripped.
  async function tryHashToken() {
    const m = (location.hash || '').match(/(?:^#|&)(?:t|token)=([^&]+)/);
    if (!m) return false;
    const t = decodeURIComponent(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const r = await fetch('/api/term/sessions', { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) return false;
      _token = t; localStorage.setItem('stan_token', t); launch(); return true;
    } catch { return false; }
  }

  async function loadHomeStats() {
    // Date
    const dateEl = document.getElementById('home-date');
    if (dateEl) {
      const d = new Date();
      dateEl.textContent = d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
    }

    // Parallel fetches
    const [sessions, agents, projects, sys] = await Promise.all([
      apiFetch('/api/term/sessions').then(r => r.json()).catch(() => []),
      apiFetch('/api/agents').then(r => r.json()).catch(() => []),
      apiFetch('/api/projects').then(r => r.json()).catch(() => []),
      apiFetch('/api/system').then(r => r.json()).catch(() => null),
    ]);

    // Hero card
    const heroEl = document.getElementById('home-hero');
    if (heroEl) {
      const running = agents.filter(a => a.session);
      if (running.length > 0) {
        const names = running.map(a => a.name).join(', ');
        const s = running[0].session;
        const proj = s?.cwd ? s.cwd.split('/').pop() : '';
        heroEl.innerHTML = `
          <div class="news-hero-card">
            <div class="hero-card-body">
              <div class="hero-card-eyebrow">● LIVE</div>
              <div class="hero-card-headline">${running.length} Agent${running.length > 1 ? 's' : ''} Running</div>
              <div class="hero-card-dek">${esc(names)}${proj ? ' · ' + esc(proj) : ''}</div>
              <button class="hero-card-cta" id="hero-cta">Open Terminal</button>
              <div class="hero-card-meta">KAY2 · TAILSCALE CONNECTED</div>
            </div>
          </div>`;
        document.getElementById('hero-cta')?.addEventListener('click', () => openTerminalForSession(running[0].session.id));
      } else {
        heroEl.innerHTML = `
          <div class="news-hero-card">
            <div class="hero-card-body">
              <div class="hero-card-eyebrow">KAY2 TUNNEL</div>
              <div class="hero-card-headline">Start an Agent</div>
              <div class="hero-card-dek">Launch Claude Code, Codex, or Gemini to begin a session on this Pi.</div>
              <button class="hero-card-cta" id="hero-cta">Go to Agents</button>
              <div class="hero-card-meta">KAY2 · TAILSCALE CONNECTED</div>
            </div>
          </div>`;
        document.getElementById('hero-cta')?.addEventListener('click', () => showTab('agents'));
      }
    }

    // Agents list
    const agentListEl = document.getElementById('home-agents-list');
    if (agentListEl) {
      const shown = agents.slice(0, 5);
      if (!shown.length) {
        agentListEl.innerHTML = '<div style="padding:20px 16px;color:var(--text-dim);font-size:14px">No agents found</div>';
      } else {
        agentListEl.innerHTML = shown.map(a => {
          const ic = AGENT_ICONS[a.id] || { letter: '?', bg: '#888' };
          const isRunning = !!a.session;
          const statusMeta = isRunning ? '● Running' : (a.installed ? 'Ready' : 'Not installed');
          const actionLabel = isRunning ? 'Attach' : (a.installed ? 'Launch' : '—');
          const actionClass = a.installed ? 'story-row-action' : 'story-row-action secondary';
          return `
            <div class="story-row" data-agent-id="${esc(a.id)}" data-session-id="${isRunning ? esc(a.session.id) : ''}">
              <div class="story-row-icon" style="background:${ic.bg}">${ic.letter}</div>
              <div class="story-row-info">
                <div class="story-row-name">${esc(a.name)}</div>
                <div class="story-row-meta">${esc(a.provider)} · ${statusMeta}</div>
              </div>
              ${a.installed || isRunning ? `<button class="${actionClass}" data-agent-id="${esc(a.id)}" data-session-id="${isRunning ? esc(a.session.id) : ''}">${actionLabel}</button>` : ''}
            </div>`;
        }).join('');
        agentListEl.querySelectorAll('.story-row-action').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const sid = btn.dataset.sessionId;
            if (sid) { openTerminalForSession(sid); }
            else { showTab('agents'); }
          });
        });
        agentListEl.querySelectorAll('.story-row').forEach(row => {
          row.addEventListener('click', () => showTab('agents'));
        });
      }
    }

    // Projects list
    const projListEl = document.getElementById('home-projects-list');
    if (projListEl) {
      const gitProjects = projects.filter(p => p.git).slice(0, 5);
      if (!gitProjects.length) {
        projListEl.innerHTML = '<div style="padding:20px 16px;color:var(--text-dim);font-size:14px">No projects found</div>';
      } else {
        projListEl.innerHTML = gitProjects.map(p => {
          const branch = p.git?.branch || 'main';
          const dirty = p.git?.dirty ? ' · modified' : '';
          const fullPath = p.path || ('/home/kay2/' + (p.relativePath || p.name));
          return `
            <div class="story-row">
              <div class="story-row-icon" style="background:var(--blue);font-size:16px">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
              </div>
              <div class="story-row-info">
                <div class="story-row-name">${esc(p.name)}</div>
                <div class="story-row-meta">⎇ ${esc(branch)}${dirty}</div>
              </div>
              <button class="story-row-action secondary" data-path="${esc(fullPath)}">cd</button>
            </div>`;
        }).join('');
        projListEl.querySelectorAll('[data-path]').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const p = btn.dataset.path;
            showTab('term');
            setTimeout(() => Term.paste('cd ' + JSON.stringify(p) + '\n'), 100);
          });
        });
      }
    }

    // Sys bar footer
    const sysEl = document.getElementById('home-sys-bar');
    if (sysEl && sys) {
      const parts = [];
      if (sys.cpu != null) parts.push(`CPU ${sys.cpu}%`);
      if (sys.mem) parts.push(`MEM ${sys.mem.pct}%`);
      if (sys.temp != null) parts.push(`TEMP ${sys.temp}°`);
      if (sys.load) parts.push(`LOAD ${sys.load[0].toFixed(2)}`);
      sysEl.style.cssText = 'font-size:11px;font-family:var(--font-mono);color:var(--text-dim);padding:12px 0;border-top:1px solid var(--border)';
      sysEl.textContent = parts.join(' · ');
    }
  }

  async function loadMoreStats() {
    try {
      const [sys, diskRes] = await Promise.all([
        apiFetch('/api/system').then(r => r.json()).catch(() => null),
        apiFetch('/api/pi/disk').then(r => r.json()).catch(() => null),
      ]);
      if (sys) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('more-cpu',  sys.cpu != null ? sys.cpu + '%' : '—');
        set('more-mem',  sys.mem ? sys.mem.pct + '%' : '—');
        set('more-temp', sys.temp != null ? sys.temp + '°' : '—');
        set('more-load', sys.load ? sys.load[0].toFixed(2) : '—');
        // Uptime
        if (sys.uptime) {
          const h = Math.floor(sys.uptime / 3600);
          const m = Math.floor((sys.uptime % 3600) / 60);
          set('more-uptime', h > 0 ? `${h}h ${m}m` : `${m}m`);
        }
      }
      if (diskRes && diskRes.used && diskRes.total) {
        const pct = Math.round((diskRes.used / diskRes.total) * 100);
        const el = document.getElementById('more-disk');
        if (el) el.textContent = pct + '%';
      }
    } catch {}
  }

  function loadSettings() {
    const hostEl = document.getElementById('settings-host');
    if (hostEl) hostEl.textContent = location.hostname;
    const tokenEl = document.getElementById('settings-token-preview');
    if (tokenEl && _token) tokenEl.textContent = _token.slice(0, 8) + '…';
  }

  function init() {
    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.addEventListener('click', () => showTab(btn.dataset.tab))
    );

    // Pause polling when the PWA is backgrounded (phone lock / app switch);
    // resume the active tab's polling when it comes back. Saves battery + the
    // Pi's CPU and avoids orphaned intervals running forever.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        Agents?.deactivate?.(); Pi?.deactivate?.(); Browser?.deactivate?.();
      } else {
        if (_activeTab === 'agents')  Agents?.activate?.();
        else if (_activeTab === 'pi') Pi?.activate?.();
        else if (_activeTab === 'browser') Browser?.activate?.();
      }
    });

    document.getElementById('auth-eye-btn')?.addEventListener('click', () => {
      const input = document.getElementById('token-input');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('settings-logout-row')?.addEventListener('click', logout);

    document.getElementById('screen-topbar-connect-btn')?.addEventListener('click', () => Screen?.connect());
    document.getElementById('screen-topbar-disconnect-btn')?.addEventListener('click', () => Screen?.disconnect());
    document.getElementById('screen-fullscreen-btn')?.addEventListener('click', () => {
      const el = document.getElementById('tab-screen');
      if (el?.requestFullscreen) el.requestFullscreen();
    });

    document.getElementById('phone-topbar-connect-btn')?.addEventListener('click', () => Phone?.connect());
    document.getElementById('phone-topbar-disconnect-btn')?.addEventListener('click', () => Phone?.disconnect());

    // More tab navigation
    document.getElementById('more-pi-btn')?.addEventListener('click', () => showTab('pi'));
    document.getElementById('more-browser-btn')?.addEventListener('click', () => showTab('browser'));
    document.getElementById('more-screen-btn')?.addEventListener('click', () => showTab('screen'));
    document.getElementById('more-phone-btn')?.addEventListener('click', () => showTab('phone'));
    document.getElementById('more-ops-btn')?.addEventListener('click', () => showTab('ops'));
    document.getElementById('more-claude-btn')?.addEventListener('click', openClaude);
    document.getElementById('more-clipboard-btn')?.addEventListener('click', openClipboard);
    document.getElementById('more-qr-btn')?.addEventListener('click', openDeviceQR);
    document.getElementById('more-notif-row')?.addEventListener('click', toggleNotifications);
    document.getElementById('more-split-row')?.addEventListener('click', toggleSplit);
    refreshSplitUI();
    // Re-evaluate split layout when the viewport crosses the breakpoint.
    try { window.matchMedia('(min-width: 920px)').addEventListener('change', () => showTab(_activeTab)); } catch {}
    document.getElementById('pi-back-btn')?.addEventListener('click', () => showTab('more'));
    document.getElementById('browser-back-btn')?.addEventListener('click', () => showTab('more'));

    // Pi Control shortcuts grid
    document.querySelectorAll('.more-shortcut-btn[data-pi]').forEach(btn => {
      btn.addEventListener('click', () => {
        showTab('pi');
        // Switch to the right segment after a tick so Pi tab is visible
        setTimeout(() => Pi?._switchSection?.(btn.dataset.pi), 50);
      });
    });

    // Connection info copy
    document.getElementById('more-url-row')?.addEventListener('click', () => {
      const url = 'https://stan.spikeradar.co.uk';
      navigator.clipboard?.writeText(url).then(() => {
        const el = document.getElementById('more-tunnel-url');
        if (el) { const orig = el.textContent; el.textContent = 'Copied!'; setTimeout(() => el.textContent = orig, 1500); }
      }).catch(() => {});
    });
    const localAddr = location.hostname === 'localhost' ? location.host : location.host;
    const addrEl = document.getElementById('more-local-addr');
    if (addrEl) addrEl.textContent = localAddr;

    // Theme toggle
    const savedTheme = localStorage.getItem('stan_theme') || 'auto';
    _applyTheme(savedTheme);
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === savedTheme);
      btn.addEventListener('click', () => {
        const t = btn.dataset.theme;
        localStorage.setItem('stan_theme', t);
        _applyTheme(t);
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
      });
    });

    tryHashToken().then(used => {
      if (used) return;
      const saved = localStorage.getItem('stan_token');
      if (saved) { _token = saved; launch(); }
    });

    document.getElementById('token-submit').addEventListener('click', tryAuth);
    document.getElementById('token-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') tryAuth();
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'activated' && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });

        // "Check for Updates" button
        document.getElementById('settings-update-row')?.addEventListener('click', async () => {
          const val = document.getElementById('settings-update-val');
          if (val) val.textContent = 'Checking…';
          try {
            await reg.update();
            // If no updatefound fires within 2s, we're already up to date
            setTimeout(() => {
              if (val && val.textContent === 'Checking…') val.textContent = 'Up to date ✓';
            }, 2000);
          } catch {
            if (val) val.textContent = 'Error';
          }
        });
      }).catch(() => {});
    }
  }

  function _applyTheme(t) {
    if (t === 'dark')  document.documentElement.dataset.theme = 'dark';
    else if (t === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }

  async function tryAuth() {
    const input = document.getElementById('token-input');
    const err = document.getElementById('auth-error');
    const t = input.value.trim();
    if (!t) return;
    err.classList.add('hidden');
    try {
      const r = await fetch('/api/term/sessions', { headers: { 'Authorization': 'Bearer ' + t } });
      if (r.status === 401) { err.classList.remove('hidden'); return; }
      _token = t;
      localStorage.setItem('stan_token', t);
      launch();
    } catch {
      err.textContent = 'Cannot reach server';
      err.classList.remove('hidden');
    }
  }

  function launch() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadHomeStats();
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  document.addEventListener('DOMContentLoaded', init);

  return { token, apiFetch, showTab, logout, openTerminalForSession,
    AGENT_ICONS, toast, confirm: confirmDialog, prompt: promptDialog };
})();
