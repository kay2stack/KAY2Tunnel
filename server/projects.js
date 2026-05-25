const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ROOT_DIR } = require('./config');

const router = express.Router();

const SKIP = new Set(['.nvm', '.npm', '.npm-global', '.cache', '.config', '.local', '.pm2', 'node_modules']);

function gitInfo(dir) {
  const exec = (cmd) => {
    try { return execSync(cmd, { cwd: dir, timeout: 3000, encoding: 'utf8' }).trim(); }
    catch { return ''; }
  };
  return {
    branch: exec('git rev-parse --abbrev-ref HEAD'),
    lastCommit: exec('git log -1 --format=%s'),
    lastCommitTime: exec('git log -1 --format=%ar'),
    dirty: exec('git status --porcelain').length > 0,
  };
}

function detectType(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('package.json')) return 'node';
  if (has('requirements.txt') || has('pyproject.toml')) return 'python';
  if (has('Cargo.toml')) return 'rust';
  if (has('go.mod')) return 'go';
  return 'generic';
}

// GET /api/projects
router.get('/', (req, res) => {
  let entries;
  try { entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true }); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const projects = entries
    .filter(e => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
    .map(e => {
      const full = path.join(ROOT_DIR, e.name);
      const isGit = fs.existsSync(path.join(full, '.git'));
      if (!isGit) return null;
      return {
        name: e.name,
        path: full,
        relativePath: e.name,
        type: detectType(full),
        git: gitInfo(full),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json(projects);
});

module.exports = router;
