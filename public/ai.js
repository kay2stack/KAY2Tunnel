// AI chat panel — Ollama proxy, streaming, send-to-terminal

const AI = (() => {
  let _initialized = false;
  let _messages = [];
  let _streaming = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    const panel = document.getElementById('ai-panel');
    panel.innerHTML = `
      <div id="ai-toolbar">
        <select id="ai-model-select"><option value="">Loading models…</option></select>
        <button class="files-action-btn" id="ai-new-chat">New chat</button>
      </div>
      <div id="ai-messages"></div>
      <div id="ai-input-row">
        <textarea id="ai-input" rows="1" placeholder="Ask something…"></textarea>
        <button id="ai-send">Send</button>
      </div>
    `;

    document.getElementById('ai-send').addEventListener('click', sendMessage);
    document.getElementById('ai-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('ai-new-chat').addEventListener('click', newChat);

    loadModels();
    restoreHistory();
  }

  function activate() {
    if (!_initialized) init();
  }

  async function loadModels() {
    try {
      const r = await App.apiFetch('/api/ai/models');
      const data = await r.json();
      const select = document.getElementById('ai-model-select');
      const models = (data.models || []).map((m) => m.name || m);
      if (!models.length) { select.innerHTML = '<option value="">No models found</option>'; return; }
      select.innerHTML = models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      const saved = localStorage.getItem('stan_ai_model');
      if (saved && models.includes(saved)) select.value = saved;
      select.addEventListener('change', () => localStorage.setItem('stan_ai_model', select.value));
    } catch {
      const select = document.getElementById('ai-model-select');
      if (select) select.innerHTML = '<option value="">Ollama unavailable</option>';
    }
  }

  function restoreHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem('stan_ai_history') || '[]');
      _messages = saved;
      saved.forEach((m) => appendBubble(m.role, m.content, false));
    } catch { _messages = []; }
  }

  function newChat() {
    _messages = [];
    localStorage.removeItem('stan_ai_history');
    document.getElementById('ai-messages').innerHTML = '';
  }

  async function sendMessage() {
    if (_streaming) return;
    const input = document.getElementById('ai-input');
    const text = input.value.trim();
    if (!text) return;
    const model = document.getElementById('ai-model-select').value;
    if (!model) { alert('Select a model first'); return; }

    input.value = '';
    _messages.push({ role: 'user', content: text });
    appendBubble('user', text);
    saveHistory();

    const sendBtn = document.getElementById('ai-send');
    sendBtn.disabled = true;
    _streaming = true;

    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'stan-thinking';
    thinkingEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span>Stan is thinking…</span>';
    document.getElementById('ai-messages').appendChild(thinkingEl);
    document.getElementById('ai-messages').scrollTop = 9999;

    const bubble = appendBubble('assistant', '');
    let fullContent = '';

    try {
      thinkingEl.remove();
      const r = await App.apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: _messages }),
      });

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            const token = chunk?.message?.content || '';
            fullContent += token;
            renderBubbleContent(bubble, fullContent);
          } catch {}
        }
      }
    } catch (e) {
      thinkingEl.remove();
      renderBubbleContent(bubble, '*Error: ' + e.message + '*');
      fullContent = '';
    }

    if (fullContent) {
      _messages.push({ role: 'assistant', content: fullContent });
      saveHistory();
    }

    _streaming = false;
    sendBtn.disabled = false;
  }

  function appendBubble(role, content, scroll = true) {
    const msgs = document.getElementById('ai-messages');
    const el = document.createElement('div');
    el.className = 'ai-bubble ' + role;
    renderBubbleContent(el, content);
    msgs.appendChild(el);
    if (scroll) msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function renderBubbleContent(el, content) {
    // Simple markdown: code blocks, then basic inline
    const html = content
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const isShell = /^(sh|bash|shell|zsh|fish)$/i.test(lang) || !lang;
        const actions = `<span class="code-actions">
          <button class="code-btn" onclick="navigator.clipboard.writeText(${jsonStr(code)})">Copy</button>
          ${isShell ? `<button class="code-btn" onclick="App.showTab('term');Term.paste(${jsonStr(code.trim())})">→ Term</button>` : ''}
        </span>`;
        return `<pre>${actions}<code>${esc(code)}</code></pre>`;
      })
      .replace(/`([^`]+)`/g, '<code style="background:#0a1a24;padding:1px 5px;border-radius:3px;font-family:\'JetBrains Mono\',monospace;font-size:12px">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    el.innerHTML = html;
    const msgs = document.getElementById('ai-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function saveHistory() {
    try { localStorage.setItem('stan_ai_history', JSON.stringify(_messages.slice(-40))); } catch {}
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function jsonStr(s) { return JSON.stringify(s); }

  return { init, activate };
})();
