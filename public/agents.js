// Stan CLI — Agents tab: Watchtower + agent cards + Stan chat

const Agents = (() => {
  let _initialized = false;
  let _pollInterval = null;
  let _stanChatActive = false;
  let _prevSessionIds = new Set();
  let _prevDirtyRepos = {};

  const ICONS = {
    'claude-code': { letter: 'C', bg: '#D4763B' },
    'codex':       { letter: 'X', bg: '#10A37F' },
    'gemini':      { letter: 'G', bg: '#4285F4' },
    'stan':        { letter: '◉', bg: '#7C5CFF' },
  };

  function init() {}

  function activate() {
    if (_stanChatActive) return;
    if (!_initialized) { _initialized = true; load(); }
    document.getElementById('agents-refresh-btn').addEventListener('click', () => { load(); }, { once: true });
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
      const running = agents.filter(a => a.session);

      // Check for new sessions (agent started) → maybe request notification permission
      const currentIds = new Set(running.map(a => a.session.id));
      _prevSessionIds = currentIds;

      // Refresh tail previews for running agents
      running.forEach(a => {
        const el = document.querySelector(`[data-preview-for="${a.id}"]`);
        const durEl = document.querySelector(`[data-dur-for="${a.id}"]`);
        if (el) loadTail(a.id, el);
        if (durEl && a.session.createdAt) durEl.textContent = fmtDuration(Date.now() - a.session.createdAt);
      });

      // Re-render refresh button listener
      const btn = document.getElementById('agents-refresh-btn');
      if (btn) btn.addEventListener('click', () => { load(); }, { once: true });
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
    document.getElementById('agents-refresh-btn')?.addEventListener('click', () => { load(); }, { once: true });
    try {
      const [sysRes, agentsRes] = await Promise.all([
        App.apiFetch('/api/system').then(r => r.json()).catch(() => null),
        App.apiFetch('/api/agents').then(r => r.json()),
      ]);
      if (sysRes) _updateSysBar(sysRes);
      render(agentsRes, list);
    } catch (e) {
      if (list) list.innerHTML = `<div style="color:var(--red);padding:16px">${esc(e.message)}</div>`;
    }
  }

  function render(agents, container) {
    container.innerHTML = '';

    const running = agents.filter(a => a.session);
    const ready   = agents.filter(a => !a.session && a.installed && a.cmd);
    const other   = agents.filter(a => !a.session && (!a.installed || !a.cmd));

    if (running.length) {
      container.appendChild(sectionLabel('Running'));
      running.forEach(a => container.appendChild(makeCard(a)));
    }
    if (ready.length) {
      container.appendChild(sectionLabel('Available'));
      ready.forEach(a => container.appendChild(makeCard(a)));
    }
    if (other.length) {
      container.appendChild(sectionLabel('Offline / Not installed'));
      other.forEach(a => container.appendChild(makeCard(a)));
    }
  }

  function sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'section-label';
    el.textContent = text;
    return el;
  }

  function makeCard(agent) {
    const icon = ICONS[agent.id] || { letter: '?', bg: '#555' };
    const isRunning = !!agent.session;
    const isStanChat = agent.id === 'stan';

    const card = document.createElement('div');
    card.className = 'agent-card' + (isRunning ? ' running-card' : '');
    card.setAttribute('data-agent-id', agent.id);

    const statusDot = isRunning
      ? `<span class="status-dot connected"></span>`
      : `<span class="status-dot ${agent.installed ? 'reconnecting' : 'offline'}"></span>`;
    const statusText = isRunning ? 'Running' : (agent.installed ? 'Ready' : 'Not installed');

    // Second line: duration + repo for running agents
    let metaLine = esc(agent.provider);
    let durSpan = '';
    if (isRunning && agent.session) {
      const repo = agent.session.cwd ? agent.session.cwd.split('/').pop() : '';
      const dur = agent.session.createdAt ? fmtDuration(Date.now() - agent.session.createdAt) : '';
      metaLine = (repo ? esc(repo) + ' · ' : '') + esc(agent.provider);
      durSpan = `<span class="agent-dur" data-dur-for="${esc(agent.id)}">${esc(dur)}</span>`;
    }

    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-icon" style="background:${icon.bg}">${icon.letter}</div>
        <div class="agent-info">
          <div class="agent-name">${esc(agent.name)}</div>
          <div class="agent-meta">${metaLine}</div>
        </div>
        <div class="agent-status ${isRunning ? 'running' : (agent.installed ? 'ready' : 'offline')}">
          ${statusDot} ${statusText}${durSpan}
        </div>
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'agent-actions';

    if (isStanChat) {
      const chatBtn = document.createElement('button');
      chatBtn.className = 'agent-btn primary'; chatBtn.textContent = 'Chat';
      chatBtn.addEventListener('click', () => openStanChat());
      actions.appendChild(chatBtn);
    } else if (isRunning) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'agent-btn primary'; viewBtn.textContent = '→ Terminal';
      viewBtn.addEventListener('click', () => App.openTerminalForSession(agent.session.id));
      const stopBtn = document.createElement('button');
      stopBtn.className = 'agent-btn danger'; stopBtn.textContent = 'Stop';
      stopBtn.addEventListener('click', () => stopAgent(agent.id, agent.session.id));
      actions.appendChild(viewBtn); actions.appendChild(stopBtn);
    } else if (agent.installed && agent.cmd) {
      const launchBtn = document.createElement('button');
      launchBtn.className = 'agent-btn primary'; launchBtn.textContent = 'Launch';
      launchBtn.addEventListener('click', () => promptLaunch(agent));
      actions.appendChild(launchBtn);
    } else {
      const hint = document.createElement('span');
      hint.style.cssText = 'font-size:12px;color:var(--text-dim);padding:0 0 4px';
      hint.textContent = agent.cmd ? `Install: npm i -g ${agent.cmd}` : 'No CLI available';
      actions.appendChild(hint);
    }

    card.appendChild(actions);

    // Live output preview
    if (isRunning) {
      const preview = document.createElement('div');
      preview.className = 'agent-output';
      preview.setAttribute('data-preview-for', agent.id);
      preview.textContent = 'Loading output…';
      card.appendChild(preview);
      loadTail(agent.id, preview);
    }

    return card;
  }

  async function loadTail(agentId, el) {
    try {
      const r = await App.apiFetch(`/api/agents/${agentId}/tail`);
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

  async function promptLaunch(agent) {
    try {
      const r = await App.apiFetch('/api/projects');
      const projects = await r.json();
      showLaunchSheet(agent, projects);
    } catch {
      await launch(agent.id, null);
    }
  }

  function showLaunchSheet(agent, projects) {
    const existing = document.getElementById('launch-sheet');
    if (existing) existing.remove();

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
            <div style="font-size:13px;color:var(--text-dim)">Select a project directory</div>
          </div>
          <button class="top-bar-action" style="margin-left:auto" id="launch-cancel">Cancel</button>
        </div>
        <div id="launch-project-list">
          <button class="project-btn terminal" style="width:100%;margin-bottom:8px;flex:unset;justify-content:flex-start;padding:12px"
            data-launch-path="">~/  (home directory)</button>
          ${projects.map(p => `
            <button class="project-btn terminal" style="width:100%;margin-bottom:8px;flex:unset;justify-content:flex-start;padding:12px"
              data-launch-path="${esc(p.path)}">
              <span style="font-weight:600">${esc(p.name)}</span>
              <span style="color:var(--text-dim);margin-left:8px;font-size:12px">${p.git.branch ? '⎇ ' + esc(p.git.branch) : ''}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    sheet.querySelector('#launch-cancel').addEventListener('click', () => sheet.remove());
    sheet.querySelectorAll('[data-launch-path]').forEach(btn => {
      btn.addEventListener('click', async () => {
        sheet.remove();
        await launch(agent.id, btn.dataset.launchPath || null);
      });
    });
    document.body.appendChild(sheet);
  }

  async function launch(agentId, projectPath) {
    try {
      const r = await App.apiFetch('/api/agents/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, projectPath }),
      });
      const data = await r.json();
      if (data.reattached || data.sessionId) {
        App.openTerminalForSession(data.sessionId);
      } else if (data.wsParams) {
        App.showTab('term');
        const p = data.wsParams;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${location.host}/ws/term?token=${encodeURIComponent(App.token())}&name=${encodeURIComponent(p.name)}&cmd=${encodeURIComponent(p.cmd)}&cwd=${encodeURIComponent(p.cwd)}`;
        Term.connectWs(url);
      }
    } catch (e) { alert('Launch failed: ' + e.message); }
  }

  async function stopAgent(agentId, sessionId) {
    if (!confirm(`Stop ${agentId}?`)) return;
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/term?token=${encodeURIComponent(App.token())}&session=${sessionId}`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'kill' })); ws.close(); };
      await new Promise(r => setTimeout(r, 500));
      load();
    } catch (e) { alert('Stop failed: ' + e.message); }
  }

  async function launchInProject(agentId, projectPath, _name) {
    await load();
    await launch(agentId, projectPath);
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
        <button class="top-bar-action" id="stan-chat-back">← Agents</button>
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
