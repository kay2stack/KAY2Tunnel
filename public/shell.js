// Stan CLI — app-shell UX: floating multitask dock, command palette (⌘K),
// and swipe-between-tabs. Pure client; talks only to existing APIs.
const Shell = (() => {
  // Primary bottom-bar order (what swipe cycles through)
  const TABS = [
    { id: 'home', label: 'Home' }, { id: 'agents', label: 'Agents' },
    { id: 'term', label: 'Terminal' }, { id: 'projects', label: 'Projects' },
    { id: 'screen', label: 'Pi Desktop' }, { id: 'more', label: 'More' },
  ];
  // Reachable-but-not-on-the-bar destinations (palette + dock can jump to these)
  const EXTRA = [
    { id: 'phone', label: 'Android Phone' }, { id: 'ops', label: 'Automation' },
    { id: 'pi', label: 'Pi Control' }, { id: 'browser', label: 'Browser' },
  ];
  // Tabs where horizontal touch belongs to the content, not navigation
  const SWIPE_BLOCK = new Set(['term', 'screen', 'phone']);

  function currentTab() {
    const p = document.querySelector('.tab-panel:not(.hidden)');
    return p ? p.id.replace(/^tab-/, '') : 'home';
  }
  function anyOverlayOpen() {
    return !!document.querySelector('#cmd-palette, #launch-sheet, .term-sheet, .app-dialog-overlay, #dock-panel.open');
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Live shells (plain + agents) from one source of truth.
  async function fetchSessions() {
    try {
      const list = await App.apiFetch('/api/term/sessions').then(r => r.json());
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  function sessionLabel(s) {
    if (s.label) return s.label;
    if (s.name && s.name.startsWith('agent:')) {
      const m = s.name.slice(6).split('@');
      return m[0] + (m[1] && m[1] !== '~' ? ' · ' + m[1].split('/').pop() : '');
    }
    const dir = s.cwd ? s.cwd.split('/').pop() : '';
    return 'shell' + (dir ? ' · ' + dir : '');
  }
  function sessionIcon(s) {
    if (s.name && s.name.startsWith('agent:')) {
      const id = s.name.slice(6).split('@')[0];
      const ic = (App.AGENT_ICONS || {})[id];
      if (ic) return ic;
    }
    return { letter: '›', bg: '#3a3f4a' };
  }

  // ── 1. Floating multitask dock (FAB) ──────────────────
  function buildDock() {
    if (document.getElementById('dock-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'dock-fab';
    fab.setAttribute('aria-label', 'Multitask');
    fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg><span id="dock-badge" class="dock-badge hidden">0</span>`;
    const panel = document.createElement('div');
    panel.id = 'dock-panel';
    document.body.appendChild(panel);
    document.body.appendChild(fab);

    fab.addEventListener('click', toggleDock);
    document.addEventListener('click', e => {
      if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== fab && !fab.contains(e.target))
        closeDock();
    });
    refreshBadge();
    setInterval(refreshBadge, 15000);
  }
  let _dockOpen = false;
  async function toggleDock() { _dockOpen ? closeDock() : openDock(); }
  function closeDock() { _dockOpen = false; document.getElementById('dock-panel')?.classList.remove('open'); document.getElementById('dock-fab')?.classList.remove('active'); }
  async function openDock() {
    const panel = document.getElementById('dock-panel');
    if (!panel) return;
    _dockOpen = true;
    document.getElementById('dock-fab')?.classList.add('active');
    panel.classList.add('open');
    panel.innerHTML = `<div class="dock-actions">
        <button class="dock-act" data-act="term">＋ Terminal</button>
        <button class="dock-act" data-act="agents">⌬ Agent</button>
        <button class="dock-act" data-act="phone">▢ Phone</button>
        <button class="dock-act" data-act="palette">⌘K</button>
      </div>
      <div class="dock-running" id="dock-running"><div class="dock-empty">Loading…</div></div>`;
    panel.querySelector('[data-act="term"]').onclick = () => { closeDock(); Term.newSession(); App.showTab('term'); };
    panel.querySelector('[data-act="agents"]').onclick = () => { closeDock(); App.showTab('agents'); };
    panel.querySelector('[data-act="phone"]').onclick = () => { closeDock(); App.showTab('phone'); };
    panel.querySelector('[data-act="palette"]').onclick = () => { closeDock(); openPalette(); };

    const sessions = await fetchSessions();
    const box = document.getElementById('dock-running');
    if (!box) return;
    if (!sessions.length) { box.innerHTML = `<div class="dock-empty">No running sessions. Start one above.</div>`; return; }
    box.innerHTML = `<div class="dock-running-label">Running · ${sessions.length}</div>`;
    sessions.forEach(s => {
      const ic = sessionIcon(s);
      const row = document.createElement('button');
      row.className = 'dock-session';
      row.innerHTML = `<span class="dock-ic" style="background:${ic.bg}">${ic.letter}</span><span class="dock-sname">${esc(sessionLabel(s))}</span>`;
      row.onclick = () => { closeDock(); App.openTerminalForSession(s.id); };
      box.appendChild(row);
    });
  }
  async function refreshBadge() {
    const badge = document.getElementById('dock-badge');
    if (!badge) return;
    const n = (await fetchSessions()).length;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
  }

  // ── 2. Command palette (⌘K) ───────────────────────────
  let _palItems = [], _palIdx = 0;
  function staticItems() {
    const items = [];
    TABS.concat(EXTRA).forEach(t => items.push({ label: t.label, hint: 'Tab', kw: t.id, run: () => App.showTab(t.id) }));
    items.push({ label: 'New Terminal', hint: 'Action', kw: 'new shell', run: () => { Term.newSession(); App.showTab('term'); } });
    items.push({ label: 'Launch Agent', hint: 'Action', kw: 'claude codex', run: () => App.showTab('agents') });
    return items;
  }
  async function openPalette() {
    if (document.getElementById('cmd-palette')) return;
    const ov = document.createElement('div');
    ov.id = 'cmd-palette';
    ov.innerHTML = `<div class="cmd-box">
        <input id="cmd-input" placeholder="Jump to a tab, session, or action…" autocomplete="off" spellcheck="false"/>
        <div id="cmd-results"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closePalette(); });

    const sessions = await fetchSessions();
    const sessItems = sessions.map(s => ({
      label: sessionLabel(s), hint: 'Session', kw: (s.name || '') + ' ' + (s.cwd || ''),
      run: () => App.openTerminalForSession(s.id),
    }));
    _palItems = staticItems().concat(sessItems);

    const input = document.getElementById('cmd-input');
    input.addEventListener('input', () => renderPalette(input.value));
    input.addEventListener('keydown', onPaletteKey);
    renderPalette('');
    setTimeout(() => input.focus(), 30);
  }
  function closePalette() { document.getElementById('cmd-palette')?.remove(); }
  function filterItems(q) {
    q = q.trim().toLowerCase();
    if (!q) return _palItems;
    return _palItems.filter(i => (i.label + ' ' + (i.kw || '') + ' ' + i.hint).toLowerCase().includes(q));
  }
  function renderPalette(q) {
    const box = document.getElementById('cmd-results');
    if (!box) return;
    const items = filterItems(q);
    _palIdx = Math.min(_palIdx, Math.max(0, items.length - 1));
    box.innerHTML = items.length ? '' : `<div class="cmd-empty">No matches</div>`;
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'cmd-row' + (i === _palIdx ? ' active' : '');
      row.innerHTML = `<span class="cmd-label">${esc(it.label)}</span><span class="cmd-hint">${esc(it.hint)}</span>`;
      row.onclick = () => { closePalette(); it.run(); };
      box.appendChild(row);
    });
    box._items = items;
  }
  function onPaletteKey(e) {
    const box = document.getElementById('cmd-results');
    const items = (box && box._items) || [];
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); _palIdx = Math.min(_palIdx + 1, items.length - 1); renderActiveOnly(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _palIdx = Math.max(_palIdx - 1, 0); renderActiveOnly(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[_palIdx]; if (it) { closePalette(); it.run(); } }
  }
  function renderActiveOnly() {
    const rows = document.querySelectorAll('#cmd-results .cmd-row');
    rows.forEach((r, i) => r.classList.toggle('active', i === _palIdx));
    rows[_palIdx]?.scrollIntoView({ block: 'nearest' });
  }

  // ── 3. Swipe between tabs ──────────────────────────────
  let _sx = 0, _sy = 0, _st = 0, _track = false;
  function onTouchStart(e) {
    if (e.touches.length !== 1 || anyOverlayOpen()) { _track = false; return; }
    const t = e.target;
    if (t.closest('#dock-fab, #dock-panel, #tab-bar')) { _track = false; return; }
    if (SWIPE_BLOCK.has(currentTab()) && t.closest('#tab-term, #tab-screen, #tab-phone')) { _track = false; return; }
    if (t.closest('.cm-editor, .agent-output, [data-no-swipe]')) { _track = false; return; }
    _sx = e.touches[0].clientX; _sy = e.touches[0].clientY; _st = Date.now(); _track = true;
  }
  function onTouchEnd(e) {
    if (!_track) return; _track = false;
    const dx = e.changedTouches[0].clientX - _sx;
    const dy = e.changedTouches[0].clientY - _sy;
    if (Date.now() - _st > 600) return;                 // too slow = not a swipe
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.6) return;  // must be decisively horizontal
    let idx = TABS.findIndex(t => t.id === currentTab());
    if (idx < 0) idx = TABS.length - 1;                 // on an extra tab → behave like 'more'
    const next = dx < 0 ? idx + 1 : idx - 1;
    if (next < 0 || next >= TABS.length) return;
    App.showTab(TABS[next].id);
    showPager(next);
  }
  function showPager(idx) {
    let p = document.getElementById('swipe-pager');
    if (!p) { p = document.createElement('div'); p.id = 'swipe-pager'; document.body.appendChild(p); }
    p.innerHTML = TABS.map((_, i) => `<span class="${i === idx ? 'on' : ''}"></span>`).join('');
    p.classList.add('show');
    clearTimeout(p._t); p._t = setTimeout(() => p.classList.remove('show'), 900);
  }

  function init() {
    buildDock();
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); document.getElementById('cmd-palette') ? closePalette() : openPalette(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { openPalette, openDock, refreshBadge };
})();
