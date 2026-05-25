const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { ROOT_DIR } = require('./config');

const execFileAsync = promisify(execFile);
const router = express.Router();

function validatePath(p) {
  if (!p) return null;
  const resolved = path.resolve(p);
  if (!resolved.startsWith(ROOT_DIR)) return null;
  return resolved;
}

// GET /api/diff?path=/home/kay2/project
router.get('/', async (req, res) => {
  const repoPath = validatePath(req.query.path);
  if (!repoPath) return res.status(400).json({ error: 'invalid path' });
  try {
    const [diffRes, statusRes, logRes] = await Promise.all([
      execFileAsync('git', ['-C', repoPath, 'diff', 'HEAD'], { maxBuffer: 2 * 1024 * 1024, timeout: 5000 }),
      execFileAsync('git', ['-C', repoPath, 'status', '--porcelain'], { maxBuffer: 256 * 1024, timeout: 5000 }),
      execFileAsync('git', ['-C', repoPath, 'log', '--oneline', '-5'], { maxBuffer: 64 * 1024, timeout: 5000 })
        .catch(() => ({ stdout: '' })),
    ]);
    const filesChanged = statusRes.stdout.trim().split('\n').filter(Boolean)
      .map(l => ({ status: l.slice(0, 2).trim(), file: l.slice(3) }));
    res.json({
      diff: diffRes.stdout,
      filesChanged,
      changedCount: filesChanged.length,
      recentCommits: logRes.stdout.trim().split('\n').filter(Boolean),
      repo: path.basename(repoPath),
      path: repoPath,
    });
  } catch (e) {
    if ((e.stderr || e.message || '').includes('not a git repository'))
      return res.status(400).json({ error: 'not a git repo' });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diff/commit  { path, message }
router.post('/commit', express.json(), async (req, res) => {
  const repoPath = validatePath((req.body || {}).path);
  const { message } = req.body || {};
  if (!repoPath || !message) return res.status(400).json({ error: 'path and message required' });
  try {
    await execFileAsync('git', ['-C', repoPath, 'add', '-A'], { timeout: 10000 });
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'commit', '-m', message], { timeout: 10000 });
    res.json({ ok: true, output: stdout });
  } catch (e) {
    res.status(500).json({ error: e.message, output: (e.stderr || '') + (e.stdout || '') });
  }
});

// POST /api/diff/discard  { path }
router.post('/discard', express.json(), async (req, res) => {
  const repoPath = validatePath((req.body || {}).path);
  if (!repoPath) return res.status(400).json({ error: 'invalid path' });
  try {
    await execFileAsync('git', ['-C', repoPath, 'checkout', '--', '.'], { timeout: 10000 });
    await execFileAsync('git', ['-C', repoPath, 'clean', '-fd'], { timeout: 10000 }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diff/undo  { path }
router.post('/undo', express.json(), async (req, res) => {
  const repoPath = validatePath((req.body || {}).path);
  if (!repoPath) return res.status(400).json({ error: 'invalid path' });
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'reset', 'HEAD~1', '--soft'], { timeout: 10000 });
    res.json({ ok: true, output: stdout });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
