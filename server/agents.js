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
  return agentSessions(agentId)[0] || null;
}

// All live sessions for an agent. Sessions are named `agent:<id>@<projectKey>`
// so the SAME agent can run in multiple projects at once (and different agents
// in parallel). Also matches the legacy bare `agent:<id>` name.
function agentSessions(agentId) {
  const exact = `agent:${agentId}`;
  const pref = `agent:${agentId}@`;
  return listSessions().filter(s => s.name === exact || (s.name && s.name.startsWith(pref)));
}

// Unique session name for an (agent, project) pair. Home dir → '~'.
function agentSessionName(agentId, projectPath) {
  const key = launchPathKey(projectPath);
  return `agent:${agentId}@${key || '~'}`;
}

function sessionView(s) {
  return { id: s.id, cwd: s.cwd, lastActive: s.lastActive, createdAt: s.createdAt, clients: s.clients };
}

// GET /api/agents
router.get('/', (req, res) => {
  const result = AGENT_DEFS.map(a => {
    const sess = agentSessions(a.id).map(sessionView);
    return {
      ...a,
      installed: a.cmd ? isInstalled(a.cmd) : true,
      sessions: sess,
      session: sess[0] || null,   // back-compat for older consumers
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

// GET /api/agents/session/:sid/tail — output for ONE running session (parallel-safe)
router.get('/session/:sid/tail', (req, res) => {
  const session = getSession(req.params.sid);
  res.json({ tail: session ? session.tail(2048) : '' });
});

// GET /api/agents/:id/tail — first session's output (legacy/back-compat)
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

  const name = agentSessionName(agentId, projectPath);
  // Reattach ONLY if this agent is already running in THIS project. Launching
  // the same agent in a different project — or any other agent — starts a fresh
  // session, so agents run in parallel instead of stealing each other's shell.
  const existing = listSessions().find(s => s.name === name);
  if (existing) return res.json({ sessionId: existing.id, reattached: true });

  // Session is created lazily on first WS connection with ?name=<name>&cmd=&cwd=
  res.json({
    sessionId: null,
    wsParams: { name, cmd: def.cmd, cwd },
  });
});

module.exports = router;
