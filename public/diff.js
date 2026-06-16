// Stan CLI — Diff review sheet

const Diff = (() => {
  let _sheet = null;

  async function show(repoPath) {
    _dismiss();

    _sheet = document.createElement('div');
    _sheet.className = 'diff-sheet-overlay';
    _sheet.innerHTML = `
      <div class="diff-sheet">
        <div class="diff-sheet-handle"></div>
        <div class="diff-sheet-header">
          <div>
            <div class="diff-sheet-title" id="diff-repo-name">Loading…</div>
            <div class="diff-sheet-sub" id="diff-file-count"></div>
          </div>
          <button class="top-bar-action" id="diff-close-btn">Close</button>
        </div>
        <div class="diff-body" id="diff-body">
          <div style="color:var(--text-dim);text-align:center;padding:40px 0;font-size:14px">Fetching diff…</div>
        </div>
        <div class="diff-footer" id="diff-footer" style="display:none">
          <input class="diff-commit-input" id="diff-commit-msg" type="text" placeholder="Commit message…" spellcheck="false">
          <div class="diff-action-row">
            <button class="diff-btn approve" id="diff-approve-btn">Approve</button>
            <button class="diff-btn reject"  id="diff-reject-btn">Reject</button>
            <button class="diff-btn undo"    id="diff-undo-btn">Undo last</button>
          </div>
        </div>
      </div>
    `;

    _sheet.querySelector('#diff-close-btn').addEventListener('click', _dismiss);
    _sheet.addEventListener('click', e => { if (e.target === _sheet) _dismiss(); });
    document.body.appendChild(_sheet);

    let data;
    try {
      const r = await App.apiFetch('/api/diff?path=' + encodeURIComponent(repoPath));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (e) {
      document.getElementById('diff-body').innerHTML =
        `<div style="color:var(--red);padding:16px">${esc(e.message)}</div>`;
      return;
    }

    document.getElementById('diff-repo-name').textContent = data.repo || 'diff';
    document.getElementById('diff-file-count').textContent =
      data.changedCount + ' file' + (data.changedCount !== 1 ? 's' : '') + ' changed';

    renderDiff(data);
    renderFooter(data, repoPath);
  }

  function renderDiff(data) {
    const body = document.getElementById('diff-body');
    if (!body) return;

    if (!data.diff && data.filesChanged.length === 0) {
      body.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:32px;font-size:14px">No changes</div>';
      return;
    }

    const out = [];

    // File status summary
    if (data.filesChanged.length) {
      out.push('<div class="diff-file-list">');
      data.filesChanged.forEach(f => {
        const cls = f.status === 'A' ? 'diff-added' : f.status === 'D' ? 'diff-removed' : 'diff-modified';
        const label = f.status === 'A' ? '+' : f.status === 'D' ? '−' : '~';
        out.push(`<div class="diff-file-entry ${cls}"><span class="diff-file-label">${label}</span>${esc(f.file)}</div>`);
      });
      out.push('</div>');
    }

    // Unified diff
    if (data.diff) {
      out.push('<div class="diff-hunk-wrap">');
      const lines = data.diff.split('\n');
      let inFile = false;
      lines.forEach(line => {
        if (line.startsWith('diff --git')) {
          const m = line.match(/b\/(.+)$/);
          out.push(`<div class="diff-filename">${m ? esc(m[1]) : esc(line)}</div>`);
          inFile = true;
        } else if (line.startsWith('@@')) {
          out.push(`<div class="diff-line hunk">${esc(line)}</div>`);
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          out.push(`<div class="diff-line add"><span class="diff-sign">+</span>${esc(line.slice(1))}</div>`);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          out.push(`<div class="diff-line del"><span class="diff-sign">−</span>${esc(line.slice(1))}</div>`);
        } else if (inFile && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++')) {
          out.push(`<div class="diff-line ctx">${esc(line.slice(1) || '')}</div>`);
        }
      });
      out.push('</div>');
    }

    body.innerHTML = out.join('');
  }

  function renderFooter(data, repoPath) {
    const footer = document.getElementById('diff-footer');
    if (!footer || data.changedCount === 0) return;
    footer.style.display = '';

    const commitInput = document.getElementById('diff-commit-msg');
    if (data.recentCommits && data.recentCommits[0]) {
      // Pre-fill with a cleaned up version of the last commit
      commitInput.placeholder = 'Commit message…';
    }

    document.getElementById('diff-approve-btn').addEventListener('click', async () => {
      const msg = commitInput.value.trim();
      if (!msg) { commitInput.focus(); commitInput.style.borderColor = 'var(--red)'; return; }
      await _doAction('/api/diff/commit', { path: repoPath, message: msg }, 'Committing…', 'Committed!');
    });

    document.getElementById('diff-reject-btn').addEventListener('click', async () => {
      if (!await App.confirm('Discard ALL changes in ' + (data.repo || repoPath) + '? This cannot be undone.', { title: 'Discard changes', okLabel: 'Discard' })) return;
      await _doAction('/api/diff/discard', { path: repoPath }, 'Discarding…', 'Discarded');
    });

    document.getElementById('diff-undo-btn').addEventListener('click', async () => {
      if (!await App.confirm('Undo last commit in ' + (data.repo || repoPath) + '? Changes will be kept (soft reset).', { title: 'Undo commit', okLabel: 'Undo' })) return;
      await _doAction('/api/diff/undo', { path: repoPath }, 'Undoing…', 'Undone');
    });
  }

  async function _doAction(endpoint, body, loadingText, doneText) {
    const btns = _sheet ? _sheet.querySelectorAll('.diff-btn') : [];
    btns.forEach(b => { b.disabled = true; });
    const approveBtn = document.getElementById('diff-approve-btn');
    if (approveBtn) approveBtn.textContent = loadingText;
    try {
      const r = await App.apiFetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!result.ok) throw new Error(result.error || 'failed');
      // Refresh diff or close
      const diffBody = document.getElementById('diff-body');
      const diffFooter = document.getElementById('diff-footer');
      if (diffBody) diffBody.innerHTML = `<div style="color:var(--green);text-align:center;padding:32px;font-size:14px">${esc(doneText)}</div>`;
      if (diffFooter) diffFooter.style.display = 'none';
      // Update projects dirty state
      if (typeof Projects !== 'undefined') Projects._refreshDirty?.();
      setTimeout(_dismiss, 1500);
    } catch (e) {
      btns.forEach(b => { b.disabled = false; });
      if (approveBtn) approveBtn.textContent = 'Approve';
      App.toast('Failed: ' + e.message, 'error');
    }
  }

  function _dismiss() {
    if (_sheet) { _sheet.remove(); _sheet = null; }
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { show };
})();
