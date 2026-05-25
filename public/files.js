// File tree + CodeMirror editor (phase 3 — stubbed for phases 1/2)

const Files = (() => {
  let _panel, _initialized = false;
  let _cwd = '/';

  function init() {
    _panel = document.getElementById('files-panel');
    _panel.innerHTML = `
      <div id="files-toolbar">
        <div id="files-breadcrumb"></div>
        <button class="files-action-btn" id="files-upload-btn">Upload</button>
        <button class="files-action-btn" id="files-newfile-btn">+ File</button>
        <button class="files-action-btn" id="files-mkdir-btn">+ Dir</button>
      </div>
      <div id="files-list"></div>
    `;
    _initialized = true;
    navigate('/');
    document.getElementById('files-upload-btn').addEventListener('click', uploadPrompt);
    document.getElementById('files-newfile-btn').addEventListener('click', newFilePrompt);
    document.getElementById('files-mkdir-btn').addEventListener('click', mkdirPrompt);
  }

  function activate() {
    if (!_initialized) init();
  }

  async function navigate(path) {
    _cwd = path;
    renderBreadcrumb(path);
    const list = document.getElementById('files-list');
    list.innerHTML = '<div style="padding:16px;color:var(--text-dim)">Loading…</div>';
    try {
      const r = await App.apiFetch('/api/files/list?path=' + encodeURIComponent(path));
      const entries = await r.json();
      renderList(entries, path);
    } catch (e) {
      list.innerHTML = `<div style="padding:16px;color:var(--danger)">${e.message}</div>`;
    }
  }

  function renderBreadcrumb(path) {
    const bc = document.getElementById('files-breadcrumb');
    const parts = path.replace(/\/$/, '').split('/').filter(Boolean);
    let html = `<span class="breadcrumb-seg" data-path="/">~</span>`;
    let accumulated = '';
    parts.forEach((p, i) => {
      accumulated += '/' + p;
      const cp = accumulated;
      html += `<span class="breadcrumb-sep">/</span><span class="breadcrumb-seg" data-path="${cp}">${p}</span>`;
    });
    bc.innerHTML = html;
    bc.querySelectorAll('.breadcrumb-seg').forEach((el) => {
      el.addEventListener('click', () => navigate(el.dataset.path));
    });
  }

  function renderList(entries, parentPath) {
    const list = document.getElementById('files-list');
    if (!entries.length) {
      list.innerHTML = '<div style="padding:16px;color:var(--text-dim)">Empty</div>';
      return;
    }
    list.innerHTML = '';
    entries.forEach((e) => {
      const fullPath = (parentPath.endsWith('/') ? parentPath : parentPath + '/') + e.name;
      const row = document.createElement('div');
      row.className = 'file-entry';
      row.innerHTML = `
        <span class="file-icon">${e.type === 'dir' ? '📁' : fileIcon(e.name)}</span>
        <span class="file-name">${esc(e.name)}</span>
        <span class="file-meta">${e.type === 'dir' ? '' : fmtSize(e.size)}</span>
      `;
      row.addEventListener('click', () => {
        if (e.type === 'dir') navigate(fullPath);
        else openEditor(fullPath, e.name);
      });
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        showCtxMenu(ev.clientX, ev.clientY, e, fullPath, parentPath);
      });
      // long press for mobile
      let lt;
      row.addEventListener('touchstart', () => { lt = setTimeout(() => showCtxMenu(50, 200, e, fullPath, parentPath), 600); }, { passive: true });
      row.addEventListener('touchend', () => clearTimeout(lt));
      row.addEventListener('touchmove', () => clearTimeout(lt), { passive: true });
      list.appendChild(row);
    });
  }

  function showCtxMenu(x, y, entry, fullPath, parentPath) {
    document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    const items = [];
    if (entry.type === 'dir') {
      items.push({ label: '💻 Open in Terminal', action: () => openInTerminal(fullPath) });
    }
    items.push({ label: '✏️ Rename', action: () => renamePrompt(fullPath, entry.name, parentPath) });
    items.push({ label: '⬇️ Download', action: () => downloadFile(fullPath, entry.name) });
    items.push({ label: '🗑 Delete', action: () => deleteEntry(fullPath, parentPath), cls: 'danger' });

    items.forEach(({ label, action, cls }) => {
      const el = document.createElement('div');
      el.className = 'ctx-item' + (cls ? ' ' + cls : '');
      el.textContent = label;
      el.addEventListener('click', () => { menu.remove(); action(); });
      menu.appendChild(el);
    });

    menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - items.length * 44) + 'px';
    document.body.appendChild(menu);
    const dismiss = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', dismiss); } };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  async function openEditor(path, name) {
    const panel = document.getElementById('files-panel');
    panel.innerHTML = `
      <div id="editor-container">
        <div id="editor-toolbar">
          <button class="files-action-btn" id="editor-back">← Back</button>
          <span id="editor-filename">${esc(name)}</span>
          <span id="editor-dirty" class="hidden">●</span>
          <button class="files-action-btn" id="editor-save">Save</button>
        </div>
        <div id="editor-body"></div>
      </div>
    `;
    document.getElementById('editor-back').addEventListener('click', () => {
      if (document.getElementById('editor-dirty') && !document.getElementById('editor-dirty').classList.contains('hidden')) {
        if (!confirm('Unsaved changes — discard?')) return;
      }
      init(); navigate(_cwd);
    });

    let content = '';
    try {
      const r = await App.apiFetch('/api/files/read?path=' + encodeURIComponent(path));
      content = await r.text();
    } catch (e) { content = '[Error loading file: ' + e.message + ']'; }

    const ta = document.createElement('textarea');
    ta.id = 'plain-editor';
    ta.value = content;
    ta.style.cssText = 'width:100%;height:100%;background:#000;color:#c8d8e4;font-family:"JetBrains Mono",monospace;font-size:13px;padding:12px;border:none;outline:none;resize:none;box-sizing:border-box;';
    document.getElementById('editor-body').style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
    document.getElementById('editor-body').appendChild(ta);

    ta.addEventListener('input', () => document.getElementById('editor-dirty').classList.remove('hidden'));

    document.getElementById('editor-save').addEventListener('click', async () => {
      try {
        await App.apiFetch('/api/files/write', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: ta.value }),
        });
        document.getElementById('editor-dirty').classList.add('hidden');
      } catch (e) { alert('Save failed: ' + e.message); }
    });
  }

  function openInTerminal(dirPath) {
    App.showTab('term');
    Term.paste('cd ' + JSON.stringify(dirPath) + '\n');
  }

  async function renamePrompt(fullPath, name, parentPath) {
    const newName = prompt('Rename to:', name);
    if (!newName || newName === name) return;
    const dir = fullPath.slice(0, fullPath.length - name.length);
    try {
      await App.apiFetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fullPath, to: dir + newName }),
      });
      navigate(parentPath);
    } catch (e) { alert('Rename failed: ' + e.message); }
  }

  function downloadFile(path, name) {
    const a = document.createElement('a');
    a.href = '/api/files/download?path=' + encodeURIComponent(path);
    a.download = name;
    a.setAttribute('data-auth', App.token());
    // Can't set Authorization header on anchor — open in new tab as fallback
    window.open('/api/files/download?path=' + encodeURIComponent(path) + '&token=' + encodeURIComponent(App.token()));
  }

  async function deleteEntry(fullPath, parentPath) {
    if (!confirm('Delete ' + fullPath + '?')) return;
    try {
      await App.apiFetch('/api/files?path=' + encodeURIComponent(fullPath), { method: 'DELETE' });
      navigate(parentPath);
    } catch (e) { alert('Delete failed: ' + e.message); }
  }

  function uploadPrompt() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('path', _cwd);
      try {
        await App.apiFetch('/api/files/upload', { method: 'POST', body: fd });
        navigate(_cwd);
      } catch (e) { alert('Upload failed: ' + e.message); }
    });
    inp.click();
  }

  async function newFilePrompt() {
    const name = prompt('New file name:');
    if (!name) return;
    const path = (_cwd.endsWith('/') ? _cwd : _cwd + '/') + name;
    try {
      await App.apiFetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: '' }),
      });
      navigate(_cwd);
    } catch (e) { alert('Create failed: ' + e.message); }
  }

  async function mkdirPrompt() {
    const name = prompt('New folder name:');
    if (!name) return;
    const path = (_cwd.endsWith('/') ? _cwd : _cwd + '/') + name;
    try {
      await App.apiFetch('/api/files/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      navigate(_cwd);
    } catch (e) { alert('Create failed: ' + e.message); }
  }

  function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { js:'📜', ts:'📜', json:'📋', md:'📝', txt:'📝', sh:'⚙️', py:'🐍', html:'🌐', css:'🎨', png:'🖼', jpg:'🖼', jpeg:'🖼', gif:'🖼', svg:'🖼', mp4:'🎬', mp3:'🎵', zip:'📦', tar:'📦', gz:'📦' };
    return map[ext] || '📄';
  }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    return (b/1024/1024).toFixed(1) + ' MB';
  }
  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, activate };
})();
