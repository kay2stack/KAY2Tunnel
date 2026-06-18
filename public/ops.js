// Stan CLI — Automation tab: read-only view of Hermes cron jobs + agent tasks.
// Loads on demand with a manual refresh; never auto-polls (keeps the Pi calm).
const Ops = (() => {
  let _initialized = false;
  let _loading = false;

  function init() { _initialized = true; }

  function activate() {
    if (!_initialized) init();
    render();        // fetch fresh each time the tab opens
  }

  function deactivate() {}

  function fmtRel(iso) {
    if (!iso) return '—';
    const d = new Date(iso), now = Date.now();
    let s = Math.round((d.getTime() - now) / 1000);
    const past = s < 0; s = Math.abs(s);
    const u = s < 60 ? [s, 's'] : s < 3600 ? [Math.round(s / 60), 'm']
            : s < 86400 ? [Math.round(s / 3600), 'h'] : [Math.round(s / 86400), 'd'];
    return past ? `${u[0]}${u[1]} ago` : `in ${u[0]}${u[1]}`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function render() {
    const body = document.getElementById('ops-body');
    if (!body || _loading) return;
    _loading = true;
    if (!body.dataset.built) {
      body.innerHTML = `
        <div class="news-feed">
          <div class="news-section" style="margin-top:20px">
            <div class="news-section-header">
              <span>Cron Jobs</span>
              <button id="ops-refresh" class="ops-refresh">Refresh</button>
            </div>
            <div id="ops-cron" class="settings-group" style="margin:0 16px"></div>
          </div>
          <div class="news-section">
            <div class="news-section-header"><span>Agent Tasks <span style="color:var(--text-dim);font-weight:400">· Hermes kanban</span></span></div>
            <div id="ops-kanban" class="settings-group" style="margin:0 16px"></div>
          </div>
        </div>`;
      body.dataset.built = '1';
      body.querySelector('#ops-refresh').addEventListener('click', () => { _loading = false; render(); });
    }

    const cronEl = body.querySelector('#ops-cron');
    const kbEl = body.querySelector('#ops-kanban');
    cronEl.innerHTML = `<div class="ops-empty">Loading…</div>`;

    try {
      const [cron, kb] = await Promise.all([
        App.apiFetch('/api/ops/cron').then(r => r.json()),
        App.apiFetch('/api/ops/kanban').then(r => r.json()).catch(() => ({ tasks: [] })),
      ]);
      renderCron(cronEl, cron);
      renderKanban(kbEl, kb);
    } catch (e) {
      cronEl.innerHTML = `<div class="ops-empty">Couldn't load (${esc(e.message)})</div>`;
    } finally {
      _loading = false;
    }
  }

  function renderCron(el, jobs) {
    if (!Array.isArray(jobs) || !jobs.length) {
      el.innerHTML = `<div class="ops-empty">No scheduled jobs.</div>`;
      return;
    }
    el.innerHTML = jobs.map(j => {
      const ok = j.lastStatus === 'ok';
      const dot = j.lastError ? 'var(--red)' : ok ? 'var(--green)' : 'var(--text-dim)';
      const badge = j.enabled ? '' : '<span class="ops-badge paused">paused</span>';
      return `
      <div class="ops-row">
        <span class="ops-dot" style="background:${dot}"></span>
        <div class="ops-main">
          <div class="ops-title">${esc(j.name)} ${badge}<span class="ops-badge">${esc(j.mode)}</span></div>
          <div class="ops-sub">
            <code>${esc(j.schedule)}</code> · next ${fmtRel(j.nextRun)} · ${j.runs} run${j.runs === 1 ? '' : 's'}
            ${j.lastError ? `<div class="ops-err">⚠ ${esc(j.lastError)}</div>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function renderKanban(el, kb) {
    if (!kb || kb.available === false) {
      el.innerHTML = `<div class="ops-empty">Hermes not reachable.</div>`;
      return;
    }
    const tasks = kb.tasks || [];
    if (!tasks.length) {
      el.innerHTML = `<div class="ops-empty">No active tasks — board is clear.</div>`;
      return;
    }
    el.innerHTML = tasks.map(t => `
      <div class="ops-row">
        <span class="ops-dot" style="background:var(--accent)"></span>
        <div class="ops-main">
          <div class="ops-title">${esc(t.title || t.id)}</div>
          <div class="ops-sub">${esc(t.status)}${t.assignee ? ' · ' + esc(t.assignee) : ''}${t.board ? ' · ' + esc(t.board) : ''}</div>
        </div>
      </div>`).join('');
  }

  return { init, activate, deactivate, refresh: render };
})();
