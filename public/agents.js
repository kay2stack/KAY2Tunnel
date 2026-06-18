// Stan CLI — Agents tab: Watchtower + agent cards + Stan chat

const Agents = (() => {
  let _initialized = false;
  let _pollInterval = null;
  let _stanChatActive = false;
  let _prevSessionIds = new Set();
  let _prevDirtyRepos = {};

  const ICONS = App.AGENT_ICONS;  // single source of truth (defined in app.js)

  // Target-first launcher state
  let _projects = [];
  let _shortcuts = [];
  let _agentsCache = [];
  let _expandedTargetKey = null;

  function init() {}

  function activate() {
    if (_stanChatActive) return;
    if (!_initialized) { _initialized = true; load(); }
    // Idempotent: assigning onclick never stacks listeners across re-activations.
    const btn = document.getElementById('agents-refresh-btn');
    if (btn) btn.onclick = () => load();
    _startPolling();
  }

  function deactivate() {
    _stopPolling();
  }

  function _startPolling() {
    _stopPolling();
    _pollInterval = setInterval(_poll, 3000);
  }

  function _stopPolling() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  async function _poll() {
    // System stats
    try {
      const r = await App.apiFetch('/api/system');
      const s = await r.json();
      _updateSysBar(s);
    } catch {}

    // Agent tails + dirty detection
    if (_stanChatActive) return;
    try {
      const r = await App.apiFetch('/api/agents');
      const agents = await r.json();
      const pairs = agents.flatMap(a => (a.sessions || []).map(s => ({ agent: a, session: s })));

      // If the set of running sessions changed (one started/stopped), re-render
      // so cards appear/disappear — otherwise just refresh the live previews.
      const currentIds = new Set(pairs.map(p => p.session.id));
      const changed = currentIds.size !== _prevSessionIds.size
        || [...currentIds].some(id => !_prevSessionIds.has(id));
      _prevSessionIds = currentIds;

      const list = document.getElementById('agents-list');
      if (changed && list) { render(agents, list); return; }

      pairs.forEach(p => {
        const el = document.querySelector(`[data-preview-for="${p.session.id}"]`);
        const durEl = document.querySelector(`[data-dur-for="${p.session.id}"]`);
        if (el) loadTail(p.session.id, el);
        if (durEl && p.session.createdAt) durEl.textContent = fmtDuration(Date.now() - p.session.createdAt);
      });
    } catch {}
  }

  function _updateSysBar(s) {
    const cpuEl  = document.getElementById('sys-cpu');
    const memEl  = document.getElementById('sys-mem');
    const tempEl = document.getElementById('sys-temp');
    const loadEl = document.getElementById('sys-load');
    if (cpuEl)  cpuEl.textContent  = s.cpu + '%';
    if (memEl)  memEl.textContent  = s.mem ? s.mem.pct + '%' : '—';
    if (tempEl) tempEl.textContent = s.temp != null ? s.temp + '°' : '—';
    if (loadEl) loadEl.textContent = s.load ? s.load[0].toFixed(2) : '—';
  }

  async function load() {
    const list = document.getElementById('agents-list');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--text-dim);font-size:14px;text-align:center;padding:40px 0">Loading…</div>';
    try {
      const [sysRes, agentsRes, projRes, dirRes] = await Promise.all([
        App.apiFetch('/api/system').then(r => r.json()).catch(() => null),
        App.apiFetch('/api/agents').then(r => r.json()),
        App.apiFetch('/api/projects').then(r => r.json()).catch(() => []),
        App.apiFetch('/api/agents/launch-dirs').then(r => r.json()).catch(() => []),
      ]);
      if (sysRes) _updateSysBar(sysRes);
      _projects = Array.isArray(projRes) ? projRes : [];
      _shortcuts = Array.isArray(dirRes) ? dirRes : [];
      render(agentsRes, list);
    } catch (e) {
      if (list) list.innerHTML = `<div style="color:var(--red);padding:16px">${esc(e.message)}</div>`;
    }
  }

  function render(agents, container) {
    container.innerHTML = '';
    _agentsCache = agents;

    // One card per running SESSION — an agent may have several (one per project).
    const runningPairs = agents.flatMap(a => (a.sessions || []).map(s => ({ agent: a, session: s })));
    const launchable  = agents.filter(a => a.cmd);                 // claude-code, codex, gemini, cursor, hermes
    const stan        = agents.find(a => a.id === 'stan');

    // 1. Running agents pinned on top
    if (runningPairs.length) {
      container.appendChild(sectionLabel('Running'));
      runningPairs.forEach(p => container.appendChild(makeRunningCard(p.agent, p.session)));
    }

    // 2. Target-first launcher
    container.appendChild(buildLauncher(launchable));

    // 3. Stan — local AI chat (no repo to point at, so it lives below the launcher)
    if (stan) container.appendChild(makeStanCard(stan));
  }

  // ── Running agent card (one per session) ──────────
  function makeRunningCard(agent, session) {
    const icon = ICONS[agent.id] || { letter: '?', bg: '#555' };
    const card = document.createElement('div');
    card.className = 'agent-card running-card';
    card.setAttribute('data-agent-id', agent.id);
    card.setAttribute('data-session-id', session.id);

    const repo = session?.cwd ? session.cwd.split('/').pop() : '';
    const dur  = session?.createdAt ? fmtDuration(Date.now() - session.createdAt) : '';
    const meta = (repo ? esc(repo) + ' · ' : '') + esc(agent.provider);

    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-icon" style="background:${icon.bg}">${icon.letter}</div>
        <div class="agent-info">
          <div class="agent-name">${esc(agent.name)}</div>
          <div class="agent-meta">${meta}</div>
        </div>
        <div class="agent-status running">
          <span class="status-dot connected"></span> Running
          <span class="agent-dur" data-dur-for="${esc(session.id)}">${esc(dur)}</span>
        </div>
      </div>`;

    const actions = document.createElement('div');
    actions.className = 'agent-actions';
    const viewBtn = document.createElement('button');
    viewBtn.className = 'agent-btn primary';
    viewBtn.textContent = 'Open Terminal';
    viewBtn.addEventListener('click', () => App.openTerminalForSession(session.id));
    const stopBtn = document.createElement('button');
    stopBtn.className = 'agent-btn danger';
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', () => stopAgent(agent.id, session.id));
    actions.appendChild(viewBtn);
    actions.appendChild(stopBtn);
    card.appendChild(actions);

    const preview = document.createElement('div');
    preview.className = 'agent-output';
    preview.setAttribute('data-preview-for', session.id);
    preview.textContent = 'Loading output…';
    card.appendChild(preview);
    loadTail(session.id, preview);

    return card;
  }

  // ── Stan quick-chat card ──────────────────────────
  function makeStanCard(agent) {
    const icon = ICONS.stan;
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-icon" style="background:${icon.bg}">${icon.letter}</div>
        <div class="agent-info">
          <div class="agent-name">${esc(agent.name)}</div>
          <div class="agent-meta">${esc(agent.provider)}</div>
        </div>
      </div>`;
    const actions = document.createElement('div');
    actions.className = 'agent-actions';
    const chatBtn = document.createElement('button');
    chatBtn.className = 'agent-btn primary';
    chatBtn.textContent = 'Chat with Stan';
    chatBtn.addEventListener('click', () => openStanChat());
    actions.appendChild(chatBtn);
    card.appendChild(actions);
    return card;
  }

  // ── Target-first launcher ─────────────────────────
  // Pick a project/folder, then one tap launches the chosen agent there.

  function buildLauncher(launchable) {
    const wrap = document.createElement('div');
    wrap.id = 'agent-launcher';
    wrap.appendChild(sectionLabel('Point an agent at…'));

    const search = document.createElement('input');
    search.id = 'launcher-search';
    search.className = 'launcher-search';
    search.type = 'text';
    search.placeholder = 'Search projects & folders…';
    search.autocapitalize = 'off';
    search.autocomplete = 'off';
    search.spellcheck = false;
    wrap.appendChild(search);

    const targetList = document.createElement('div');
    targetList.id = 'launcher-targets';
    wrap.appendChild(targetList);

    const draw = () => renderTargets(targetList, launchable, search.value.trim().toLowerCase());
    search.addEventListener('input', draw);
    draw();
    return wrap;
  }

  function buildTargetEntries() {
    const entries = [];
    const seen = new Set();
    getRecents().forEach(r => {
      if (seen.has(r.path)) return;
      seen.add(r.path);
      entries.push({ key: r.path, label: r.label, branch: r.branch || '', recent: true, lastAgent: r.agentId });
    });
    _shortcuts.forEach(s => {
      const k = s.path ?? '';
      if (seen.has(k)) return;
      seen.add(k);
      entries.push({ key: k, label: launchDirLabel(s), branch: s.git?.branch || '', sub: launchDirSub(s) });
    });
    _projects.forEach(p => {
      const k = p.relativePath || p.name;
      if (seen.has(k)) return;
      seen.add(k);
      entries.push({ key: k, label: p.name, branch: p.git?.branch || '', sub: '~/' + k });
    });
    return entries;
  }

  function renderTargets(container, launchable, query) {
    let entries = buildTargetEntries();
    if (query) {
      entries = entries.filter(e =>
        e.label.toLowerCase().includes(query) || String(e.key).toLowerCase().includes(query));
    }
    container.innerHTML = '';
    if (!entries.length) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:16px 4px">No matching folders.</div>';
      return;
    }
    entries.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'target-row' + (entry.key === _expandedTargetKey ? ' expanded' : '');

      const head = document.createElement('button');
      head.className = 'target-head';
      const branch = entry.branch ? `<span class="target-branch">⎇ ${esc(entry.branch)}</span>` : '';
      const sub = entry.sub ? `<span class="target-sub">${esc(entry.sub)}</span>` : '';
      head.innerHTML = `
        <span class="target-star">${entry.recent ? '★' : '›'}</span>
        <span class="target-name">${esc(entry.label)}</span>
        ${branch || sub}`;
      head.addEventListener('click', () => {
        _expandedTargetKey = (_expandedTargetKey === entry.key) ? null : entry.key;
        renderTargets(container, launchable, query);
      });
      row.appendChild(head);

      if (entry.key === _expandedTargetKey) {
        row.appendChild(buildLaunchPanel(entry, launchable));
      }
      container.appendChild(row);
    });
  }

  function buildLaunchPanel(entry, launchable) {
    const panel = document.createElement('div');
    panel.className = 'launch-panel';

    // Default agent: last one used here, else first installed, preferring Claude Code.
    const installed = launchable.filter(a => a.installed);
    let selected =
      installed.find(a => a.id === entry.lastAgent)?.id ||
      installed.find(a => a.id === 'claude-code')?.id ||
      installed[0]?.id || null;

    const chips = document.createElement('div');
    chips.className = 'agent-chips';
    launchable.forEach(a => {
      const icon = ICONS[a.id] || { letter: '?', bg: '#555' };
      const chip = document.createElement('button');
      chip.className = 'agent-chip' + (a.id === selected ? ' active' : '') + (a.installed ? '' : ' disabled');
      chip.innerHTML = `<span class="chip-dot" style="background:${icon.bg}">${icon.letter}</span>${esc(a.name)}`;
      if (!a.installed) chip.title = `Not installed (npm i -g ${a.cmd})`;
      chip.addEventListener('click', () => {
        if (!a.installed) return;
        selected = a.id;
        chips.querySelectorAll('.agent-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
      chips.appendChild(chip);
    });
    panel.appendChild(chips);

    const prompt = document.createElement('textarea');
    prompt.className = 'launch-prompt';
    prompt.rows = 1;
    prompt.placeholder = 'Optional: a first prompt for the agent';
    prompt.addEventListener('input', () => {
      prompt.style.height = 'auto';
      prompt.style.height = Math.min(prompt.scrollHeight, 120) + 'px';
    });
    panel.appendChild(prompt);

    const doLaunch = (auto, agentOverride) => {
      const id = agentOverride || selected;
      if (!id) { App.toast('No installed agent selected.', 'error'); return; }
      addRecent(id, entry.key, entry.label, entry.branch);
      launch(id, entry.key === '' ? null : entry.key, prompt.value.trim(), { auto });
    };

    const btnRow = document.createElement('div');
    btnRow.className = 'launch-btn-row';

    const go = document.createElement('button');
    go.className = 'agent-btn primary launch-go';
    go.textContent = 'Launch here';
    go.addEventListener('click', () => doLaunch(false));
    btnRow.appendChild(go);

    // ⚡ Auto — always shown when Claude Code is available. Launches
    // `claude --permission-mode auto` regardless of the selected chip.
    if (installed.some(a => a.id === 'claude-code')) {
      const autoBtn = document.createElement('button');
      autoBtn.className = 'agent-btn launch-auto';
      autoBtn.innerHTML = '⚡ Auto';
      autoBtn.title = 'Launch Claude Code in --permission-mode auto';
      autoBtn.addEventListener('click', () => doLaunch(true, 'claude-code'));
      btnRow.appendChild(autoBtn);
    }

    panel.appendChild(btnRow);
    return panel;
  }

  // ── Recents (localStorage) ────────────────────────
  function getRecents() {
    try { return JSON.parse(localStorage.getItem('stan_agent_recents') || '[]'); }
    catch { return []; }
  }
  function addRecent(agentId, path, label, branch) {
    try {
      const key = path == null ? '' : path;
      let list = getRecents().filter(r => r.path !== key);
      list.unshift({ path: key, label: label || (key ? key.split('/').pop() : 'Home'), agentId, branch: branch || '' });
      localStorage.setItem('stan_agent_recents', JSON.stringify(list.slice(0, 5)));
    } catch {}
  }

  function sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'news-section-header';
    el.style.cssText = 'margin-top:24px;margin-bottom:12px';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    return el;
  }

  async function loadTail(sessionId, el) {
    try {
      const r = await App.apiFetch(`/api/agents/session/${sessionId}/tail`);
      const { tail } = await r.json();
      const clean = tail.replace(/\x1b\[[0-9;]*[mGKH]/g, '').replace(/\r/g, '');
      const lines = clean.split('\n').filter(l => l.trim());
      const lastLine = lines[lines.length - 1] || '';
      const preview = lines.slice(-6).join('\n') || '(no output yet)';
      el.textContent = preview;
      el.scrollTop = el.scrollHeight;

      // Update ticker with last meaningful line
      const tickerEl = el.closest('.agent-card')?.querySelector('.agent-ticker');
      if (tickerEl && lastLine) tickerEl.textContent = lastLine.slice(0, 80);
    } catch { el.textContent = '(unavailable)'; }
  }

  // ── Launch sheet ──────────────────────────────────

  async function promptLaunch(agent, suggestedPath = null) {
    try {
      const [projects, shortcuts] = await Promise.all([
        App.apiFetch('/api/projects').then(r => r.json()),
        App.apiFetch('/api/agents/launch-dirs').then(r => r.json()),
      ]);
      showLaunchSheet(agent, projects, shortcuts, suggestedPath);
    } catch {
      await launch(agent.id, suggestedPath || null);
    }
  }

  function launchDirLabel(entry) {
    if (!entry.path) return entry.label || 'Home';
    return entry.label || `~/${entry.path}`;
  }

  function launchDirSub(entry) {
    if (!entry.path) return '~/';
    return `~/${entry.path}`;
  }

  function makeLaunchBtn(entry, suggestedKey) {
    const key = entry.path ?? '';
    const suggested = suggestedKey !== null && key === suggestedKey;
    const branch = entry.git?.branch ? `⎇ ${esc(entry.git.branch)}` : launchDirSub(entry);
    return `
      <button class="project-btn terminal launch-dir-btn${suggested ? ' launch-dir-suggested' : ''}"
        style="width:100%;margin-bottom:8px;flex:unset;justify-content:flex-start;padding:12px"
        data-launch-path="${esc(key)}">
        <span style="font-weight:600">${esc(launchDirLabel(entry))}</span>
        <span style="color:var(--text-dim);margin-left:8px;font-size:12px">${branch}</span>
      </button>`;
  }

  function showLaunchSheet(agent, projects, shortcuts, suggestedPath = null) {
    const existing = document.getElementById('launch-sheet');
    if (existing) existing.remove();

    const suggestedKey = suggestedPath != null ? (launchPathKey(suggestedPath) ?? '') : null;
    const shortcutKeys = new Set(shortcuts.map(s => s.path ?? ''));
    const extraProjects = projects
      .map(p => ({ label: p.name, path: p.relativePath || p.name, git: p.git }))
      .filter(p => !shortcutKeys.has(p.path ?? ''));

    const sheet = document.createElement('div');
    sheet.id = 'launch-sheet';
    sheet.style.cssText = `
      position:fixed;inset:0;z-index:60;background:rgba(0,0,0,0.65);
      backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;
    `;
    const icon = ICONS[agent.id] || { letter: '?', bg: '#555' };
    sheet.innerHTML = `
      <div style="background:var(--bg-card);border-radius:var(--r-xl) var(--r-xl) 0 0;
        border:1px solid var(--border);width:100%;max-width:600px;padding:var(--sp-6);max-height:75vh;overflow-y:auto">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:var(--sp-5)">
          <div class="agent-icon" style="background:${icon.bg};width:36px;height:36px;font-size:15px">${icon.letter}</div>
          <div>
            <div style="font-size:16px;font-weight:600">Launch ${esc(agent.name)}</div>
            <div style="font-size:13px;color:var(--text-dim)">Choose working directory</div>
          </div>
          <button class="top-bar-action" style="margin-left:auto" id="launch-cancel">Cancel</button>
        </div>
        <div class="launch-section-label">Quick locations</div>
        <div id="launch-shortcuts">
          ${shortcuts.map(s => makeLaunchBtn(s, suggestedKey)).join('')}
        </div>
        ${extraProjects.length ? `
          <div class="launch-section-label" style="margin-top:var(--sp-4)">Git repos</div>
          <div id="launch-project-list">
            ${extraProjects.map(p => makeLaunchBtn(p, suggestedKey)).join('')}
          </div>
        ` : ''}
      </div>
    `;

    sheet.querySelector('#launch-cancel').addEventListener('click', () => sheet.remove());
    sheet.querySelectorAll('[data-launch-path]').forEach(btn => {
      btn.addEventListener('click', async () => {
        sheet.remove();
        const p = btn.dataset.launchPath;
        await launch(agent.id, p === '' ? null : p);
      });
    });
    document.body.appendChild(sheet);
    const suggestedBtn = sheet.querySelector('.launch-dir-suggested');
    if (suggestedBtn) suggestedBtn.scrollIntoView({ block: 'nearest' });
  }

  function launchPathKey(projectPath) {
    if (!projectPath) return '';
    const p = String(projectPath).trim();
    if (p === '/home/kay2' || p === '~' || p === '~/') return '';
    if (p.startsWith('/home/kay2/')) return p.slice('/home/kay2/'.length);
    if (p.startsWith('~/')) return p.slice(2);
    return p.replace(/^\//, '');
  }

  async function launch(agentId, projectPath, prompt, opts = {}) {
    const auto = !!opts.auto;
    try {
      const r = await App.apiFetch('/api/agents/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, projectPath }),
      });
      const data = await r.json();
      if (data.reattached || data.sessionId) {
        // Already running — just reattach. (Can't re-flag a live process.)
        App.openTerminalForSession(data.sessionId);
        if (auto) App.toast('Agent already running — reattached', 'info', 2200);
        else if (prompt) typePromptSoon(prompt);
      } else if (data.wsParams) {
        App.showTab('term');
        const p = data.wsParams;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        // Auto mode: open the agent shell as bash, then auto-run the agent with
        // its flags. Lets us pass `--permission-mode auto` without a server change.
        const cmd = auto ? 'bash' : p.cmd;
        const url = `${proto}://${location.host}/ws/term?token=${encodeURIComponent(App.token())}&name=${encodeURIComponent(p.name)}&cmd=${encodeURIComponent(cmd)}&cwd=${encodeURIComponent(p.cwd)}`;
        Term.connectWs(url);
        if (auto) runInShellSoon(autoCommand(p.cmd, prompt));
        else if (prompt) typePromptSoon(prompt);
      }
    } catch (e) { App.toast('Launch failed: ' + e.message, 'error'); }
  }

  // Build `claude --permission-mode auto ["first prompt"]`. The prompt becomes
  // Claude's initial positional arg so it submits immediately.
  function autoCommand(binary, prompt) {
    let cmd = `${binary} --permission-mode auto`;
    if (prompt) cmd += ' ' + shellQuote(prompt);
    return cmd;
  }
  function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

  // Pre-type a first prompt into the agent's TUI once it has had a moment to
  // boot. Never sends a newline — the user reviews it and presses enter.
  function typePromptSoon(text) {
    setTimeout(() => { try { Term.paste(text); } catch {} }, 2000);
  }

  // Auto mode runs a full command line in the freshly-spawned bash shell.
  // Submits it (\r) once bash is ready.
  function runInShellSoon(cmd) {
    setTimeout(() => { try { Term.paste(cmd + '\r'); } catch {} }, 800);
  }

  async function stopAgent(agentId, sessionId) {
    if (!await App.confirm(`Stop ${agentId}? This kills its shell.`, { title: 'Stop agent', okLabel: 'Stop' })) return;
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/term?token=${encodeURIComponent(App.token())}&session=${sessionId}`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'kill' })); ws.close(); };
      await new Promise(r => setTimeout(r, 500));
      load();
    } catch (e) { App.toast('Stop failed: ' + e.message, 'error'); }
  }

  async function launchInProject(agentId, projectPath, _name) {
    try {
      const agents = await App.apiFetch('/api/agents').then(r => r.json());
      const agent = agents.find(a => a.id === agentId);
      if (agent) await promptLaunch(agent, projectPath);
      else await launch(agentId, projectPath);
    } catch {
      await launch(agentId, projectPath);
    }
  }

  // ── Helpers ───────────────────────────────────────

  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Stan / Ollama chat ────────────────────────────

  function openStanChat() {
    const list = document.getElementById('agents-list');
    list.innerHTML = '';
    _stanChatActive = true;
    _stopPolling();

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;';
    wrapper.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:0 0 12px">
        <button class="top-bar-action" id="stan-chat-back">← Back</button>
        <span style="font-size:15px;font-weight:600;flex:1">Stan</span>
        <button class="top-bar-action" id="stan-chat-clear">Clear</button>
      </div>
      <div class="model-bar" id="stan-model-bar"></div>
      <div id="stan-chat-messages" style="flex:1;overflow-y:auto;padding:12px 0;display:flex;flex-direction:column;gap:12px"></div>
      <div id="stan-chat-input-row">
        <textarea id="stan-chat-input" rows="1" placeholder="Ask Stan something…"></textarea>
        <button id="stan-chat-send">Send</button>
      </div>
    `;
    list.appendChild(wrapper);

    wrapper.querySelector('#stan-chat-back').addEventListener('click', () => {
      _stanChatActive = false; _initialized = false; load(); _startPolling();
    });
    wrapper.querySelector('#stan-chat-clear').addEventListener('click', () => {
      _chatMessages = []; saveHistory();
      document.getElementById('stan-chat-messages').innerHTML = '';
    });

    loadModels();
    restoreHistory();
    wrapper.querySelector('#stan-chat-send').addEventListener('click', sendChat);
    wrapper.querySelector('#stan-chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
  }

  let _models = [], _activeModel = null, _chatMessages = [], _chatStreaming = false;

  async function loadModels() {
    try {
      const r = await App.apiFetch('/api/ai/models');
      const data = await r.json();
      _models = (data.models || []).map(m => m.name || m);
      const bar = document.getElementById('stan-model-bar');
      if (!bar) return;
      const saved = localStorage.getItem('stan_ai_model');
      _activeModel = (_models.includes(saved) ? saved : null) || _models[0] || null;
      bar.innerHTML = _models.map(m =>
        `<button class="model-chip ${m === _activeModel ? 'active' : ''}" data-model="${esc(m)}">${esc(m)}</button>`
      ).join('');
      bar.querySelectorAll('.model-chip').forEach(btn => btn.addEventListener('click', () => {
        _activeModel = btn.dataset.model;
        localStorage.setItem('stan_ai_model', _activeModel);
        bar.querySelectorAll('.model-chip').forEach(b => b.classList.toggle('active', b.dataset.model === _activeModel));
      }));
    } catch {}
  }

  function restoreHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem('stan_ai_history') || '[]');
      _chatMessages = saved;
      saved.forEach(m => appendBubble(m.role, m.content, false));
    } catch { _chatMessages = []; }
  }

  async function sendChat() {
    if (_chatStreaming) return;
    const input = document.getElementById('stan-chat-input');
    const text = input?.value.trim();
    if (!text || !_activeModel) return;
    input.value = '';
    _chatMessages.push({ role: 'user', content: text });
    appendBubble('user', text);
    saveHistory();

    const sendBtn = document.getElementById('stan-chat-send');
    if (sendBtn) sendBtn.disabled = true;
    _chatStreaming = true;

    const msgs = document.getElementById('stan-chat-messages');
    const thinking = document.createElement('div');
    thinking.className = 'stan-thinking';
    thinking.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span>Stan is thinking…</span>';
    msgs?.appendChild(thinking);
    if (msgs) msgs.scrollTop = msgs.scrollHeight;

    const bubble = appendBubble('assistant', '');
    let fullContent = '';

    try {
      thinking.remove();
      const r = await App.apiFetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: _activeModel, messages: _chatMessages }),
      });
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            const token = chunk?.message?.content || '';
            fullContent += token;
            renderBubble(bubble, fullContent);
          } catch {}
        }
      }
    } catch (e) {
      thinking.remove();
      renderBubble(bubble, '*Error: ' + e.message + '*');
    }

    if (fullContent) { _chatMessages.push({ role: 'assistant', content: fullContent }); saveHistory(); }
    _chatStreaming = false;
    if (sendBtn) sendBtn.disabled = false;
  }

  function appendBubble(role, content, scroll = true) {
    const msgs = document.getElementById('stan-chat-messages');
    if (!msgs) return document.createElement('div');
    const el = document.createElement('div');
    el.className = 'chat-bubble ' + role;
    renderBubble(el, content);
    msgs.appendChild(el);
    if (scroll) msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function renderBubble(el, content) {
    const html = content
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const isShell = /^(sh|bash|shell|zsh|fish|)$/i.test(lang);
        const acts = `<span class="code-actions">
          <button class="code-btn" onclick="navigator.clipboard.writeText(${JSON.stringify(code)})">Copy</button>
          ${isShell ? `<button class="code-btn" onclick="App.showTab('term');Term.paste(${JSON.stringify(code.trim())})">→ Term</button>` : ''}
        </span>`;
        return `<pre>${acts}<code>${esc(code)}</code></pre>`;
      })
      .replace(/`([^`]+)`/g, `<code style="background:var(--bg-terminal);padding:1px 5px;border-radius:3px;font-family:var(--font-mono);font-size:12px">$1</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    el.innerHTML = html;
    const msgs = document.getElementById('stan-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function saveHistory() {
    try { localStorage.setItem('stan_ai_history', JSON.stringify(_chatMessages.slice(-40))); } catch {}
  }

  return { init, activate, deactivate, launchInProject };
})();
