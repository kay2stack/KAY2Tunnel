// Stan CLI — Projects tab: file browser for the Pi

const Projects = (() => {
  let _initialized = false;
  let _currentPath = '';   // resolved from API on first activate
  let _rootPath = '';
  let _editorOpen = false;
  let _editorFileName = '';

  const PINNED = [
    { label: 'clive',        path: '/home/kay2/clive' },
    { label: 'KAY2Tunnel',   path: '/home/kay2/KAY2Tunnel' },
    { label: 'glint',        path: '/home/kay2/glint' },
  ];

  let _showHidden = false;

  const GIT_CACHE = {}; // path → { branch, dirty } (cached per session)

  function init() {}

  function activate() {
    if (!_initialized) {
      _initialized = true;
      // Fetch root path from a known file listing to resolve ROOT_DIR
      navigate(null);
    }
    syncProjectTopbar();
    document.getElementById('projects-refresh-btn').addEventListener('click', () => navigate(_currentPath), { once: true });
  }

  // ── Navigation ─────────────────────────────────────
  async function navigate(path) {
    _editorOpen = false;
    _editorFileName = '';
    syncProjectTopbar();
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

    // ── New file / folder / upload (acts in the current directory) ──
    const actions = document.createElement('div');
    actions.className = 'dir-actions';
    const mkActions = [
      { label: 'New File',   sym: '＋', fn: newFile },
      { label: 'New Folder', sym: '＋', fn: newFolder },
      { label: 'Upload',     sym: '↑',  fn: uploadHere },
    ];
    mkActions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'dir-action-btn';
      btn.innerHTML = `<span class="dir-action-plus">${a.sym}</span>${a.label}`;
      btn.addEventListener('click', a.fn);
      actions.appendChild(btn);
    });
    container.appendChild(actions);

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
      if (e.target.closest('.cd-btn') || e.target.closest('.review-btn') || e.target.closest('.more-btn')) return;
      navigate(fullPath);
    });

    row.querySelector('.cd-btn').addEventListener('click', e => {
      e.stopPropagation();
      openInTerminal(fullPath);
    });

    addMoreBtn(row, fullPath, true, entry);

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
    const isEditable = isEditableExt(ext);

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
        if (e.target.closest('.edit-btn') || e.target.closest('.more-btn')) return;
        openEditor(fullPath, entry.name);
      });
      row.querySelector('.edit-btn').addEventListener('click', e => {
        e.stopPropagation();
        openEditor(fullPath, entry.name);
      });
    }

    addMoreBtn(row, fullPath, false, entry);

    return row;
  }

  // ── Per-entry actions (⋮) ────────────────────────
  function addMoreBtn(row, fullPath, isDir, entry) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'file-row-action more-btn';
    moreBtn.textContent = '⋮';
    moreBtn.title = 'Actions';
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      showEntryActions(fullPath, isDir, entry);
    });
    row.appendChild(moreBtn);
  }

  // ── Git badge ────────────────────────────────────
  async function maybeBadgeGit(row, dirPath) {
    if (dirPath in GIT_CACHE) {
      const c = GIT_CACHE[dirPath];
      if (c && c.branch) appendGitBadge(row, c.branch, c.dirty, dirPath);
      return;
    }
    try {
      const r = await App.apiFetch('/api/projects');
      const projects = await r.json();
      projects.forEach(p => { GIT_CACHE[p.path] = { branch: p.git.branch || '', dirty: p.git.dirty }; });
    } catch { return; }
    const c = GIT_CACHE[dirPath];
    if (c && c.branch) appendGitBadge(row, c.branch, c.dirty, dirPath);
  }

  function appendGitBadge(row, branch, dirty, dirPath) {
    const info = row.querySelector('.file-row-info');
    if (!info || info.querySelector('.git-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'git-badge';
    badge.textContent = '⎇ ' + branch;
    info.appendChild(badge);

    if (dirty) {
      const dirtyBadge = document.createElement('span');
      dirtyBadge.className = 'git-dirty-badge';
      dirtyBadge.textContent = '● changes';
      info.appendChild(dirtyBadge);

      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'file-row-action review-btn';
      reviewBtn.textContent = 'Review';
      reviewBtn.title = 'Review uncommitted changes';
      reviewBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof Diff !== 'undefined') Diff.show(dirPath);
      });
      const cdBtn = row.querySelector('.cd-btn');
      if (cdBtn) row.insertBefore(reviewBtn, cdBtn);
      else row.appendChild(reviewBtn);
    }
  }

  function showEntryActions(fullPath, isDir, entry) {
    const existing = document.getElementById('repo-action-sheet');
    if (existing) existing.remove();

    const name = fullPath.split('/').pop();
    const git = isDir ? GIT_CACHE[fullPath] : null;
    const ext = name.split('.').pop().toLowerCase();
    const sheet = document.createElement('div');
    sheet.id = 'repo-action-sheet';
    sheet.style.cssText = `
      position:fixed;inset:0;z-index:60;background:rgba(0,0,0,0.55);
      backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;
    `;

    const ACTIONS = [];
    if (isDir) {
      ACTIONS.push({ label: '📂 Open', fn: () => navigate(fullPath) });
      ACTIONS.push({ label: '> Open in Terminal', fn: () => openInTerminal(fullPath) });
      if (git && git.branch) {
        if (git.dirty) ACTIONS.push({ label: '● Review Changes', fn: () => { if (typeof Diff !== 'undefined') Diff.show(fullPath); } });
        ACTIONS.push({ label: '↓ Git Pull', fn: () => { App.showTab('term'); Term.paste(`cd ${JSON.stringify(fullPath)} && git pull\n`); } });
        ACTIONS.push({ label: '◉ Launch Claude Code', fn: () => { App.showTab('agents'); Agents.launchInProject('claude-code', fullPath, name); } });
      }
    } else {
      if (isEditableExt(ext)) ACTIONS.push({ label: '✎ Edit', fn: () => openEditor(fullPath, name) });
      ACTIONS.push({ label: '↓ Download', fn: () => downloadEntry(fullPath) });
    }
    ACTIONS.push({ label: '✎ Rename', fn: () => renameEntry(fullPath, name) });
    ACTIONS.push({ label: (isDir ? 'Delete folder' : 'Delete file'), danger: true, fn: () => deleteEntry(fullPath, isDir, name) });
    ACTIONS.push({ label: '✕ Cancel', cancel: true, fn: () => {} });

    const iconSvg = isDir
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>`
      : fileIconSvg(ext);

    sheet.innerHTML = `
      <div style="background:var(--bg-card);border-radius:var(--r-xl) var(--r-xl) 0 0;
        border:1px solid var(--border);width:100%;max-width:600px;overflow:hidden">
        <div style="padding:var(--sp-4) var(--sp-5);border-bottom:1px solid var(--border);
          display:flex;align-items:center;gap:8px">
          <div class="${isDir ? 'dir-icon ' : ''}file-row-icon" style="width:28px;height:28px;flex-shrink:0">
            ${iconSvg}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${esc(name)}</div>
            <div style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fullPath)}</div>
          </div>
        </div>
        <div id="repo-actions-list"></div>
        <div style="height:calc(var(--safe-bottom) + 4px)"></div>
      </div>
    `;

    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });

    const list = sheet.querySelector('#repo-actions-list');
    ACTIONS.forEach(a => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        width:100%;padding:15px var(--sp-5);text-align:left;
        font-family:var(--font-ui);font-size:15px;
        background:none;border:none;border-bottom:1px solid var(--border);
        color:${a.danger ? 'var(--red)' : a.cancel ? 'var(--text-dim)' : 'var(--text-primary)'};cursor:pointer;
      `;
      btn.textContent = a.label;
      btn.addEventListener('click', () => { sheet.remove(); a.fn(); });
      list.appendChild(btn);
    });

    document.body.appendChild(sheet);
  }

  // ── Create / rename / delete / download ──────────
  const EDITABLE_EXT = ['js','ts','json','md','txt','sh','py','html','css','yaml','yml','env','toml','conf','cfg','log','sql','rs','go','rb','php','c','h','cpp','swift'];
  function isEditableExt(ext) { return EDITABLE_EXT.includes(ext); }

  async function newFile() {
    const name = await App.prompt('New file name');
    if (!name) return;
    const path = joinPath(_currentPath, name.trim());
    try {
      await App.apiFetch('/api/files/write', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: '' }),
      });
      App.toast('Created ' + name, 'success', 1600);
      navigate(_currentPath);
    } catch (e) { App.toast('Create failed: ' + e.message, 'error'); }
  }

  async function newFolder() {
    const name = await App.prompt('New folder name');
    if (!name) return;
    const path = joinPath(_currentPath, name.trim());
    try {
      await App.apiFetch('/api/files/mkdir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      App.toast('Created ' + name + '/', 'success', 1600);
      navigate(_currentPath);
    } catch (e) { App.toast('Create failed: ' + e.message, 'error'); }
  }

  function uploadHere() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []);
      if (!files.length) return;
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('path', _currentPath);
        try {
          await App.apiFetch('/api/files/upload', { method: 'POST', body: fd });
        } catch (e) { App.toast('Upload failed: ' + e.message, 'error'); return; }
      }
      App.toast(`Uploaded ${files.length} file${files.length !== 1 ? 's' : ''}`, 'success', 1800);
      navigate(_currentPath);
    });
    inp.click();
  }

  async function renameEntry(fullPath, name) {
    const newName = await App.prompt('Rename to', name);
    if (!newName || newName.trim() === name) return;
    const to = joinPath(_currentPath, newName.trim());
    try {
      await App.apiFetch('/api/files/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fullPath, to }),
      });
      App.toast('Renamed', 'success', 1400);
      navigate(_currentPath);
    } catch (e) { App.toast('Rename failed: ' + e.message, 'error'); }
  }

  async function deleteEntry(fullPath, isDir, name) {
    const what = isDir ? 'folder' : 'file';
    const extra = isDir ? ' Everything inside is removed.' : '';
    if (!await App.confirm(`Delete ${what} “${name}”?${extra} This cannot be undone.`,
        { title: 'Delete ' + what, okLabel: 'Delete' })) return;
    try {
      await App.apiFetch('/api/files?path=' + encodeURIComponent(fullPath), { method: 'DELETE' });
      App.toast('Deleted ' + name, 'success', 1400);
      navigate(_currentPath);
    } catch (e) { App.toast('Delete failed: ' + e.message, 'error'); }
  }

  function downloadEntry(fullPath) {
    window.open('/api/files/download?path=' + encodeURIComponent(fullPath) + '&token=' + encodeURIComponent(App.token()));
  }

  // Called by diff.js after a commit/discard to refresh dirty state
  function _refreshDirty() {
    // Clear cache so next navigate re-fetches
    Object.keys(GIT_CACHE).forEach(k => delete GIT_CACHE[k]);
    navigate(_currentPath);
  }

  // ── Open in terminal ─────────────────────────────
  function openInTerminal(path) {
    App.showTab('term');
    Term.paste('cd ' + JSON.stringify(path) + '\n');
  }

  // ── Editor ───────────────────────────────────────
  async function openEditor(path, name) {
    _editorOpen = true;
    _editorFileName = name;
    syncProjectTopbar();
    const container = document.getElementById('projects-list');
    container.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:var(--sp-3) var(--sp-4);background:var(--bg-card);border-bottom:1px solid var(--border);flex-shrink:0';
    toolbar.innerHTML = `
      <button class="top-bar-action" id="ed-back">Back</button>
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

    let getContent;

    if (window.CM) {
      const { EditorView, EditorState, keymap, lineNumbers, highlightActiveLine,
              highlightActiveLineGutter, history, historyKeymap, defaultKeymap,
              indentWithTab, foldGutter, indentOnInput, bracketMatching,
              closeBrackets, autocompletion, searchKeymap, highlightSelectionMatches,
              oneDark, langs } = window.CM;

      const ext = name.split('.').pop().toLowerCase();
      const langMap = { js:'javascript', mjs:'javascript', cjs:'javascript',
                        ts:'javascript', jsx:'javascript', tsx:'javascript',
                        py:'python', json:'json', css:'css',
                        html:'html', htm:'html', md:'markdown' };
      const langExt = langMap[ext] ? langs[langMap[ext]]() : [];

      const dirty = toolbar.querySelector('#ed-dirty');

      const editorEl = document.createElement('div');
      editorEl.style.cssText = 'flex:1;overflow:auto;min-height:0;font-size:13px;';
      container.appendChild(editorEl);

      const view = new EditorView({
        state: EditorState.create({
          doc: content,
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            history(),
            foldGutter(),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            autocompletion(),
            highlightSelectionMatches(),
            keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap, ...searchKeymap]),
            langExt,
            oneDark,
            EditorView.updateListener.of(u => {
              if (u.docChanged) dirty.style.display = 'inline';
            }),
            EditorView.theme({
              '&': { height: '100%', minHeight: '0' },
              '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto' },
            }),
          ],
        }),
        parent: editorEl,
      });

      getContent = () => view.state.doc.toString();
    } else {
      // Fallback textarea when CM bundle not loaded
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.spellcheck = false;
      ta.style.cssText = `width:100%;flex:1;min-height:calc(100dvh - 200px);
        background:#1C1C1E;color:#E8E6F0;font-family:var(--font-mono);font-size:13px;
        line-height:1.5;padding:12px;border:none;outline:none;resize:none;box-sizing:border-box;`;
      container.appendChild(ta);
      ta.addEventListener('input', () => { toolbar.querySelector('#ed-dirty').style.display = 'inline'; });
      getContent = () => ta.value;
    }

    toolbar.querySelector('#ed-back').addEventListener('click', backToDirectory);
    toolbar.querySelector('#ed-save').addEventListener('click', async () => {
      const btn = toolbar.querySelector('#ed-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await App.apiFetch('/api/files/write', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: getContent() }),
        });
        toolbar.querySelector('#ed-dirty').style.display = 'none';
        btn.textContent = 'Saved';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save'; }, 1200);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save';
        App.toast('Save failed: ' + e.message, 'error');
      }
    });
  }

  function backToDirectory() {
    _editorOpen = false;
    _editorFileName = '';
    syncProjectTopbar();
    navigate(_currentPath);
  }

  function syncProjectTopbar() {
    const topbar = document.querySelector('#tab-projects .top-bar');
    const title = topbar?.querySelector('.top-bar-title');
    const refresh = document.getElementById('projects-refresh-btn');
    if (!topbar || !title || !refresh) return;

    let backBtn = document.getElementById('projects-back-btn');
    if (!backBtn) {
      backBtn = document.createElement('button');
      backBtn.id = 'projects-back-btn';
      backBtn.className = 'top-bar-action';
      backBtn.textContent = 'Back';
      backBtn.addEventListener('click', backToDirectory);
      topbar.insertBefore(backBtn, title);
    }

    backBtn.classList.toggle('hidden', !_editorOpen);
    refresh.classList.toggle('hidden', _editorOpen);
    title.textContent = _editorOpen ? (_editorFileName || 'File') : 'Projects';
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

  return { init, activate, _refreshDirty };
})();
