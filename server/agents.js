const express = require('express');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const { ROOT_DIR } = require('./config');
const { listSessions, getSession } = require('./terminal');

const router = express.Router();

// Quick-pick directories for agent launch (relative to ROOT_DIR, or '' = home)
const LAUNCH_DIRS = [
  { label: 'Home', path: '' },
  { label: 'clive', path: 'clive' },
  { label: 'KAY2Tunnel', path: 'KAY2Tunnel' },
  { label: 'glint', path: 'glint' },
  { label: 'androidroot', path: 'androidroot' },
];

function resolveLaunchCwd(projectPath) {
  if (!projectPath) return ROOT_DIR;
  const raw = String(projectPath).trim();
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + path.sep)) return null;
  return resolved;
}

function launchPathKey(projectPath) {
  if (!projectPath) return '';
  const resolved = resolveLaunchCwd(projectPath);
  if (!resolved) return null;
  if (resolved === ROOT_DIR) return '';
  return path.relative(ROOT_DIR, resolved);
}

const AGENT_DEFS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    provider: 'Anthropic',
    cmd: 'claude',
    icon: 'claude',
    description: 'Agentic coding in your repo',
    color: '#D4763B',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    provider: 'OpenAI',
    cmd: 'codex',
    icon: 'codex',
    description: 'OpenAI code generation agent',
    color: '#10A37F',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    provider: 'Google',
    cmd: 'gemini',
    icon: 'gemini',
    description: 'Google AI coding assistant',
    color: '#4285F4',
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    provider: 'Cursor',
    cmd: 'agent',
    icon: 'cursor',
    description: 'Cursor Agent CLI — coding agent in your repo',
    color: '#0E0E0E',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    provider: 'Claude wrapper · local',
    cmd: 'hermes',
    icon: 'hermes',
    description: 'Tool-calling agent — a local Claude wrapper (Hermz)',
    color: '#D4A017',
  },
  {
    id: 'clive',
    name: 'Clive',
    provider: 'OpenClaw · local',
    cmd: 'openclaw',
    icon: 'clive',
    description: 'Clive — your OpenClaw agent CLI (same brain as Telegram)',
    color: '#0AA6C2',
  },
  {
    id: 'stan',
    name: 'Stan',
    provider: 'Local · Ollama',
    cmd: null,
    icon: 'stan',
    description: 'Local AI via Ollama',
    color: '#7C5CFF',
  },
];

const _installCache = {};
function isInstalled(cmd) {
  if (!cmd) return false;
  if (cmd in _installCache) return _installCache[cmd];
  try {
    execSync(`which ${cmd} 2>/dev/null || ls ~/.npm-global/bin/${cmd} 2>/dev/null || ls ~/.nvm/versions/node/*/bin/${cmd} 2>/dev/null`, { shell: '/bin/bash', timeout: 2000 });
    _installCache[cmd] = true;
  } catch { _installCache[cmd] = false; }
  return _installCache[cmd];
}

function agentSession(agentId) {
  return listSessions().find(s => s.name && s.name.startsWith(`agent:${agentId}`)) || null;
}

// GET /api/agents
router.get('/', (req, res) => {
  const result = AGENT_DEFS.map(a => {
    const running = agentSession(a.id);
    return {
      ...a,
      installed: a.cmd ? isInstalled(a.cmd) : true,
      session: running ? { id: running.id, cwd: running.cwd, lastActive: running.lastActive, createdAt: running.createdAt, clients: running.clients } : null,
    };
  });
  res.json(result);
});

// GET /api/agents/launch-dirs — pinned shortcuts for the launch picker
router.get('/launch-dirs', (req, res) => {
  const dirs = LAUNCH_DIRS.filter(d => {
    if (!d.path) return true;
    return fs.existsSync(path.join(ROOT_DIR, d.path));
  });
  res.json(dirs);
});

// GET /api/agents/:id/tail — last chunk of output for agent card preview
router.get('/:id/tail', (req, res) => {
  const s = agentSession(req.params.id);
  if (!s) return res.json({ tail: '' });
  const session = getSession(s.id);
  res.json({ tail: session ? session.tail(2048) : '' });
});

// POST /api/agents/launch { agentId, projectPath? }
router.post('/launch', express.json(), (req, res) => {
  const { agentId, projectPath } = req.body || {};
  const def = AGENT_DEFS.find(a => a.id === agentId);
  if (!def || !def.cmd) return res.status(400).json({ error: 'Agent not launchable via PTY' });

  const cwd = resolveLaunchCwd(projectPath);
  if (!cwd) return res.status(400).json({ error: 'Path outside home directory' });

  // Check existing session for this agent
  const existing = agentSession(agentId);
  if (existing) return res.json({ sessionId: existing.id, reattached: true });

  // Session is created lazily on first WS connection with ?name=agent:<id>&cmd=<cmd>&cwd=<cwd>
  // Return the params for the client to use when opening the WS
  res.json({
    sessionId: null,
    wsParams: {
      name: `agent:${agentId}`,
      cmd: def.cmd,
      cwd,
    },
  });
});

module.exports = router;
