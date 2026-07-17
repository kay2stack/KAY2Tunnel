// Stan CLI — app bootstrap, auth, tab routing, VPS failover

const App = (() => {
  let _token = null;
  let _activeTab = 'home';
  let _homePollTimer = null;
  const HOSTS_KEY = 'stan_hosts';

  function token() { return _token; }

  function getHosts() {
    try { return JSON.parse(localStorage.getItem(HOSTS_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveHosts(h) {
    localStorage.setItem(HOSTS_KEY, JSON.stringify(h));
  }

  function normalizeHostUrl(u) {
    if (!u) return '';
    u = u.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  async function probeHost(baseUrl, t) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${baseUrl}/api/health/summary`, {
        headers: { Authorization: 'Bearer ' + t },
        signal: ctrl.signal,
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** If current origin is down, redirect to fallback VPS (or back to primary). */
  async function ensureReachableHost(t) {
    const hosts = getHosts();
    const here = location.origin;
    if (!hosts.primary) {
      hosts.primary = here;
      saveHosts(hosts);
    }
    const primary = normalizeHostUrl(hosts.primary);
    const fallback = normalizeHostUrl(hosts.fallback);

    if (await probeHost(here, t)) return true;

    if (fallback && fallback !== here && await probeHost(fallback, t)) {
      window.location.replace(fallback + '/');
      return false;
    }
    if (primary && primary !== here && await probeHost(primary, t)) {
      window.location.replace(primary + '/');
      return false;
    }
    return true;
  }

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
    if (_activeTab === 'agents' && window.Agents && name !== 'agents') Agents.deactivate?.();
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name).classList.remove('hidden');
    const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (btn) btn.classList.add('active');
    _activeTab = name;
    if (name === 'term' && window.Term) { Term.init(); Term.focus(); }
    if (name === 'projects' && window.Projects) Projects.activate();
    if (name === 'agents'   && window.Agents)   Agents.activate();
    if (name === 'home') {
      loadHomeStats();
      if (_homePollTimer) clearInterval(_homePollTimer);
      _homePollTimer = setInterval(() => {
        if (_activeTab === 'home' && window.Health) Health.pollHome();
      }, 45000);
    } else if (_homePollTimer) {
      clearInterval(_homePollTimer);
      _homePollTimer = null;
    }
    if (name === 'settings') loadSettings();
  }

  function openTerminalForSession(sessionId) {
    showTab('term');
    Term.attachSession(sessionId);
  }

  async function loadHostIdentity() {
    try {
      const r = await apiFetch('/api/host');
      const h = await r.json();
      const sub = document.getElementById('home-subgreeting');
      if (sub && h.role === 'vps') {
        sub.textContent = 'VPS fallback · agents online';
        sub.classList.add('status-warn');
      }
      const roleEl = document.getElementById('settings-host-role');
      if (roleEl) {
        roleEl.textContent = h.role === 'vps' ? 'VPS fallback' : 'Pi primary';
      }
      return h;
    } catch {
      return null;
    }
  }

  async function loadHomeStats() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const greetEl = document.getElementById('home-greeting');
    if (greetEl) greetEl.textContent = `${greeting}, Kane`;

    await loadHostIdentity();

    try {
      const r = await apiFetch('/api/term/sessions');
      const sessions = await r.json();
      const countEl = document.getElementById('home-session-count');
      if (countEl) countEl.textContent = sessions.length;
    } catch {}

    if (window.Health) Health.pollHome();
  }

  function configureFailoverHost() {
    const hosts = getHosts();
    const current = hosts.fallback || '';
    const next = prompt(
      'Fallback VPS URL (Tailscale HTTPS)\ne.g. https://stan-vps.yourtailnet.ts.net\n\nLeave empty to clear.',
      current
    );
    if (next === null) return;
    if (next.trim()) hosts.fallback = normalizeHostUrl(next);
    else delete hosts.fallback;
    if (!hosts.primary) hosts.primary = location.origin;
    saveHosts(hosts);
    loadSettings();
  }

  function loadSettings() {
    const hostEl = document.getElementById('settings-host');
    if (hostEl) hostEl.textContent = location.hostname;

    const tokenEl = document.getElementById('settings-token-preview');
    if (tokenEl && _token) tokenEl.textContent = _token.slice(0, 8) + '…';

    const hosts = getHosts();
    const fbEl = document.getElementById('settings-failover-preview');
    if (fbEl) {
      fbEl.textContent = hosts.fallback
        ? new URL(hosts.fallback).hostname
        : 'Not set';
    }
    loadHostIdentity();
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
    document.getElementById('settings-health-row')?.addEventListener('click', () => {
      if (window.Health) Health.open();
    });
    document.getElementById('settings-failover-row')?.addEventListener('click', configureFailoverHost);

    document.getElementById('qa-terminal')?.addEventListener('click', () => showTab('term'));
    document.getElementById('qa-projects')?.addEventListener('click', () => showTab('projects'));
    document.getElementById('qa-agents')?.addEventListener('click', () => showTab('agents'));
    document.getElementById('qa-settings')?.addEventListener('click', () => showTab('settings'));

    if (window.Health) Health.init();
    if (window.Gpu) Gpu.init();

    const saved = localStorage.getItem('stan_token');
    if (saved) {
      _token = saved;
      ensureReachableHost(saved).then(ok => { if (ok) launch(); });
    } else {
      document.getElementById('auth-screen').classList.remove('hidden');
    }

    document.getElementById('token-submit').addEventListener('click', tryAuth);
    document.getElementById('token-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') tryAuth();
    });

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  async function tryAuth() {
    const input = document.getElementById('token-input');
    const err = document.getElementById('auth-error');
    const t = input.value.trim();
    if (!t) return;
    err.classList.add('hidden');
    err.textContent = 'Invalid token — check and try again';
    try {
      if (!(await ensureReachableHost(t))) return;
      const r = await fetch('/api/term/sessions', { headers: { 'Authorization': 'Bearer ' + t } });
      if (r.status === 401) { err.classList.remove('hidden'); return; }
      _token = t;
      localStorage.setItem('stan_token', t);
      launch();
    } catch {
      err.textContent = 'Cannot reach server — check failover host in Settings';
      err.classList.remove('hidden');
    }
  }

  function launch() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadHomeStats();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { token, apiFetch, showTab, logout, openTerminalForSession, getHosts, saveHosts };
})();
