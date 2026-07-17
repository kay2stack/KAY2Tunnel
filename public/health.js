// Stan CLI — System Health panel (Pi recovery & monitoring)

const Health = (() => {
  let _pollTimer = null;
  let _data = null;

  function el(id) { return document.getElementById(id); }

  function severityColor(s) {
    if (s === 'critical') return 'var(--red)';
    if (s === 'warning') return 'var(--amber)';
    return 'var(--blue)';
  }

  function severityBg(s) {
    if (s === 'critical') return 'var(--red-bg)';
    if (s === 'warning') return 'var(--amber-bg)';
    return 'var(--blue-bg)';
  }

  function scoreColor(score) {
    if (score >= 85) return 'var(--green)';
    if (score >= 60) return 'var(--amber)';
    return 'var(--red)';
  }

  function formatTemp(c) {
    if (c == null) return '—';
    return `${c.toFixed(1)}°C`;
  }

  async function fetchSummary() {
    const r = await App.apiFetch('/api/health/summary');
    return r.json();
  }

  async function fetchFull() {
    const r = await App.apiFetch('/api/health');
    return r.json();
  }

  function updateHomeSummary(s) {
    const sub = el('home-subgreeting');
    if (sub) {
      const online = s.tailscale?.active;
      sub.textContent = online ? 'kay2 is online · tailnet' : 'kay2 · LAN only';
      sub.classList.remove('status-warn', 'status-critical');
      if (s.criticalCount > 0) sub.classList.add('status-critical');
      else if (!online || s.issueCount > 0) sub.classList.add('status-warn');
    }

    const scoreEl = el('home-health-score');
    if (scoreEl) {
      scoreEl.textContent = s.score;
      scoreEl.style.color = scoreColor(s.score);
    }

    const gradeEl = el('home-health-grade');
    if (gradeEl) gradeEl.textContent = s.health?.label || '—';

    const tempEl = el('home-temp');
    if (tempEl) tempEl.textContent = formatTemp(s.tempC);

    const memEl = el('home-mem');
    if (memEl) memEl.textContent = s.memoryUsePct != null ? `${s.memoryUsePct}%` : '—';

    const uptimeEl = el('home-uptime');
    if (uptimeEl) uptimeEl.textContent = s.uptime?.human || '—';

    const statusCard = el('home-status-value');
    const statusSub = el('home-status-sub');
    if (statusCard && statusSub) {
      if (s.criticalCount > 0) {
        statusCard.textContent = `${s.criticalCount} alert${s.criticalCount > 1 ? 's' : ''}`;
        statusCard.style.color = 'var(--red)';
        statusSub.textContent = 'Tap Health for details';
      } else if (s.issueCount > 0) {
        statusCard.textContent = 'Attention';
        statusCard.style.color = 'var(--amber)';
        statusSub.textContent = `${s.issueCount} issue${s.issueCount > 1 ? 's' : ''}`;
      } else {
        statusCard.textContent = 'Healthy';
        statusCard.style.color = 'var(--green)';
        statusSub.textContent = s.tailscale?.active ? 'Tailscale connected' : 'Tailscale off';
      }
    }

    const dot = el('home-status-dot');
    if (dot) {
      dot.className = 'home-status-dot ' + (
        s.criticalCount > 0 ? 'critical' : s.issueCount > 0 ? 'warn' : 'ok'
      );
    }
  }

  function renderRing(score) {
    const ring = el('health-score-ring');
    if (!ring) return;
    const pct = score / 100;
    const deg = Math.round(pct * 360);
    const color = scoreColor(score);
    ring.style.background = `conic-gradient(${color} ${deg}deg, var(--bg-secondary) ${deg}deg)`;
    el('health-score-num').textContent = score;
    el('health-score-num').style.color = color;
    el('health-grade-label').textContent = _data?.health?.label || '';
  }

  function renderMetrics(d) {
    const grid = el('health-metrics');
    if (!grid) return;
    const items = [
      { label: 'Uptime', value: d.uptime?.human || '—' },
      { label: 'CPU temp', value: formatTemp(d.pi?.tempC) },
      { label: 'Memory', value: `${d.memory?.usePct ?? '—'}%` },
      { label: 'Disk', value: d.disk ? `${d.disk.usePct}%` : '—' },
      { label: 'Load', value: d.load ? d.load['1m'].toFixed(2) : '—' },
      { label: 'LAN IP', value: d.network?.lanIp || '—' },
      { label: 'Tailscale', value: d.tailscale?.active ? (d.tailscale.ip || 'on') : 'off' },
      { label: 'Internet', value: d.network?.internetOk ? 'OK' : 'fail' },
    ];
    grid.innerHTML = items.map(i => `
      <div class="health-metric">
        <div class="health-metric-label">${i.label}</div>
        <div class="health-metric-value">${i.value}</div>
      </div>
    `).join('');
  }

  function renderIssues(issues) {
    const list = el('health-issues');
    if (!list) return;
    if (!issues?.length) {
      list.innerHTML = `<div class="health-empty">No issues detected. Pi looks stable.</div>`;
      return;
    }
    list.innerHTML = issues.map(issue => `
      <div class="health-issue" style="border-left:3px solid ${severityColor(issue.severity)}">
        <div class="health-issue-head">
          <span class="health-issue-badge" style="background:${severityBg(issue.severity)};color:${severityColor(issue.severity)}">${issue.severity}</span>
          <span class="health-issue-title">${issue.title}</span>
        </div>
        <p class="health-issue-detail">${issue.detail}</p>
        ${issue.action ? `<button class="health-issue-action" data-action="${issue.action}">Fix</button>` : ''}
      </div>
    `).join('');

    list.querySelectorAll('.health-issue-action').forEach(btn => {
      btn.addEventListener('click', () => runAction(btn.dataset.action));
    });
  }

  function renderReboots(history) {
    const el_ = el('health-reboots');
    if (!el_) return;
    if (!history?.length) {
      el_.innerHTML = '<div class="health-empty">No reboot history available</div>';
      return;
    }
    el_.innerHTML = history.map(h => `
      <div class="health-reboot-row">${h.line}</div>
    `).join('');
  }

  function renderProcesses(procs) {
    const el_ = el('health-processes');
    if (!el_) return;
    if (!procs?.length) {
      el_.innerHTML = '<div class="health-empty">—</div>';
      return;
    }
    el_.innerHTML = procs.map(p => `
      <div class="health-proc-row">
        <span class="health-proc-mem">${p.memPct}%</span>
        <span class="health-proc-cmd">${p.command}</span>
      </div>
    `).join('');
  }

  function renderPanel(d) {
    _data = d;
    renderRing(d.score);
    renderMetrics(d);
    renderIssues(d.issues);
    renderReboots(d.rebootHistory);
    renderProcesses(d.topProcesses);

    const tsBtn = el('health-action-ts-disable');
    const tsOnBtn = el('health-action-ts-enable');
    if (tsBtn) tsBtn.classList.toggle('hidden', !d.tailscale?.active);
    if (tsOnBtn) tsOnBtn.classList.toggle('hidden', d.tailscale?.active);
  }

  async function refreshPanel() {
    const loading = el('health-loading');
    if (loading) loading.classList.remove('hidden');
    try {
      const d = await fetchFull();
      renderPanel(d);
      updateHomeSummary({
        score: d.score,
        health: d.health,
        issueCount: d.issues.length,
        criticalCount: d.issues.filter(i => i.severity === 'critical').length,
        tempC: d.pi?.tempC,
        memoryUsePct: d.memory?.usePct,
        uptime: d.uptime,
        tailscale: d.tailscale,
      });
    } catch (e) {
      el('health-issues').innerHTML = `<div class="health-empty" style="color:var(--red)">Failed to load health data</div>`;
    } finally {
      if (loading) loading.classList.add('hidden');
    }
  }

  async function runAction(action, needsConfirm = true) {
    const labels = {
      'tailscale-disable': 'Stop Tailscale and clear serve proxy? Remote access will drop until re-enabled.',
      'tailscale-enable': 'Start Tailscale and expose Stan CLI on the tailnet?',
      'restart-pm2': 'Restart stan-cli via PM2?',
      'diagnose': 'Save a full diagnostic snapshot to ~/pi-diagnostics?',
    };

    if (needsConfirm && labels[action] && !confirm(labels[action])) return;

    try {
      if (action === 'diagnose') {
        await App.apiFetch('/api/health/snapshot', { method: 'POST' });
        alert('Diagnostic snapshot saved on the Pi.');
      } else {
        const body = ['tailscale-disable', 'tailscale-enable'].includes(action)
          ? JSON.stringify({ confirm: true })
          : undefined;
        const r = await App.apiFetch(`/api/health/actions/${action}`, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Action failed');
        if (j.message) alert(j.message);
      }
      await refreshPanel();
    } catch (e) {
      alert(e.message || 'Action failed');
    }
  }

  function open() {
    el('health-sheet-backdrop')?.classList.remove('hidden');
    refreshPanel();
    _pollTimer = setInterval(refreshPanel, 30000);
  }

  function close() {
    el('health-sheet-backdrop')?.classList.add('hidden');
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  function init() {
    el('health-close-btn')?.addEventListener('click', close);
    el('health-sheet-backdrop')?.addEventListener('click', e => {
      if (e.target.id === 'health-sheet-backdrop') close();
    });
    el('health-refresh-btn')?.addEventListener('click', refreshPanel);
    el('qa-health')?.addEventListener('click', open);
    el('home-health-card')?.addEventListener('click', open);

    el('health-action-diagnose')?.addEventListener('click', () => runAction('diagnose'));
    el('health-action-ts-disable')?.addEventListener('click', () => runAction('tailscale-disable'));
    el('health-action-ts-enable')?.addEventListener('click', () => runAction('tailscale-enable'));
    el('health-action-restart')?.addEventListener('click', () => runAction('restart-pm2', true));
  }

  async function pollHome() {
    try {
      const s = await fetchSummary();
      updateHomeSummary(s);
    } catch {}
  }

  return { init, open, close, pollHome, refreshPanel };
})();
