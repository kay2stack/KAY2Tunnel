// Stan CLI — Pi Remote Control tab

const Pi = (() => {
  let _initialized = false;
  let _pollInterval = null;

  function init() {}

  function activate() {
    if (!_initialized) { _initialized = true; load(); }
    _startPolling();
    document.getElementById('pi-refresh-btn')?.addEventListener('click', load, { once: true });
  }

  function deactivate() { _stopPolling(); }

  function _startPolling() {
    _stopPolling();
    _pollInterval = setInterval(_poll, 5000);
  }

  function _stopPolling() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  async function _poll() {
    try {
      const r = await App.apiFetch('/api/system');
      const s = await r.json();
      _updateStats(s);
    } catch {}
    try {
      const r = await App.apiFetch('/api/pi/processes');
      const procs = await r.json();
      _updateProcBadges(procs);
    } catch {}
  }

  function _updateStats(s) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('pi-cpu',   s.cpu + '%');
    set('pi-mem',   s.mem ? s.mem.pct + '%' : '—');
    set('pi-temp',  s.temp != null ? s.temp + '°C' : '—');
    set('pi-load',  s.load ? s.load[0].toFixed(2) : '—');
    set('pi-uptime', s.uptime ? fmtUptime(s.uptime) : '—');
  }

  function _updateProcBadges(procs) {
    procs.forEach(p => {
      const badge = document.querySelector(`[data-proc-status="${p.name}"]`);
      if (badge) {
        badge.textContent = p.status;
        badge.className = 'proc-status-badge ' + (p.status === 'online' ? 'online' : 'offline');
      }
    });
  }

  async function load() {
    const content = document.getElementById('pi-content');
    if (!content) return;
    content.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px 0;font-size:14px">Loading…</div>';
    document.getElementById('pi-refresh-btn')?.addEventListener('click', load, { once: true });

    try {
      const [sysRes, procRes, diskRes] = await Promise.all([
        App.apiFetch('/api/system').then(r => r.json()),
        App.apiFetch('/api/pi/processes').then(r => r.json()),
        App.apiFetch('/api/pi/disk').then(r => r.json()).catch(() => null),
      ]);
      render(sysRes, procRes, diskRes, content);
    } catch (e) {
      content.innerHTML = `<div style="color:var(--red);padding:16px">${esc(e.message)}</div>`;
    }
  }

  function render(sys, procs, disk, container) {
    container.innerHTML = '';

    // ── System stats card ──────────────────────────
    const statsCard = el('div', 'pi-stats-card card');
    statsCard.innerHTML = `
      <div class="pi-stats-grid">
        <div class="pi-stat">
          <div class="pi-stat-label">CPU</div>
          <div class="pi-stat-val" id="pi-cpu">${sys.cpu}%</div>
        </div>
        <div class="pi-stat">
          <div class="pi-stat-label">Memory</div>
          <div class="pi-stat-val" id="pi-mem">${sys.mem ? sys.mem.pct + '%' : '—'}</div>
          <div class="pi-stat-sub">${sys.mem ? fmtBytes(sys.mem.used) + ' / ' + fmtBytes(sys.mem.total) : ''}</div>
        </div>
        <div class="pi-stat">
          <div class="pi-stat-label">Temp</div>
          <div class="pi-stat-val ${sys.temp > 70 ? 'warn' : ''}" id="pi-temp">${sys.temp != null ? sys.temp + '°C' : '—'}</div>
        </div>
        <div class="pi-stat">
          <div class="pi-stat-label">Load</div>
          <div class="pi-stat-val" id="pi-load">${sys.load ? sys.load[0].toFixed(2) : '—'}</div>
        </div>
        <div class="pi-stat">
          <div class="pi-stat-label">Uptime</div>
          <div class="pi-stat-val" id="pi-uptime">${sys.uptime ? fmtUptime(sys.uptime) : '—'}</div>
        </div>
        ${disk ? `
        <div class="pi-stat">
          <div class="pi-stat-label">Disk</div>
          <div class="pi-stat-val">${esc(disk.pct)}</div>
          <div class="pi-stat-sub">${esc(disk.used)} / ${esc(disk.total)}</div>
        </div>` : ''}
      </div>
    `;
    container.appendChild(statsCard);

    // ── PM2 Processes ─────────────────────────────
    const procLabel = el('div', 'section-label');
    procLabel.textContent = 'Processes';
    container.appendChild(procLabel);

    if (!procs.length) {
      const empty = el('div');
      empty.style.cssText = 'color:var(--text-dim);font-size:14px;text-align:center;padding:20px';
      empty.textContent = 'No PM2 processes';
      container.appendChild(empty);
    } else {
      procs.forEach(p => container.appendChild(makeProcCard(p)));
    }

    // ── Quick Actions ──────────────────────────────
    const actLabel = el('div', 'section-label');
    actLabel.textContent = 'Quick Actions';
    container.appendChild(actLabel);

    const actions = [
      { label: 'Restart stan-cli',    action: 'restart', name: 'stan-cli',        icon: '↺' },
      { label: 'Restart Tunnel',      action: 'restart', name: 'stan-cli-tunnel', icon: '↺' },
      { label: 'Git Pull (KAY2Tunnel)', cmd: 'cd ~/KAY2Tunnel && git pull', icon: '↓' },
      { label: 'PM2 Status',          cmd: 'pm2 status', icon: '⊞' },
      { label: 'Open Terminal',       tab: 'term', icon: '>' },
    ];

    const grid = el('div', 'pi-action-grid');
    actions.forEach(a => {
      const btn = el('button', 'pi-action-btn');
      btn.innerHTML = `<span class="pi-action-icon">${esc(a.icon)}</span><span>${esc(a.label)}</span>`;
      btn.addEventListener('click', () => {
        if (a.tab) { App.showTab(a.tab); return; }
        if (a.cmd) {
          App.showTab('term');
          Term.paste(a.cmd + '\n');
          return;
        }
        if (a.action && a.name) {
          doPm2(a.action, a.name, btn);
        }
      });
      grid.appendChild(btn);
    });
    container.appendChild(grid);
  }

  function makeProcCard(p) {
    const card = el('div', 'proc-card card');
    const isOnline = p.status === 'online';
    card.innerHTML = `
      <div class="proc-card-body">
        <div class="proc-info">
          <div class="proc-name">${esc(p.name)}</div>
          <div class="proc-meta">
            ${p.uptimeMs ? fmtUptime(p.uptimeMs / 1000) : ''}
            ${p.restarts > 0 ? ` · ${p.restarts} restart${p.restarts !== 1 ? 's' : ''}` : ''}
          </div>
        </div>
        <span class="proc-status-badge ${isOnline ? 'online' : 'offline'}" data-proc-status="${esc(p.name)}">${esc(p.status)}</span>
      </div>
      <div class="proc-actions">
        <button class="agent-btn ${isOnline ? '' : 'primary'} proc-start-btn" data-proc="${esc(p.name)}" data-action="${isOnline ? 'stop' : 'start'}">${isOnline ? 'Stop' : 'Start'}</button>
        <button class="agent-btn proc-restart-btn" data-proc="${esc(p.name)}" data-action="restart">Restart</button>
        ${p.name === 'stan-cli-tunnel' ? `<button class="agent-btn proc-logs-btn" data-proc="${esc(p.name)}">Logs</button>` : ''}
      </div>
    `;

    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => doPm2(btn.dataset.action, btn.dataset.proc, btn));
    });

    card.querySelectorAll('.proc-logs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        App.showTab('term');
        Term.paste(`pm2 logs ${JSON.stringify(btn.dataset.proc)} --lines 40\n`);
      });
    });

    return card;
  }

  async function doPm2(action, name, btn) {
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    try {
      await App.apiFetch('/api/pi/pm2', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      });
      btn.textContent = '✓';
      setTimeout(() => { load(); }, 1500);
    } catch (e) {
      btn.disabled = false; btn.textContent = orig;
      alert(`${action} ${name} failed: ${e.message}`);
    }
  }

  // ── Helpers ───────────────────────────────────────

  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function fmtUptime(s) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function fmtBytes(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1024).toFixed(0) + ' KB';
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, activate, deactivate };
})();
