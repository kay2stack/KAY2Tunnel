// Stan CLI — Automation tab.
//   • StanCLI Jobs  — our own runnable/schedulable jobs (run-now, on/off, log, create).
//   • Cron Jobs     — read-only view of Hermes scheduled jobs.
//   • Agent Tasks   — read-only Hermes kanban.
// Loads on demand with a manual refresh; never auto-polls (keeps the Pi calm).
const Ops = (() => {
  let _initialized = false;
  let _loading = false;
  const _openLogs = new Set();   // job ids whose log panel is expanded

  function init() { _initialized = true; }
  function activate() { if (!_initialized) init(); render(); }
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
  function fmtDur(ms) {
    if (ms == null) return '';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    return Math.round(ms / 60000) + 'm';
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
              <span>StanCLI Jobs <span style="color:var(--text-dim);font-weight:400">· run &amp; schedule</span></span>
              <span>
                <button id="ops-new" class="ops-refresh" style="margin-right:8px">+ New</button>
                <button id="ops-refresh" class="ops-refresh">Refresh</button>
              </span>
            </div>
            <div id="ops-newform" class="settings-group" style="margin:0 16px;display:none"></div>
            <div id="ops-jobs" class="settings-group" style="margin:0 16px"></div>
          </div>
          <div class="news-section">
            <div class="news-section-header"><span>Cron Jobs <span style="color:var(--text-dim);font-weight:400">· Hermes (read-only)</span></span></div>
            <div id="ops-cron" class="settings-group" style="margin:0 16px"></div>
          </div>
          <div class="news-section">
            <div class="news-section-header"><span>Agent Tasks <span style="color:var(--text-dim);font-weight:400">· Hermes kanban</span></span></div>
            <div id="ops-kanban" class="settings-group" style="margin:0 16px"></div>
          </div>
        </div>`;
      body.dataset.built = '1';
      body.querySelector('#ops-refresh').addEventListener('click', () => { _loading = false; render(); });
      body.querySelector('#ops-new').addEventListener('click', () => toggleNewForm(body));
    }

    const jobsEl = body.querySelector('#ops-jobs');
    const cronEl = body.querySelector('#ops-cron');
    const kbEl = body.querySelector('#ops-kanban');
    if (!jobsEl.dataset.loaded) jobsEl.innerHTML = `<div class="ops-empty">Loading…</div>`;

    try {
      const [jobs, cron, kb] = await Promise.all([
        App.apiFetch('/api/ops/jobs').then(r => r.json()).catch(() => []),
        App.apiFetch('/api/ops/cron').then(r => r.json()).catch(() => []),
        App.apiFetch('/api/ops/kanban').then(r => r.json()).catch(() => ({ tasks: [] })),
      ]);
      renderJobs(jobsEl, jobs);
      renderCron(cronEl, cron);
      renderKanban(kbEl, kb);
    } catch (e) {
      jobsEl.innerHTML = `<div class="ops-empty">Couldn't load (${esc(e.message)})</div>`;
    } finally {
      _loading = false;
    }
  }

  // ── StanCLI jobs ─────────────────────────────────────────────────────────
  const GROUPS = [['ops', 'Pi Ops'], ['crypto', 'Clive'], ['phone', 'Phone'], ['content', 'Clips'], ['other', 'Other']];

  function renderJobs(el, jobs) {
    el.dataset.loaded = '1';
    if (!Array.isArray(jobs) || !jobs.length) { el.innerHTML = `<div class="ops-empty">No jobs.</div>`; return; }
    let html = '';
    for (const [key, label] of GROUPS) {
      const inGroup = jobs.filter(j => (j.group || 'other') === key);
      if (!inGroup.length) continue;
      html += `<div class="ops-grouphdr">${label}</div>`;
      html += inGroup.map(jobRow).join('');
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', onAction));
  }

  function jobRow(j) {
    const dot = j.running ? 'var(--accent)' : j.lastStatus === 'ok' ? 'var(--green)'
              : j.lastStatus === 'fail' ? 'var(--red)' : 'var(--text-dim)';
    const badges =
      (j.builtin ? '' : '<span class="ops-badge">custom</span>') +
      (j.enabled ? '' : '<span class="ops-badge paused">off</span>') +
      (j.running ? '<span class="ops-badge run">running…</span>' : '');
    const sched = j.schedule ? `<code>${esc(j.schedule)}</code> · next ${fmtRel(j.nextRun)}` : '<span style="color:var(--text-dim)">manual</span>';
    const last = j.lastRun ? ` · ran ${fmtRel(j.lastRun)}${j.lastDurationMs != null ? ' (' + fmtDur(j.lastDurationMs) + ')' : ''}` : '';
    const logOpen = _openLogs.has(j.id);
    return `
      <div class="ops-row job" data-job="${esc(j.id)}">
        <span class="ops-dot${j.running ? ' pulse' : ''}" style="background:${dot}"></span>
        <div class="ops-main">
          <div class="ops-title">${esc(j.name)} ${badges}</div>
          <div class="ops-sub">${sched}${last} · ${j.runs || 0} run${j.runs === 1 ? '' : 's'}</div>
          ${j.desc ? `<div class="ops-sub" style="opacity:.75">${esc(j.desc)}</div>` : ''}
          <div class="ops-actions">
            <button class="ops-btn" data-act="run" data-id="${esc(j.id)}" ${j.running ? 'disabled' : ''}>Run</button>
            <button class="ops-btn" data-act="toggle" data-id="${esc(j.id)}" data-on="${j.enabled ? 0 : 1}">${j.enabled ? 'Disable' : 'Enable'}</button>
            <button class="ops-btn" data-act="log" data-id="${esc(j.id)}">${logOpen ? 'Hide log' : 'Log'}</button>
            ${j.builtin ? '' : `<button class="ops-btn danger" data-act="del" data-id="${esc(j.id)}">Delete</button>`}
          </div>
          <pre class="ops-log" data-log="${esc(j.id)}" style="display:${logOpen ? 'block' : 'none'}"></pre>
        </div>
      </div>`;
  }

  async function onAction(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id, act = btn.dataset.act;
    try {
      if (act === 'run') {
        btn.disabled = true; btn.textContent = 'Running…';
        await App.apiFetch(`/api/ops/jobs/${id}/run`, { method: 'POST' });
        setTimeout(() => { _loading = false; render(); }, 1200);
      } else if (act === 'toggle') {
        await App.apiFetch(`/api/ops/jobs/${id}/toggle`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: btn.dataset.on === '1' }),
        });
        _loading = false; render();
      } else if (act === 'log') {
        await toggleLog(id);
      } else if (act === 'del') {
        if (!confirm('Delete this job?')) return;
        await App.apiFetch(`/api/ops/jobs/${id}`, { method: 'DELETE' });
        _openLogs.delete(id); _loading = false; render();
      }
    } catch (err) { /* 401 handled in apiFetch */ }
  }

  async function toggleLog(id) {
    const pre = document.querySelector(`pre[data-log="${CSS.escape(id)}"]`);
    if (!pre) return;
    if (_openLogs.has(id)) { _openLogs.delete(id); pre.style.display = 'none'; return; }
    _openLogs.add(id); pre.style.display = 'block'; pre.textContent = 'Loading…';
    try {
      const { output } = await App.apiFetch(`/api/ops/jobs/${id}/log`).then(r => r.json());
      pre.textContent = output && output.trim() ? output : '(no output yet — run it once)';
    } catch { pre.textContent = '(couldn’t load log)'; }
    const btn = document.querySelector(`button[data-act="log"][data-id="${CSS.escape(id)}"]`);
    if (btn) btn.textContent = 'Hide log';
  }

  function toggleNewForm(body) {
    const f = body.querySelector('#ops-newform');
    if (f.style.display === 'block') { f.style.display = 'none'; return; }
    f.style.display = 'block';
    f.innerHTML = `
      <div class="ops-form">
        <input id="nf-name" class="ops-input" placeholder="Name (e.g. Clear /tmp logs)">
        <input id="nf-cmd" class="ops-input" placeholder="Command (e.g. bash scripts/my-task.sh)">
        <input id="nf-sched" class="ops-input" placeholder="Cron schedule — optional (e.g. 0 6 * * *)">
        <div class="ops-formrow">
          <select id="nf-group" class="ops-input">
            <option value="ops">Pi Ops</option><option value="crypto">Clive</option>
            <option value="phone">Phone</option><option value="content">Clips</option>
            <option value="other" selected>Other</option>
          </select>
          <button id="nf-add" class="ops-btn primary">Add job</button>
        </div>
        <div id="nf-err" class="ops-err" style="display:none"></div>
      </div>`;
    f.querySelector('#nf-add').addEventListener('click', () => addJob(body, f));
  }

  async function addJob(body, f) {
    const name = f.querySelector('#nf-name').value.trim();
    const cmd = f.querySelector('#nf-cmd').value.trim();
    const schedule = f.querySelector('#nf-sched').value.trim();
    const group = f.querySelector('#nf-group').value;
    const errEl = f.querySelector('#nf-err');
    errEl.style.display = 'none';
    if (!name || !cmd) { errEl.textContent = 'Name and command are required.'; errEl.style.display = 'block'; return; }
    try {
      const r = await App.apiFetch('/api/ops/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cmd, schedule: schedule || null, group }),
      }).then(x => x.json());
      if (!r.ok) { errEl.textContent = r.error || 'Failed to add.'; errEl.style.display = 'block'; return; }
      f.style.display = 'none';
      _loading = false; render();
    } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  }

  // ── read-only Hermes views ─────────────────────────────────────────────────
  function renderCron(el, jobs) {
    if (!Array.isArray(jobs) || !jobs.length) { el.innerHTML = `<div class="ops-empty">No scheduled jobs.</div>`; return; }
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
    if (!kb || kb.available === false) { el.innerHTML = `<div class="ops-empty">Hermes not reachable.</div>`; return; }
    const tasks = kb.tasks || [];
    if (!tasks.length) { el.innerHTML = `<div class="ops-empty">No active tasks — board is clear.</div>`; return; }
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
