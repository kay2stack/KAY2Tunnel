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
    if (_activeTab === 'agents'  && typeof Agents  !== 'undefined' && name !== 'agents')  Agents.deactivate?.();
    if (_activeTab === 'pi'      && typeof Pi       !== 'undefined' && name !== 'pi')      Pi.deactivate?.();
    if (_activeTab === 'browser' && typeof Browser  !== 'undefined' && name !== 'browser') Browser.deactivate?.();
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('tab-' + name);
    if (!panel) return;
    panel.classList.remove('hidden');
    const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (btn) btn.classList.add('active');
    _activeTab = name;
    if (name === 'term')     { Term.init(); Term.focus(); }
    if (name === 'projects') Projects.activate();
    if (name === 'agents')   Agents.activate();
    if (name === 'pi')       Pi?.activate();
    if (name === 'browser')  Browser?.activate();
    if (name === 'home')     loadHomeStats();
    if (name === 'settings') loadSettings();
  }

  function openTerminalForSession(sessionId) {
    showTab('term');
    Term.attachSession(sessionId);
  }

  async function loadHomeStats() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const greetEl = document.getElementById('home-greeting');
    if (greetEl) greetEl.textContent = `${greeting}, Kane`;

    try {
      const r = await apiFetch('/api/term/sessions');
      const sessions = await r.json();
      const countEl = document.getElementById('home-session-count');
      if (countEl) countEl.textContent = sessions.length;
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

    document.getElementById('auth-eye-btn')?.addEventListener('click', () => {
      const input = document.getElementById('token-input');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('settings-logout-row')?.addEventListener('click', logout);

    document.getElementById('qa-terminal')?.addEventListener('click', () => showTab('term'));
    document.getElementById('qa-projects')?.addEventListener('click', () => showTab('projects'));
    document.getElementById('qa-agents')?.addEventListener('click', () => showTab('agents'));
    document.getElementById('qa-settings')?.addEventListener('click', () => showTab('settings'));

    const saved = localStorage.getItem('stan_token');
    if (saved) { _token = saved; launch(); }
    // else: auth-screen is already visible (no hidden class in HTML)

    document.getElementById('token-submit').addEventListener('click', tryAuth);
    document.getElementById('token-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') tryAuth();
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            // New SW activated + took control → reload to get fresh JS/CSS
            if (nw.state === 'activated' && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });
      }).catch(() => {});
    }
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

  document.addEventListener('DOMContentLoaded', init);

  return { token, apiFetch, showTab, logout, openTerminalForSession };
})();
