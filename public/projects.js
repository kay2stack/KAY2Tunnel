// Stan CLI — Projects tab: git repo list + open-with-agent + file browser

const Projects = (() => {
  let _initialized = false;

  function init() {}

  function activate() {
    if (!_initialized) { _initialized = true; load(); }
    document.getElementById('projects-refresh-btn').addEventListener('click', load, { once: true });
  }

  async function load() {
    const list = document.getElementById('projects-list');
    list.innerHTML = '<div style="color:var(--color-text-dim);font-size:14px;text-align:center;padding:40px 0">Scanning projects…</div>';
    document.getElementById('projects-refresh-btn').addEventListener('click', load, { once: true });
    try {
      const r = await App.apiFetch('/api/projects');
      const projects = await r.json();
      render(projects, list);
    } catch (e) {
      list.innerHTML = `<div style="color:var(--color-danger);font-size:14px;padding:40px 16px">${e.message}</div>`;
    }
  }

  function render(projects, container) {
    if (!projects.length) {
      container.innerHTML = '<div style="color:var(--color-text-dim);font-size:14px;text-align:center;padding:40px 0">No git repos found in ~/</div>';
      return;
    }
    container.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `${projects.length} repositories`;
    container.appendChild(label);

    projects.forEach(p => {
      const card = document.createElement('div');
      card.className = 'project-card';
      const dirty = p.git.dirty ? '<span class="project-dirty-badge">MODIFIED</span>' : '';
      card.innerHTML = `
        <div class="project-card-body">
          <div class="project-name">${esc(p.name)}${dirty}</div>
          <div class="project-branch">${p.git.branch ? '⎇ ' + esc(p.git.branch) : ''}</div>
          <div class="project-meta">${esc(p.git.lastCommit || '')}${p.git.lastCommitTime ? ' · ' + p.git.lastCommitTime : ''}</div>
        </div>
        <div class="project-actions">
          <button class="project-btn terminal" data-path="${esc(p.path)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            Terminal
          </button>
          <button class="project-btn claude" data-path="${esc(p.path)}" data-agent="claude-code">
            Claude
          </button>
          <button class="project-btn codex" data-path="${esc(p.path)}" data-agent="codex">
            Codex
          </button>
          <button class="project-btn" style="flex:0.7" data-path="${esc(p.path)}" data-action="files">
            Files
          </button>
        </div>
      `;

      card.querySelector('.project-btn.terminal').addEventListener('click', () => {
        App.showTab('term');
        Term.paste(`cd ${JSON.stringify(p.path)}\n`);
      });

      card.querySelector('.project-btn.claude').addEventListener('click', () =>
        launchAgent('claude-code', p.path, p.name)
      );
      card.querySelector('.project-btn.codex').addEventListener('click', () =>
        launchAgent('codex', p.path, p.name)
      );
      card.querySelector('[data-action="files"]').addEventListener('click', () =>
        openFiles(p.path, p.name)
      );

      container.appendChild(card);
    });
  }

  async function launchAgent(agentId, projectPath, projectName) {
    App.showTab('agents');
    await Agents.launchInProject(agentId, projectPath, projectName);
  }

  function openFiles(projectPath, projectName) {
    // Replace projects list with inline file browser for this project
    const list = document.getElementById('projects-list');
    list.innerHTML = '';
    renderFileBrowser(projectPath, projectName, list);
  }

  async function renderFileBrowser(rootPath, projectName, container) {
    let currentPath = rootPath;

    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px';
    topBar.innerHTML = `
      <button class="top-bar-action" id="fb-back">← Projects</button>
      <span style="flex:1;font-size:14px;font-weight:600;color:var(--color-text)">${esc(projectName)}</span>
    `;
    topBar.querySelector('#fb-back').addEventListener('click', () => {
      _initialized = false; activate();
    });
    container.appendChild(topBar);

    const fileList = document.createElement('div');
    container.appendChild(fileList);

    async function navigate(path) {
      currentPath = path;
      fileList.innerHTML = '<div style="color:var(--color-text-dim);padding:20px 0">Loading…</div>';
      try {
        const r = await App.apiFetch('/api/files/list?path=' + encodeURIComponent(path));
        const entries = await r.json();
        fileList.innerHTML = '';

        if (path !== rootPath) {
          const upRow = document.createElement('div');
          upRow.className = 'file-entry';
          upRow.innerHTML = '<span class="file-icon">↑</span><span class="file-name">…</span>';
          upRow.addEventListener('click', () => navigate(path.split('/').slice(0,-1).join('/') || rootPath));
          fileList.appendChild(upRow);
        }

        entries.forEach(e => {
          const full = (path.endsWith('/') ? path : path + '/') + e.name;
          const row = document.createElement('div');
          row.className = 'file-entry';
          row.innerHTML = `
            <span class="file-icon">${e.type === 'dir' ? '📁' : fileIcon(e.name)}</span>
            <span class="file-name">${esc(e.name)}</span>
            <span class="file-meta">${e.type === 'file' ? fmtSize(e.size) : ''}</span>
          `;
          row.addEventListener('click', () => {
            if (e.type === 'dir') navigate(full);
            else openEditor(full, e.name);
          });
          fileList.appendChild(row);
        });
      } catch (err) {
        fileList.innerHTML = `<div style="color:var(--color-danger);padding:16px">${err.message}</div>`;
      }
    }

    navigate(currentPath);
  }

  async function openEditor(path, name) {
    const list = document.getElementById('projects-list');
    list.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px';
    toolbar.innerHTML = `
      <button class="top-bar-action" id="ed-back">←</button>
      <span style="flex:1;font-size:14px;font-family:var(--font-mono);color:var(--color-accent-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
      <span id="ed-dirty" class="hidden" style="color:var(--color-warn);font-size:12px">●</span>
      <button class="top-bar-action primary" id="ed-save">Save</button>
    `;
    list.appendChild(toolbar);

    let content = '';
    try { const r = await App.apiFetch('/api/files/read?path=' + encodeURIComponent(path)); content = await r.text(); }
    catch (e) { content = '[Error: ' + e.message + ']'; }

    const ta = document.createElement('textarea');
    ta.value = content;
    ta.style.cssText = `
      width:100%;flex:1;min-height:calc(100vh - 220px);
      background:var(--color-terminal-bg);color:var(--color-text);
      font-family:var(--font-mono);font-size:13px;line-height:1.5;
      padding:12px;border:1px solid var(--color-border);border-radius:var(--r-md);
      outline:none;resize:none;box-sizing:border-box;
    `;
    list.appendChild(ta);

    ta.addEventListener('input', () => toolbar.querySelector('#ed-dirty').classList.remove('hidden'));
    toolbar.querySelector('#ed-back').addEventListener('click', () => { _initialized = false; activate(); });
    toolbar.querySelector('#ed-save').addEventListener('click', async () => {
      try {
        await App.apiFetch('/api/files/write', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: ta.value }),
        });
        toolbar.querySelector('#ed-dirty').classList.add('hidden');
      } catch (e) { alert('Save failed: ' + e.message); }
    });
  }

  function fileIcon(n) {
    const e = n.split('.').pop().toLowerCase();
    const m = { js:'📜',ts:'📜',json:'📋',md:'📝',txt:'📝',sh:'⚙️',py:'🐍',html:'🌐',css:'🎨',png:'🖼',jpg:'🖼',zip:'📦',tar:'📦',gz:'📦' };
    return m[e] || '📄';
  }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, activate };
})();
