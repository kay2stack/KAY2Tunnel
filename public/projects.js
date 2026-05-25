// Stan CLI — Projects tab: file browser for the Pi

const Projects = (() => {
  let _initialized = false;
  let _currentPath = '';   // resolved from API on first activate
  let _rootPath = '';
  let _editorOpen = false;

  const PINNED = [
    { label: 'clive',        path: '/home/kay2/clive' },
    { label: 'KAY2Tunnel',   path: '/home/kay2/KAY2Tunnel' },
    { label: 'glint',        path: '/home/kay2/glint' },
  ];

  let _showHidden = false;

  const GIT_CACHE = {}; // path → branch string (cached per session)

  function init() {}

  function activate() {
    if (!_initialized) {
      _initialized = true;
      // Fetch root path from a known file listing to resolve ROOT_DIR
      navigate(null);
    }
    document.getElementById('projects-refresh-btn').addEventListener('click', () => navigate(_currentPath), { once: true });
  }

  // ── Navigation ─────────────────────────────────────
  async function navigate(path) {
    if (!_rootPath) _rootPath = '/home/kay2';
    const target = path || _rootPath;
    _currentPath = target;

    const container = document.getElementById('projects-list');
    container.innerHTML = '<div style="color:var(--color-text-dim);font-size:14px;text-align:center;padding:40px 0">Loading…</div>';
    document.getElementById('projects-refresh-btn').addEventListener('click', () => navigate(_currentPath), { once: true });

    try {
      const r = await App.apiFetch('/api/files/list?path=' + encodeURIComponent(target));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const entries = await r.json();
      renderDir(entries, container);
    } catch (e) {
      container.innerHTML = `<div style="color:var(--color-danger);padding:16px">${esc(e.message)}</div>`;
    }
  }

  function renderDir(entries, container) {
    container.innerHTML = '';

    // ── Breadcrumb ──────────────────────────────────
    const crumb = buildBreadcrumb(_currentPath);
    container.appendChild(crumb);

    // ── Pinned shortcuts (only at root) ─────────────
    if (_currentPath === _rootPath) {
      const pinRow = document.createElement('div');
      pinRow.className = 'pin-row';
      PINNED.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'pin-chip';
        btn.textContent = p.label;
        btn.addEventListener('click', () => navigate(p.path));
        pinRow.appendChild(btn);
      });
      // Hidden toggle chip
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'pin-chip' + (_showHidden ? ' active' : '');
      toggleBtn.style.cssText = 'background:var(--bg-secondary);color:var(--text-dim);border-color:var(--border)';
      toggleBtn.textContent = _showHidden ? '● hidden' : '○ hidden';
      toggleBtn.addEventListener('click', () => { _showHidden = !_showHidden; navigate(_currentPath); });
      pinRow.appendChild(toggleBtn);
      container.appendChild(pinRow);
    }

    // ── Entry list ──────────────────────────────────
    const visible = _showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));
    const dirs  = visible.filter(e => e.type === 'dir');
    const files = visible.filter(e => e.type === 'file');

    if (!dirs.length && !files.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--color-text-dim);font-size:14px;text-align:center;padding:40px 0';
      empty.textContent = 'Empty directory';
      container.appendChild(empty);
      return;
    }

    dirs.forEach(e => container.appendChild(makeDirRow(e)));
    if (dirs.length && files.length) {
      const sep = document.createElement('div');
      sep.className = 'section-label';
      sep.style.marginTop = 'var(--sp-2)';
      sep.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
      container.appendChild(sep);
    }
    files.forEach(e => container.appendChild(makeFileRow(e)));
  }

  // ── Breadcrumb ──────────────────────────────────
  function buildBreadcrumb(path) {
    const wrap = document.createElement('div');
    wrap.className = 'breadcrumb';

    const parts = path ? path.replace(/\/$/, '').split('/').filter(Boolean) : [];
    // Show ~ for home root
    const root = document.createElement('button');
    root.className = 'crumb-btn';
    root.textContent = '~';
    root.addEventListener('click', () => navigate(_rootPath));
    wrap.appendChild(root);

    // Build up path segments relative to root
    // Find where rootPath ends in the full parts array
    const rootParts = (_rootPath || '').replace(/\/$/, '').split('/').filter(Boolean);
    const relParts = parts.slice(rootParts.length);

    relParts.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      wrap.appendChild(sep);

      const btn = document.createElement('button');
      btn.className = 'crumb-btn' + (i === relParts.length - 1 ? ' active' : '');
      btn.textContent = seg;
      if (i < relParts.length - 1) {
        const targetPath = '/' + rootParts.concat(relParts.slice(0, i + 1)).join('/');
        btn.addEventListener('click', () => navigate(targetPath));
      }
      wrap.appendChild(btn);
    });

    return wrap;
  }

  // ── Directory row ────────────────────────────────
  function makeDirRow(entry) {
    const fullPath = joinPath(_currentPath, entry.name);
    const row = document.createElement('div');
    row.className = 'file-row dir-row';

    row.innerHTML = `
      <div class="file-row-icon dir-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
        </svg>
      </div>
      <div class="file-row-info">
        <div class="file-row-name">${esc(entry.name)}</div>
        <div class="file-row-path">${esc(fullPath)}</div>
      </div>
      <button class="file-row-action cd-btn" title="Open in Terminal">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        cd
      </button>
    `;

    row.addEventListener('click', e => {
      if (e.target.closest('.cd-btn')) return;
      navigate(fullPath);
    });

    row.querySelector('.cd-btn').addEventListener('click', e => {
      e.stopPropagation();
      openInTerminal(fullPath);
    });

    // Async: badge git branch if it's a repo
    maybeBadgeGit(row, fullPath);

    return row;
  }

  // ── File row ─────────────────────────────────────
  function makeFileRow(entry) {
    const fullPath = joinPath(_currentPath, entry.name);
    const row = document.createElement('div');
    row.className = 'file-row';

    const ext = entry.name.split('.').pop().toLowerCase();
    const isEditable = ['js','ts','json','md','txt','sh','py','html','css','yaml','yml','env','toml','conf','cfg','log','sql','rs','go','rb','php','c','h','cpp','swift'].includes(ext);

    row.innerHTML = `
      <div class="file-row-icon file-icon-wrap">
        ${fileIconSvg(ext)}
      </div>
      <div class="file-row-info">
        <div class="file-row-name">${esc(entry.name)}</div>
        <div class="file-row-path">${esc(fullPath)} · ${fmtSize(entry.size)}</div>
      </div>
      ${isEditable ? `<button class="file-row-action edit-btn">Edit</button>` : `<a class="file-row-action dl-btn" href="/api/files/download?path=${encodeURIComponent(fullPath)}&token=${encodeURIComponent(App.token())}" download="${esc(entry.name)}">↓</a>`}
    `;

    if (isEditable) {
      row.addEventListener('click', e => {
        if (e.target.closest('.edit-btn')) return;
        openEditor(fullPath, entry.name);
      });
      row.querySelector('.edit-btn').addEventListener('click', e => {
        e.stopPropagation();
        openEditor(fullPath, entry.name);
      });
    }

    return row;
  }

  // ── Git badge ────────────────────────────────────
  async function maybeBadgeGit(row, path) {
    if (path in GIT_CACHE) {
      if (GIT_CACHE[path]) appendGitBadge(row, GIT_CACHE[path]);
      return;
    }
    try {
      const r = await App.apiFetch('/api/projects');
      const projects = await r.json();
      projects.forEach(p => { GIT_CACHE[p.path] = p.git.branch || ''; });
    } catch { return; }
    if (GIT_CACHE[path]) appendGitBadge(row, GIT_CACHE[path]);
  }

  function appendGitBadge(row, branch) {
    const info = row.querySelector('.file-row-info');
    if (!info || info.querySelector('.git-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'git-badge';
    badge.textContent = '⎇ ' + branch;
    info.appendChild(badge);
  }

  // ── Open in terminal ─────────────────────────────
  function openInTerminal(path) {
    App.showTab('term');
    Term.paste('cd ' + JSON.stringify(path) + '\n');
  }

  // ── Editor ───────────────────────────────────────
  async function openEditor(path, name) {
    _editorOpen = true;
    const container = document.getElementById('projects-list');
    container.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:var(--sp-3) var(--sp-4);background:var(--bg-card);border-bottom:1px solid var(--border);flex-shrink:0';
    toolbar.innerHTML = `
      <button class="top-bar-action" id="ed-back">←</button>
      <span style="flex:1;font-size:13px;font-family:var(--font-mono);color:var(--color-accent-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
      <span id="ed-dirty" style="display:none;color:var(--color-warn);font-size:13px">●</span>
      <button class="top-bar-action primary" id="ed-save">Save</button>
    `;
    container.appendChild(toolbar);

    let content = '';
    try {
      const r = await App.apiFetch('/api/files/read?path=' + encodeURIComponent(path));
      content = await r.text();
    } catch (e) { content = '// Error loading: ' + e.message; }

    const ta = document.createElement('textarea');
    ta.value = content;
    ta.spellcheck = false;
    ta.style.cssText = `
      width:100%;flex:1;min-height:calc(100dvh - 200px);
      background:var(--bg-terminal);color:#E8E6F0;
      font-family:var(--font-mono);font-size:13px;line-height:1.5;
      padding:12px;border:none;outline:none;resize:none;box-sizing:border-box;
      caret-color:var(--accent);
    `;
    container.appendChild(ta);

    ta.addEventListener('input', () => { toolbar.querySelector('#ed-dirty').style.display = 'inline'; });
    toolbar.querySelector('#ed-back').addEventListener('click', () => {
      _editorOpen = false;
      _initialized = false;
      activate();
    });
    toolbar.querySelector('#ed-save').addEventListener('click', async () => {
      const btn = toolbar.querySelector('#ed-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await App.apiFetch('/api/files/write', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: ta.value }),
        });
        toolbar.querySelector('#ed-dirty').style.display = 'none';
        btn.textContent = 'Saved';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save'; }, 1200);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save';
        alert('Save failed: ' + e.message);
      }
    });
  }

  // ── Helpers ──────────────────────────────────────
  function joinPath(base, name) {
    return (base || '').replace(/\/$/, '') + '/' + name;
  }

  function fmtSize(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function fileIconSvg(ext) {
    const color = {
      js:'#F5A623', ts:'#3178C6', json:'#9B59B6', md:'#2ECC71',
      sh:'#E74C3C', py:'#3776AB', html:'#E44D26', css:'#264DE4',
      rs:'#CE422B', go:'#00ADD8', rb:'#CC342D',
    }[ext] || 'var(--text-dim)';
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>`;
  }

  return { init, activate };
})();
