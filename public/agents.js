// Stan CLI — Agents tab: agent cards + PTY sessions + Ollama/Stan chat

const Agents = (() => {
  let _initialized = false;
  let _refreshInterval = null;
  let _stanChatActive = false;

  const ICONS = {
    'claude-code': { letter: 'C', bg: '#D4763B' },
    'codex':       { letter: 'X', bg: '#10A37F' },
    'gemini':      { letter: 'G', bg: '#4285F4' },
    'stan':        { letter: '◉', bg: '#7C5CFF' },
    'openclaw':    { letter: '⛊', bg: '#FF6B35' },
  };

  function init() {}

  function activate() {
    if (!_initialized) { _initialized = true; load(); }
    document.getElementById('agents-refresh-btn').addEventListener('click', load, { once: true });
    if (_refreshInterval) clearInterval(_refreshInterval);
    _refreshInterval = setInterval(refreshRunning, 6000);
  }

  function deactivate() {
    if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
  }

  async function load() {
    const list = document.getElementById('agents-list');
    list.innerHTML = '<div style="color:var(--color-text-dim);font-size:14px;text-align:center;padding:40px 0">Loading agents…</div>';
    document.getElementById('agents-refresh-btn').addEventListener('click', load, { once: true });
    try {
      const r = await App.apiFetch('/api/agents');
      const agents = await r.json();
      render(agents, list);
    } catch (e) {
      list.innerHTML = `<div style="color:var(--color-danger);padding:16px">${e.message}</div>`;
    }
  }

  function render(agents, container) {
    container.innerHTML = '';

    // Running agents first
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
    card.className = 'agent-card';
    card.setAttribute('data-agent-id', agent.id);

    const statusClass = isRunning ? 'running' : (agent.installed ? 'ready' : 'offline');
    const statusText  = isRunning ? 'Running' : (agent.installed ? 'Ready' : 'Not installed');
    const statusDot   = isRunning ? `<span class="status-dot connected"></span>` : `<span class="status-dot ${agent.installed ? 'reconnecting' : 'offline'}"></span>`;

    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-icon" style="background:${icon.bg}">${icon.letter}</div>
        <div class="agent-info">
          <div class="agent-name">${esc(agent.name)}</div>
          <div class="agent-meta">${esc(agent.provider)}</div>
        </div>
        <div class="agent-status ${statusClass}">${statusDot} ${statusText}</div>
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
      hint.style.cssText = 'font-size:12px;color:var(--color-text-dim);padding:0 0 4px';
      hint.textContent = agent.cmd ? `Install: npm i -g ${agent.cmd}` : '';
      actions.appendChild(hint);
    }

    card.appendChild(actions);

    // Live output preview for running agents
    if (isRunning && agent.cmd) {
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
      // Strip ANSI escape codes for clean preview
      el.textContent = tail.replace(/\x1b\[[0-9;]*[mGKH]/g, '').slice(-800) || '(no output yet)';
      el.scrollTop = el.scrollHeight;
    } catch { el.textContent = '(unavailable)'; }
  }

  async function refreshRunning() {
    try {
      const r = await App.apiFetch('/api/agents');
      const agents = await r.json();
      agents.filter(a => a.session && a.cmd).forEach(a => {
        const el = document.querySelector(`[data-preview-for="${a.id}"]`);
        if (el) loadTail(a.id, el);
      });
    } catch {}
  }

  async function promptLaunch(agent) {
    // Fetch projects for selection
    try {
      const r = await App.apiFetch('/api/projects');
      const projects = await r.json();
      showLaunchSheet(agent, projects);
    } catch {
      // fallback: launch in ROOT_DIR
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
      <div style="background:var(--color-surface);border-radius:var(--r-xl) var(--r-xl) 0 0;
        border:1px solid var(--color-border);width:100%;max-width:600px;padding:var(--sp-6);max-height:75vh;overflow-y:auto">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:var(--sp-5)">
          <div class="agent-icon" style="background:${icon.bg};width:36px;height:36px;font-size:15px">${icon.letter}</div>
          <div>
            <div style="font-size:16px;font-weight:600">Launch ${esc(agent.name)}</div>
            <div style="font-size:13px;color:var(--color-text-dim)">Select a project directory</div>
          </div>
          <button class="top-bar-action" style="margin-left:auto" id="launch-cancel">Cancel</button>
        </div>
        <div id="launch-project-list">
          <button class="project-btn terminal" style="width:100%;margin-bottom:8px;flex:unset;justify-content:flex-start;padding:12px"
            data-launch-path="">
            ~/  (home directory)
          </button>
          ${projects.map(p => `
            <button class="project-btn terminal" style="width:100%;margin-bottom:8px;flex:unset;justify-content:flex-start;padding:12px"
              data-launch-path="${esc(p.path)}">
              <span style="font-weight:600">${esc(p.name)}</span>
              <span style="color:var(--color-text-dim);margin-left:8px;font-size:12px">${p.git.branch ? '⎇ ' + esc(p.git.branch) : ''}</span>
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
        // Open agent in terminal tab via named session
        App.showTab('term');
        const p = data.wsParams;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const token = App.token();
        const url = `${proto}://${location.host}/ws/term?token=${encodeURIComponent(token)}&name=${encodeURIComponent(p.name)}&cmd=${encodeURIComponent(p.cmd)}&cwd=${encodeURIComponent(p.cwd)}`;
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

  async function launchInProject(agentId, projectPath, _projectName) {
    await load();
    await launch(agentId, projectPath);
  }

  // ── Stan / Ollama chat ─────────────────────────────
  function openStanChat() {
    const list = document.getElementById('agents-list');
    list.innerHTML = '';
    _stanChatActive = true;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;';
    wrapper.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:0 0 12px">
        <button class="top-bar-action" id="stan-chat-back">← Agents</button>
        <span style="font-size:15px;font-weight:600;flex:1">Stan</span>
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
      _stanChatActive = false; _initialized = false; load();
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
      bar.innerHTML = _models.map(m => `
        <button class="model-chip ${m === _activeModel ? 'active' : ''}" data-model="${esc(m)}">${esc(m)}</button>
      `).join('');
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
    msgs && (msgs.scrollTop = msgs.scrollHeight);

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
      .replace(/`([^`]+)`/g, `<code style="background:var(--color-terminal-bg);padding:1px 5px;border-radius:3px;font-family:var(--font-mono);font-size:12px">$1</code>`)
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

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, activate, deactivate, launchInProject };
})();
