const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { ROOT_DIR } = require('./config');

const router = express.Router();
const execFileAsync = promisify(execFile);

const SKIP = new Set(['.nvm', '.npm', '.npm-global', '.cache', '.config', '.local', '.pm2', 'node_modules']);

async function gitInfo(dir) {
  try {
    const [logOut, statusOut] = await Promise.all([
      execFileAsync('git', ['log', '-1', '--format=%D\x1f%s\x1f%ar'], { cwd: dir, timeout: 3000 })
        .catch(() => ({ stdout: '' })),
      execFileAsync('git', ['status', '--porcelain'], { cwd: dir, timeout: 3000 })
        .catch(() => ({ stdout: '' })),
    ]);
    const parts = (logOut.stdout || '').trim().split('\x1f');
    const refs = parts[0] || '';
    const subject = parts[1] || '';
    const relTime = parts[2] || '';
    const branchMatch = refs.match(/HEAD -> ([^,\n]+)/);
    const branch = branchMatch ? branchMatch[1].trim() : '';
    return { branch, lastCommit: subject, lastCommitTime: relTime, dirty: (statusOut.stdout || '').trim().length > 0 };
  } catch {
    return { branch: '', lastCommit: '', lastCommitTime: '', dirty: false };
  }
}

function detectType(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('package.json')) return 'node';
  if (has('requirements.txt') || has('pyproject.toml')) return 'python';
  if (has('Cargo.toml')) return 'rust';
  if (has('go.mod')) return 'go';
  return 'generic';
}

router.get('/', async (req, res) => {
  let entries;
  try { entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true }); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const gitDirs = entries
    .filter(e => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
    .map(e => path.join(ROOT_DIR, e.name))
    .filter(full => fs.existsSync(path.join(full, '.git')));

  const projects = await Promise.all(
    gitDirs.map(async (full) => ({
      name: path.basename(full),
      path: full,
      relativePath: path.basename(full),
      type: detectType(full),
      git: await gitInfo(full),
    }))
  );

  res.json(projects.sort((a, b) => a.name.localeCompare(b.name)));
});

module.exports = router;
