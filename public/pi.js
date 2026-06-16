// Stan CLI — Pi Control Center
const Pi = (() => {
  let _initialized = false;
  let _section = 'overview';
  let _pollInterval = null;
  let _logSource = 'system';

  const SECTIONS = [
    { id: 'overview',  label: 'Overview' },
    { id: 'processes', label: 'Processes' },
    { id: 'docker',    label: 'Docker' },
    { id: 'network',   label: 'Network' },
    { id: 'services',  label: 'Services' },
    { id: 'storage',   label: 'Storage' },
    { id: 'hardware',  label: 'Hardware' },
    { id: 'cron',      label: 'Cron' },
    { id: 'logs',      label: 'Logs' },
    { id: 'power',     label: 'Power' },
  ];

  // ── Lifecycle ──────────────────────────────────────────────────────────
  function init() {}

  function activate() {
    if (!_initialized) { _initialized = true; _buildShell(); _loadSection(_section); }
    _startPolling();
  }

  function deactivate() { _stopPolling(); }

  // ── Shell (segment nav + container) ───────────────────────────────────
  function _buildShell() {
    const nav = document.getElementById('pi-seg-nav');
    const content = document.getElementById('pi-content');
    if (!nav || !content) return;

    nav.innerHTML = '';
    const strip = el('div', 'pi-seg-strip');
    SECTIONS.forEach(s => {
      const btn = el('button', 'pi-seg-btn' + (s.id === _section ? ' active' : ''));
      btn.textContent = s.label;
      btn.dataset.section = s.id;
      btn.addEventListener('click', () => _switchSection(s.id));
      strip.appendChild(btn);
    });
    nav.appendChild(strip);
    content.innerHTML = '<div class="pi-loading">Loading…</div>';

    // Idempotent refresh binding (was {once:true} → died after the first click).
    const refresh = document.getElementById('pi-refresh-btn');
    if (refresh) refresh.onclick = () => _loadSection(_section);
  }

  function _switchSection(id) {
    _section = id;
    document.querySelectorAll('.pi-seg-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.section === id)
    );
    _loadSection(id);
  }

  // ── Polling (overview only) ────────────────────────────────────────────
  function _startPolling() {
    _stopPolling();
    _pollInterval = setInterval(() => {
      if (_section === 'overview') _pollStats();
    }, 5000);
  }

  function _stopPolling() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  async function _pollStats() {
    try {
      const s = await App.apiFetch('/api/system').then(r => r.json());
      _updateStatEls(s);
    } catch {}
  }

  function _updateStatEls(s) {
    _setEl('pi-ov-cpu',    s.cpu != null ? s.cpu + '%' : '—');
    _setEl('pi-ov-mem',    s.mem ? s.mem.pct + '%' : '—');
    _setEl('pi-ov-temp',   s.temp != null ? s.temp + '°C' : '—');
    _setEl('pi-ov-load',   s.load ? s.load[0].toFixed(2) : '—');
    _setEl('pi-ov-uptime', s.uptime ? fmtUptime(s.uptime) : '—');
    const tempEl = document.getElementById('pi-ov-temp');
    if (tempEl && s.temp != null) {
      tempEl.className = 'pi-stat-val ' + (s.temp > 75 ? 'val-danger' : s.temp > 60 ? 'val-warn' : '');
    }
  }

  // ── Section dispatcher ─────────────────────────────────────────────────
  async function _loadSection(id) {
    const content = document.getElementById('pi-content');
    if (!content) return;

    // Re-attach refresh button listener
    const btn = document.getElementById('pi-refresh-btn');
    if (btn) { btn.onclick = () => _loadSection(_section); }

    content.innerHTML = '<div class="pi-loading">Loading…</div>';
    content.classList.remove('log-mode');

    try {
      switch (id) {
        case 'overview':   await _renderOverview(content); break;
        case 'processes':  await _renderProcesses(content); break;
        case 'docker':     await _renderDocker(content); break;
        case 'network':    await _renderNetwork(content); break;
        case 'services':   await _renderServices(content); break;
        case 'storage':    await _renderStorage(content); break;
        case 'hardware':   await _renderHardware(content); break;
        case 'cron':       await _renderCron(content); break;
        case 'logs':       await _renderLogs(content); break;
        case 'power':      _renderPower(content); break;
      }
    } catch (e) {
      content.innerHTML = `<div class="pi-err">${esc(e.message)}</div>`;
    }
  }

  // ── Overview ───────────────────────────────────────────────────────────
  async function _renderOverview(container) {
    const [sys, disk, info] = await Promise.all([
      App.apiFetch('/api/system').then(r => r.json()),
      App.apiFetch('/api/pi/disk').then(r => r.json()).catch(() => null),
      App.apiFetch('/api/pi/sysinfo').then(r => r.json()).catch(() => ({})),
    ]);
    container.innerHTML = '';

    // Sysinfo banner
    if (info.hostname || info.model) {
      const banner = el('div', 'pi-banner');
      banner.innerHTML = `
        <div class="pi-banner-main">${esc(info.hostname || 'raspberry pi')}</div>
        <div class="pi-banner-sub">${esc(info.model || info.osName || '')}</div>
        ${info.kernel ? `<div class="pi-banner-kernel">${esc(info.kernel)}</div>` : ''}
      `;
      container.appendChild(banner);
    }

    // Stats grid
    const diskPct = disk ? parseInt(disk.pct) : null;
    const statsHtml = `
      <div class="pi-grid">
        <div class="pi-stat-tile">
          <div class="pi-tile-label">CPU</div>
          <div class="pi-tile-val ${sys.cpu > 80 ? 'val-danger' : sys.cpu > 60 ? 'val-warn' : ''}" id="pi-ov-cpu">${sys.cpu}%</div>
          <div class="pi-tile-bar"><div class="pi-tile-bar-fill" style="width:${sys.cpu}%"></div></div>
        </div>
        <div class="pi-stat-tile">
          <div class="pi-tile-label">Memory</div>
          <div class="pi-tile-val ${sys.mem?.pct > 85 ? 'val-danger' : sys.mem?.pct > 70 ? 'val-warn' : ''}" id="pi-ov-mem">${sys.mem ? sys.mem.pct + '%' : '—'}</div>
          ${sys.mem ? `<div class="pi-tile-sub">${fmtBytes(sys.mem.used)} / ${fmtBytes(sys.mem.total)}</div>` : ''}
          <div class="pi-tile-bar"><div class="pi-tile-bar-fill" style="width:${sys.mem?.pct ?? 0}%"></div></div>
        </div>
        <div class="pi-stat-tile">
          <div class="pi-tile-label">Temperature</div>
          <div class="pi-tile-val ${sys.temp > 75 ? 'val-danger' : sys.temp > 60 ? 'val-warn' : ''}" id="pi-ov-temp">${sys.temp != null ? sys.temp + '°C' : '—'}</div>
          <div class="pi-tile-bar"><div class="pi-tile-bar-fill ${sys.temp > 75 ? 'bar-danger' : sys.temp > 60 ? 'bar-warn' : ''}" style="width:${sys.temp != null ? Math.min(sys.temp / 100 * 100, 100) : 0}%"></div></div>
        </div>
        <div class="pi-stat-tile">
          <div class="pi-tile-label">Load avg</div>
          <div class="pi-tile-val" id="pi-ov-load">${sys.load ? sys.load[0].toFixed(2) : '—'}</div>
          ${sys.load ? `<div class="pi-tile-sub">${sys.load.map(v => v.toFixed(2)).join(' · ')}</div>` : ''}
        </div>
        <div class="pi-stat-tile">
          <div class="pi-tile-label">Uptime</div>
          <div class="pi-tile-val" id="pi-ov-uptime">${sys.uptime ? fmtUptime(sys.uptime) : '—'}</div>
        </div>
        ${disk ? `
        <div class="pi-stat-tile">
          <div class="pi-tile-label">Disk</div>
          <div class="pi-tile-val ${diskPct > 90 ? 'val-danger' : diskPct > 75 ? 'val-warn' : ''}">${esc(disk.pct)}</div>
          <div class="pi-tile-sub">${esc(disk.used)} / ${esc(disk.total)}</div>
          <div class="pi-tile-bar"><div class="pi-tile-bar-fill ${diskPct > 90 ? 'bar-danger' : ''}" style="width:${diskPct ?? 0}%"></div></div>
        </div>` : ''}
      </div>
    `;
    const statsCard = el('div', 'pi-card');
    statsCard.innerHTML = statsHtml;
    container.appendChild(statsCard);

    // Quick links
    const links = el('div', 'pi-section-label');
    links.textContent = 'Quick Actions';
    container.appendChild(links);

    const grid = el('div', 'pi-action-grid');
    const quickActions = [
      { icon: svgIcon('refresh'), label: 'Restart stan-cli', fn: () => doPm2('restart', 'stan-cli') },
      { icon: svgIcon('terminal'), label: 'Open Terminal', fn: () => App.showTab('term') },
      { icon: svgIcon('wifi'), label: 'Network', fn: () => _switchSection('network') },
      { icon: svgIcon('log'), label: 'View Logs', fn: () => _switchSection('logs') },
      { icon: svgIcon('power'), label: 'Power', fn: () => _switchSection('power') },
      { icon: svgIcon('hdd'), label: 'Storage', fn: () => _switchSection('storage') },
    ];
    quickActions.forEach(a => {
      const btn = el('button', 'pi-quick-btn');
      btn.innerHTML = `${a.icon}<span>${esc(a.label)}</span>`;
      btn.addEventListener('click', a.fn);
      grid.appendChild(btn);
    });
    container.appendChild(grid);
  }

  // ── Processes ──────────────────────────────────────────────────────────
  async function _renderProcesses(container) {
    const [procs, top] = await Promise.all([
      App.apiFetch('/api/pi/processes').then(r => r.json()),
      App.apiFetch('/api/pi/top').then(r => r.json()).catch(() => []),
    ]);
    container.innerHTML = '';

    // PM2
    const pm2Label = el('div', 'pi-section-label');
    pm2Label.textContent = 'PM2 Processes';
    container.appendChild(pm2Label);

    if (!procs.length) {
      const e = el('div', 'pi-empty'); e.textContent = 'No PM2 processes found';
      container.appendChild(e);
    } else {
      procs.forEach(p => container.appendChild(makeProcCard(p)));
    }

    // System top
    if (top.length) {
      const topLabel = el('div', 'pi-section-label');
      topLabel.textContent = 'Top Processes (by CPU)';
      container.appendChild(topLabel);
      const card = el('div', 'pi-card pi-card-flush');
      top.slice(0, 15).forEach((p, i) => {
        const row = el('div', 'pi-top-row' + (i < top.length - 1 ? ' bordered' : ''));
        row.innerHTML = `
          <div class="pi-top-info">
            <div class="pi-top-name">${esc(p.name || p.cmd.split(' ')[0].split('/').pop())}</div>
            <div class="pi-top-meta">PID ${esc(p.pid)} · ${esc(p.user)}</div>
          </div>
          <div class="pi-top-stats">
            <span class="pi-top-cpu ${p.cpu > 50 ? 'val-danger' : p.cpu > 20 ? 'val-warn' : ''}">${p.cpu.toFixed(1)}%</span>
            <span class="pi-top-mem">${fmtBytes(p.rss)}</span>
          </div>
        `;
        card.appendChild(row);
      });
      container.appendChild(card);
    }
  }

  // ── Network ────────────────────────────────────────────────────────────
  async function _renderNetwork(container) {
    const net = await App.apiFetch('/api/pi/network').then(r => r.json());
    container.innerHTML = '';

    // WiFi card
    if (net.wifi !== null) {
      const wLabel = el('div', 'pi-section-label');
      wLabel.textContent = 'WiFi';
      container.appendChild(wLabel);

      const wCard = el('div', 'pi-card');
      if (!net.wifi || !net.wifi.connected) {
        wCard.innerHTML = `
          <div class="pi-row">
            <span class="pi-row-label">Status</span>
            <span class="pi-badge offline">Not connected</span>
          </div>`;
      } else {
        const signal = net.wifi.signal;
        const bars = signal == null ? '?' : signal > -50 ? '▂▄▆█' : signal > -65 ? '▂▄▆' : signal > -75 ? '▂▄' : '▂';
        const sigColor = signal == null ? '' : signal > -65 ? 'val-good' : signal > -75 ? 'val-warn' : 'val-danger';
        wCard.innerHTML = `
          <div class="pi-row bordered"><span class="pi-row-label">SSID</span><span class="pi-row-val">${esc(net.wifi.ssid || '—')}</span></div>
          <div class="pi-row bordered"><span class="pi-row-label">Signal</span><span class="pi-row-val ${sigColor}">${bars} ${signal != null ? signal + ' dBm' : '—'}</span></div>
          ${net.wifi.bitrate ? `<div class="pi-row bordered"><span class="pi-row-label">TX rate</span><span class="pi-row-val">${esc(net.wifi.bitrate)}</span></div>` : ''}
          ${net.wifi.freq ? `<div class="pi-row"><span class="pi-row-label">Frequency</span><span class="pi-row-val">${(parseInt(net.wifi.freq)/1000).toFixed(1)} GHz</span></div>` : ''}
        `;
      }
      container.appendChild(wCard);
    }

    // Interfaces
    const ifLabel = el('div', 'pi-section-label');
    ifLabel.textContent = 'Interfaces';
    container.appendChild(ifLabel);

    if (!net.ifaces.length) {
      const e = el('div', 'pi-empty'); e.textContent = 'No interfaces found';
      container.appendChild(e);
    } else {
      net.ifaces.forEach(iface => {
        const card = el('div', 'pi-card');
        const isUp = iface.state === 'UP';
        card.innerHTML = `
          <div class="pi-row bordered">
            <span class="pi-row-label pi-row-label-bold">${esc(iface.name)}</span>
            <span class="pi-badge ${isUp ? 'online' : 'offline'}">${esc(iface.state)}</span>
          </div>
          ${iface.mac ? `<div class="pi-row bordered"><span class="pi-row-label">MAC</span><span class="pi-row-val mono">${esc(iface.mac)}</span></div>` : ''}
          ${iface.addrs.filter(a => a.family === 'inet').map((a, i, arr) =>
            `<div class="pi-row ${i < arr.length - 1 ? 'bordered' : ''}"><span class="pi-row-label">IPv4</span><span class="pi-row-val mono">${esc(a.addr)}/${a.prefix}</span></div>`
          ).join('')}
          ${iface.addrs.filter(a => a.family === 'inet6').map((a, i, arr) =>
            `<div class="pi-row"><span class="pi-row-label">IPv6</span><span class="pi-row-val mono" style="font-size:11px">${esc(a.addr)}</span></div>`
          ).join('')}
        `;
        container.appendChild(card);
      });
    }
  }

  // ── Services ───────────────────────────────────────────────────────────
  async function _renderServices(container) {
    const services = await App.apiFetch('/api/pi/services').then(r => r.json());
    container.innerHTML = '';

    const label = el('div', 'pi-section-label');
    label.textContent = 'System Services';
    container.appendChild(label);

    const note = el('div', 'pi-note');
    note.textContent = 'Only known services are shown.';
    container.appendChild(note);

    // Split active/inactive
    const active   = services.filter(s => s.active);
    const inactive = services.filter(s => !s.active);

    if (active.length) {
      const aLabel = el('div', 'pi-sub-label'); aLabel.textContent = 'Running';
      container.appendChild(aLabel);
      const card = el('div', 'pi-card pi-card-flush');
      active.forEach((s, i) => card.appendChild(makeServiceRow(s, i < active.length - 1)));
      container.appendChild(card);
    }

    if (inactive.length) {
      const iLabel = el('div', 'pi-sub-label'); iLabel.textContent = 'Inactive';
      container.appendChild(iLabel);
      const card = el('div', 'pi-card pi-card-flush');
      inactive.forEach((s, i) => card.appendChild(makeServiceRow(s, i < inactive.length - 1)));
      container.appendChild(card);
    }

    if (!services.length) {
      const e = el('div', 'pi-empty'); e.textContent = 'No monitored services detected';
      container.appendChild(e);
    }
  }

  function makeServiceRow(s, bordered) {
    const row = el('div', 'pi-service-row' + (bordered ? ' bordered' : ''));
    row.innerHTML = `
      <div class="pi-service-info">
        <div class="pi-service-name">${esc(s.name)}</div>
        <span class="pi-badge ${s.active ? 'online' : 'offline'}">${esc(s.status)}</span>
      </div>
      <div class="pi-service-actions">
        <button class="pi-svc-btn" data-name="${esc(s.name)}" data-action="${s.active ? 'stop' : 'start'}">${s.active ? 'Stop' : 'Start'}</button>
        <button class="pi-svc-btn" data-name="${esc(s.name)}" data-action="restart">Restart</button>
      </div>
    `;
    row.querySelectorAll('.pi-svc-btn').forEach(btn => {
      btn.addEventListener('click', () => doService(btn.dataset.action, btn.dataset.name, btn));
    });
    return row;
  }

  async function doService(action, name, btn) {
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await App.apiFetch('/api/pi/service', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error); }
      btn.textContent = '✓';
      setTimeout(() => _loadSection('services'), 1500);
    } catch (e) {
      btn.disabled = false; btn.textContent = orig;
      showToast('Error: ' + e.message);
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────
  async function _renderStorage(container) {
    const data = await App.apiFetch('/api/pi/storage').then(r => r.json());
    container.innerHTML = '';

    const label = el('div', 'pi-section-label');
    label.textContent = 'Disk Usage';
    container.appendChild(label);

    if (!data.mounts?.length) {
      const e = el('div', 'pi-empty'); e.textContent = 'No mounts found';
      container.appendChild(e);
      return;
    }

    data.mounts.forEach(m => {
      const pct = parseInt(m.pct) || 0;
      const card = el('div', 'pi-card');
      card.innerHTML = `
        <div class="pi-row bordered">
          <span class="pi-row-label pi-row-label-bold">${esc(m.mount)}</span>
          <span class="pi-row-val ${pct > 90 ? 'val-danger' : pct > 75 ? 'val-warn' : ''}">${esc(m.pct)}</span>
        </div>
        <div class="pi-row bordered">
          <span class="pi-row-label">Used / Total</span>
          <span class="pi-row-val">${esc(m.used)} / ${esc(m.size)}</span>
        </div>
        <div class="pi-row">
          <span class="pi-row-label">Available</span>
          <span class="pi-row-val">${esc(m.avail)}</span>
        </div>
        <div style="padding:0 16px 14px">
          <div class="pi-disk-bar">
            <div class="pi-disk-bar-fill ${pct > 90 ? 'bar-danger' : pct > 75 ? 'bar-warn' : ''}" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="pi-row" style="padding-top:0">
          <span class="pi-row-label" style="font-size:11px;color:var(--text-dim)">${esc(m.fs)}</span>
        </div>
      `;
      container.appendChild(card);
    });
  }

  // ── Docker ────────────────────────────────────────────────────────────
  async function _renderDocker(container) {
    const containers = await App.apiFetch('/api/pi/docker').then(r => r.json());
    container.innerHTML = '';

    const label = el('div', 'pi-section-label');
    label.textContent = 'Docker Containers';
    container.appendChild(label);

    if (!containers.length) {
      const e = el('div', 'pi-empty'); e.textContent = 'No containers found';
      container.appendChild(e); return;
    }

    const running = containers.filter(c => c.state === 'running');
    const stopped = containers.filter(c => c.state !== 'running');

    [running, stopped].forEach((group, gi) => {
      if (!group.length) return;
      const lbl = el('div', 'pi-sub-label');
      lbl.textContent = gi === 0 ? 'Running' : 'Stopped';
      container.appendChild(lbl);
      const card = el('div', 'pi-card pi-card-flush');
      group.forEach((c, i) => {
        const row = el('div', 'pi-docker-row' + (i < group.length - 1 ? ' bordered' : ''));
        const isUp = c.state === 'running';
        row.innerHTML = `
          <div class="pi-docker-info">
            <div class="pi-docker-name">${esc(c.name)}</div>
            <div class="pi-docker-image">${esc(c.image)}</div>
            <div class="pi-docker-status">${esc(c.status)}</div>
            ${c.ports ? `<div class="pi-docker-ports">${esc(c.ports)}</div>` : ''}
          </div>
          <div class="pi-docker-actions">
            <button class="pi-svc-btn${isUp ? '' : ' primary'}" data-id="${esc(c.id)}" data-action="${isUp ? 'stop' : 'start'}">${isUp ? 'Stop' : 'Start'}</button>
            <button class="pi-svc-btn" data-id="${esc(c.id)}" data-action="restart">Restart</button>
            <button class="pi-svc-btn logs" data-id="${esc(c.id)}" data-name="${esc(c.name)}">Logs</button>
          </div>
        `;
        row.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', () => doDockerAction(btn.dataset.action, btn.dataset.id, btn));
        });
        row.querySelectorAll('.logs').forEach(btn => {
          btn.addEventListener('click', () => _showDockerLogs(btn.dataset.id, btn.dataset.name, container));
        });
        card.appendChild(row);
      });
      container.appendChild(card);
    });
  }

  async function doDockerAction(action, id, btn) {
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await App.apiFetch('/api/pi/docker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error); }
      btn.textContent = '✓';
      setTimeout(() => _loadSection('docker'), 1500);
    } catch (e) {
      btn.disabled = false; btn.textContent = orig;
      showToast('Error: ' + e.message);
    }
  }

  async function _showDockerLogs(id, name, container) {
    container.innerHTML = '';
    container.classList.add('log-mode');

    const header = el('div', 'pi-log-bar');
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <button class="pi-svc-btn" id="docker-logs-back">← Back</button>
        <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(name)}</span>
      </div>
      <select class="pi-log-select" id="docker-log-lines">
        <option value="50">50</option><option value="100" selected>100</option><option value="200">200</option>
      </select>
    `;
    container.appendChild(header);
    const out = el('div', 'pi-log-output'); out.id = 'docker-log-out'; out.textContent = 'Loading…';
    container.appendChild(out);

    document.getElementById('docker-logs-back')?.addEventListener('click', () => {
      container.classList.remove('log-mode');
      _loadSection('docker');
    });

    const fetchLogs = async () => {
      const lines = document.getElementById('docker-log-lines')?.value || '100';
      out.textContent = 'Loading…';
      try {
        const d = await App.apiFetch(`/api/pi/docker/logs?id=${encodeURIComponent(id)}&lines=${lines}`).then(r => r.json());
        out.innerHTML = (d.lines || []).map(l => {
          const cls = /error|fail|fatal/i.test(l) ? 'log-err' : /warn/i.test(l) ? 'log-warn' : 'log-info';
          return `<div class="log-line ${cls}">${esc(l)}</div>`;
        }).join('');
        out.scrollTop = out.scrollHeight;
      } catch (e) { out.textContent = 'Error: ' + e.message; }
    };

    document.getElementById('docker-log-lines')?.addEventListener('change', fetchLogs);
    await fetchLogs();
  }

  // ── Hardware ──────────────────────────────────────────────────────────
  async function _renderHardware(container) {
    const hw = await App.apiFetch('/api/pi/hardware').then(r => r.json());
    container.innerHTML = '';

    // CPU section
    const cpuLabel = el('div', 'pi-section-label');
    cpuLabel.textContent = 'CPU';
    container.appendChild(cpuLabel);

    const cpuCard = el('div', 'pi-card');
    const freqPct = hw.cpuMaxMHz ? Math.round(hw.cpuFreqMHz / hw.cpuMaxMHz * 100) : 0;
    cpuCard.innerHTML = `
      ${hw.cpuModel ? `<div class="pi-row bordered"><span class="pi-row-label">Model</span><span class="pi-row-val" style="font-size:12px">${esc(hw.cpuModel)}</span></div>` : ''}
      ${hw.cores ? `<div class="pi-row bordered"><span class="pi-row-label">Cores</span><span class="pi-row-val">${hw.cores}</span></div>` : ''}
      ${hw.cpuFreqMHz ? `
      <div class="pi-row bordered">
        <span class="pi-row-label">Frequency</span>
        <span class="pi-row-val">${hw.cpuFreqMHz >= 1000 ? (hw.cpuFreqMHz/1000).toFixed(2) + ' GHz' : hw.cpuFreqMHz + ' MHz'} <span style="color:var(--text-dim);font-size:11px">/ ${hw.cpuMaxMHz >= 1000 ? (hw.cpuMaxMHz/1000).toFixed(1)+'GHz' : hw.cpuMaxMHz+'MHz'}</span></span>
      </div>
      <div style="padding:0 16px 12px">
        <div class="pi-tile-bar" style="height:4px"><div class="pi-tile-bar-fill" style="width:${freqPct}%"></div></div>
      </div>` : ''}
      ${hw.governor ? `<div class="pi-row bordered"><span class="pi-row-label">Governor</span>
        <div class="pi-governor-wrap" id="pi-gov-wrap">
          <span class="pi-badge online" id="pi-gov-label">${esc(hw.governor)}</span>
          <button class="pi-svc-btn" id="pi-gov-change-btn" style="font-size:11px;padding:4px 10px">Change</button>
        </div>
      </div>` : ''}
      ${hw.vcTemp != null ? `<div class="pi-row bordered"><span class="pi-row-label">Temperature</span><span class="pi-row-val ${hw.vcTemp > 75 ? 'val-danger' : hw.vcTemp > 60 ? 'val-warn' : ''}">${hw.vcTemp}°C</span></div>` : ''}
      ${hw.vcVolts ? `<div class="pi-row bordered"><span class="pi-row-label">Core Voltage</span><span class="pi-row-val mono">${hw.vcVolts}V</span></div>` : ''}
      ${hw.vcGpuMem ? `<div class="pi-row ${hw.throttle ? 'bordered' : ''}"><span class="pi-row-label">GPU Memory</span><span class="pi-row-val">${esc(hw.vcGpuMem)}</span></div>` : ''}
      ${hw.throttle ? `<div class="pi-row">
        <span class="pi-row-label">Throttle</span>
        <span class="pi-row-val ${hw.throttle.ok ? 'val-good' : 'val-danger'}">${hw.throttle.ok ? '✓ Normal' : hw.throttle.flags.join(', ')}</span>
      </div>` : ''}
    `;
    container.appendChild(cpuCard);

    // Governor change UI
    if (hw.governor && hw.availGovs?.length) {
      const changeBtn = document.getElementById('pi-gov-change-btn');
      changeBtn?.addEventListener('click', () => {
        const wrap = document.getElementById('pi-gov-wrap');
        if (!wrap) return;
        if (wrap.querySelector('select')) return;
        const sel = document.createElement('select');
        sel.className = 'pi-log-select';
        hw.availGovs.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g; opt.textContent = g;
          if (g === hw.governor) opt.selected = true;
          sel.appendChild(opt);
        });
        const applyBtn = el('button', 'pi-svc-btn primary');
        applyBtn.textContent = 'Apply'; applyBtn.style.fontSize = '11px';
        wrap.innerHTML = '';
        wrap.appendChild(sel); wrap.appendChild(applyBtn);
        applyBtn.addEventListener('click', async () => {
          applyBtn.disabled = true; applyBtn.textContent = '…';
          try {
            const r = await App.apiFetch('/api/pi/hardware/governor', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ governor: sel.value }),
            });
            if (!r.ok) throw new Error((await r.json()).error);
            showToast('Governor set to ' + sel.value);
            setTimeout(() => _loadSection('hardware'), 500);
          } catch (e) { showToast('Error: ' + e.message); applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }
        });
      });
    }

    // USB devices
    if (hw.usb?.length) {
      const usbLabel = el('div', 'pi-section-label');
      usbLabel.textContent = 'USB Devices';
      container.appendChild(usbLabel);
      const usbCard = el('div', 'pi-card pi-card-flush');
      hw.usb.forEach((u, i) => {
        const row = el('div', 'pi-row' + (i < hw.usb.length - 1 ? ' bordered' : ''));
        row.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M6 3L6 15"/><path d="M18 9l-2-6-2 6"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/><path d="M6 15h6v-3h6"/></svg>
          <span style="font-size:13px;color:var(--text-primary);margin-left:10px;flex:1">${esc(u)}</span>
        `;
        usbCard.appendChild(row);
      });
      container.appendChild(usbCard);
    }
  }

  // ── Cron Jobs ─────────────────────────────────────────────────────────
  async function _renderCron(container) {
    const data = await App.apiFetch('/api/pi/cron').then(r => r.json());
    container.innerHTML = '';

    const renderGroup = (title, entries) => {
      if (!entries.length) return;
      const label = el('div', 'pi-section-label');
      label.textContent = title;
      container.appendChild(label);
      const card = el('div', 'pi-card pi-card-flush');
      entries.forEach((entry, i) => {
        const row = el('div', 'pi-cron-row' + (i < entries.length - 1 ? ' bordered' : ''));
        row.innerHTML = `
          <div class="pi-cron-schedule">${esc(entry.schedule)}</div>
          <div class="pi-cron-cmd">${esc(entry.cmd)}</div>
          ${entry.source ? `<div class="pi-cron-source">${esc(entry.source)}</div>` : ''}
        `;
        card.appendChild(row);
      });
      container.appendChild(card);
    };

    renderGroup('User Crontab', data.user || []);
    renderGroup('System (/etc/cron.d)', data.system || []);

    if (!data.user?.length && !data.system?.length) {
      const e = el('div', 'pi-empty'); e.textContent = 'No cron jobs found';
      container.appendChild(e);
    }

    // Open in terminal button
    const termBtn = el('button', 'pi-svc-btn');
    termBtn.textContent = 'Edit crontab in Terminal';
    termBtn.style.cssText = 'margin:8px 16px 16px;';
    termBtn.addEventListener('click', () => { App.showTab('term'); Term.paste('crontab -e\n'); });
    container.appendChild(termBtn);
  }

  // ── Logs ───────────────────────────────────────────────────────────────
  async function _renderLogs(container) {
    container.innerHTML = '';
    container.classList.add('log-mode');

    const topBar = el('div', 'pi-log-bar');
    topBar.innerHTML = `
      <div class="pi-log-tabs">
        <button class="pi-log-tab active" data-src="system">System</button>
        <button class="pi-log-tab" data-src="pm2">PM2</button>
      </div>
      <select class="pi-log-select" id="pi-log-lines">
        <option value="50">50 lines</option>
        <option value="100" selected>100 lines</option>
        <option value="200">200 lines</option>
        <option value="500">500 lines</option>
      </select>
    `;
    container.appendChild(topBar);

    // PM2 unit selector (hidden by default)
    const pm2Sel = el('div', 'pi-log-pm2-sel hidden');
    pm2Sel.id = 'pi-log-pm2-sel';
    pm2Sel.innerHTML = '<select class="pi-log-select" id="pi-log-pm2-unit"><option value="">Loading PM2…</option></select>';
    container.appendChild(pm2Sel);

    const logOut = el('div', 'pi-log-output');
    logOut.id = 'pi-log-output';
    logOut.textContent = 'Loading…';
    container.appendChild(logOut);

    // Load PM2 process names
    App.apiFetch('/api/pi/processes').then(r => r.json()).then(procs => {
      const sel = document.getElementById('pi-log-pm2-unit');
      if (!sel) return;
      sel.innerHTML = procs.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    }).catch(() => {});

    let currentSrc = 'system';
    const fetchLogs = async () => {
      const logEl = document.getElementById('pi-log-output');
      if (!logEl) return;
      logEl.textContent = 'Loading…';
      const lines = document.getElementById('pi-log-lines')?.value || '100';
      let url = `/api/pi/logs?lines=${lines}`;
      if (currentSrc === 'pm2') {
        const unit = document.getElementById('pi-log-pm2-unit')?.value;
        if (!unit) { logEl.textContent = 'Select a PM2 process'; return; }
        url += `&unit=${encodeURIComponent(unit)}`;
      }
      try {
        const data = await App.apiFetch(url).then(r => r.json());
        logEl.innerHTML = (data.lines || []).map(l => {
          const cls = /error|fail|crit|alert|emerg/i.test(l) ? 'log-err'
                    : /warn/i.test(l) ? 'log-warn'
                    : 'log-info';
          return `<div class="log-line ${cls}">${esc(l)}</div>`;
        }).join('');
        logEl.scrollTop = logEl.scrollHeight;
      } catch (e) {
        logEl.textContent = 'Error: ' + e.message;
      }
    };

    topBar.querySelectorAll('.pi-log-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        topBar.querySelectorAll('.pi-log-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSrc = btn.dataset.src;
        const pm2El = document.getElementById('pi-log-pm2-sel');
        if (pm2El) pm2El.classList.toggle('hidden', currentSrc !== 'pm2');
        fetchLogs();
      });
    });

    document.getElementById('pi-log-lines')?.addEventListener('change', fetchLogs);
    document.getElementById('pi-log-pm2-unit')?.addEventListener('change', fetchLogs);

    await fetchLogs();
  }

  // ── Power ──────────────────────────────────────────────────────────────
  function _renderPower(container) {
    container.innerHTML = '';

    const label = el('div', 'pi-section-label');
    label.textContent = 'Power Controls';
    container.appendChild(label);

    const warn = el('div', 'pi-power-warn');
    warn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>Shutting down or rebooting will disconnect all active sessions.</span>
    `;
    container.appendChild(warn);

    const powerActions = [
      { id: 'reboot',   label: 'Restart Pi',   icon: svgIcon('refresh'), desc: 'Reboot the Raspberry Pi', danger: false },
      { id: 'poweroff', label: 'Shut Down',     icon: svgIcon('power'),   desc: 'Power off the Raspberry Pi', danger: true },
    ];

    const card = el('div', 'pi-card');
    powerActions.forEach((a, i) => {
      const row = el('div', 'pi-power-row' + (i < powerActions.length - 1 ? ' bordered' : ''));
      row.innerHTML = `
        <div class="pi-power-info">
          <div class="pi-power-icon ${a.danger ? 'danger' : ''}">${a.icon}</div>
          <div>
            <div class="pi-power-label">${esc(a.label)}</div>
            <div class="pi-power-desc">${esc(a.desc)}</div>
          </div>
        </div>
        <div class="pi-power-confirm-wrap" id="pi-pwr-${a.id}">
          <button class="pi-power-btn${a.danger ? ' danger' : ''}" data-action="${esc(a.id)}">${esc(a.label)}</button>
        </div>
      `;
      card.appendChild(row);
    });
    container.appendChild(card);

    // Confirmation flow
    card.querySelectorAll('.pi-power-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const wrap = document.getElementById(`pi-pwr-${action}`);
        if (!wrap) return;
        if (btn.classList.contains('confirming')) {
          doPower(action, wrap);
          return;
        }
        // Show confirm state
        btn.classList.add('confirming');
        const origText = btn.textContent;
        btn.textContent = 'Tap again to confirm';
        const cancel = el('button', 'pi-power-cancel');
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => {
          btn.classList.remove('confirming');
          btn.textContent = origText;
          cancel.remove();
        });
        wrap.appendChild(cancel);
        setTimeout(() => {
          if (btn.classList.contains('confirming')) {
            btn.classList.remove('confirming');
            btn.textContent = origText;
            cancel.remove();
          }
        }, 8000);
      });
    });

    // PM2 save / startup
    const pm2Label = el('div', 'pi-section-label');
    pm2Label.textContent = 'PM2';
    container.appendChild(pm2Label);

    const pm2Card = el('div', 'pi-card pi-card-flush');
    const pm2Actions = [
      { label: 'Save current process list', cmd: 'pm2 save', icon: svgIcon('save') },
      { label: 'View PM2 status',           tab: 'pi',       icon: svgIcon('list') },
      { label: 'Open Terminal',             tab: 'term',     icon: svgIcon('terminal') },
    ];
    pm2Actions.forEach((a, i) => {
      const row = el('div', 'pi-row' + (i < pm2Actions.length - 1 ? ' bordered' : ''));
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px">
          <span style="color:var(--text-dim)">${a.icon}</span>
          <span class="pi-row-label">${esc(a.label)}</span>
        </div>
        <span style="color:var(--text-dim)">›</span>
      `;
      row.addEventListener('click', () => {
        if (a.cmd) { App.showTab('term'); Term.paste(a.cmd + '\n'); }
        else if (a.tab) App.showTab(a.tab);
      });
      pm2Card.appendChild(row);
    });
    container.appendChild(pm2Card);
  }

  async function doPower(action, wrap) {
    const btn = wrap.querySelector('.pi-power-btn');
    const cancel = wrap.querySelector('.pi-power-cancel');
    if (btn) { btn.disabled = true; btn.textContent = action === 'reboot' ? 'Rebooting…' : 'Shutting down…'; }
    if (cancel) cancel.remove();
    try {
      await App.apiFetch('/api/pi/power', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      showToast(action === 'reboot' ? 'Rebooting…' : 'Shutting down…');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = action === 'reboot' ? 'Restart Pi' : 'Shut Down'; }
      showToast('Error: ' + e.message);
    }
  }

  // ── PM2 control ────────────────────────────────────────────────────────
  function makeProcCard(p) {
    const card = el('div', 'pi-proc-card pi-card');
    const isOnline = p.status === 'online';
    card.innerHTML = `
      <div class="pi-proc-head">
        <div class="pi-proc-info">
          <div class="pi-proc-name">${esc(p.name)}</div>
          <div class="pi-proc-meta">
            ${p.pid ? 'PID ' + esc(p.pid) : ''}
            ${p.uptimeMs ? ' · up ' + fmtUptime(p.uptimeMs / 1000) : ''}
            ${p.restarts > 0 ? ' · ' + p.restarts + ' restart' + (p.restarts !== 1 ? 's' : '') : ''}
          </div>
        </div>
        <span class="pi-badge ${isOnline ? 'online' : 'offline'}">${esc(p.status)}</span>
      </div>
      ${isOnline ? `
      <div class="pi-proc-stats">
        <span>CPU ${p.cpu.toFixed(1)}%</span>
        <span>RAM ${fmtBytes(p.mem)}</span>
      </div>` : ''}
      <div class="pi-proc-actions">
        <button class="pi-svc-btn${isOnline ? '' : ' primary'}" data-proc="${esc(p.name)}" data-action="${isOnline ? 'stop' : 'start'}">${isOnline ? 'Stop' : 'Start'}</button>
        <button class="pi-svc-btn" data-proc="${esc(p.name)}" data-action="restart">Restart</button>
        <button class="pi-svc-btn logs" data-proc="${esc(p.name)}">Logs</button>
      </div>
    `;
    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => doPm2(btn.dataset.action, btn.dataset.proc, btn));
    });
    card.querySelectorAll('.logs').forEach(btn => {
      btn.addEventListener('click', () => {
        App.showTab('term');
        Term.paste(`pm2 logs ${JSON.stringify(btn.dataset.proc)} --lines 50\n`);
      });
    });
    return card;
  }

  async function doPm2(action, name, btn) {
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await App.apiFetch('/api/pi/pm2', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error); }
      btn.textContent = '✓';
      setTimeout(() => _loadSection('processes'), 1500);
    } catch (e) {
      btn.disabled = false; btn.textContent = orig;
      showToast(action + ' ' + name + ' failed: ' + e.message);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function _setEl(id, v) {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  }

  function fmtUptime(s) {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function fmtBytes(b) {
    if (!b) return '0 B';
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1024).toFixed(0) + ' KB';
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showToast(msg) {
    let t = document.getElementById('pi-toast');
    if (!t) {
      t = el('div', 'pi-toast'); t.id = 'pi-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('show'), 3000);
  }

  function svgIcon(name) {
    const icons = {
      refresh: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`,
      terminal: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
      wifi: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
      log: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
      power: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`,
      hdd: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
      save: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
      list: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    };
    return icons[name] || '';
  }

  return { init, activate, deactivate, _switchSection };
})();
