const express = require('express');
const { execSync } = require('child_process');
const path = require('path');
const { ROOT_DIR } = require('./config');
const { listSessions, getSession } = require('./terminal');

const router = express.Router();

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
      session: running ? { id: running.id, lastActive: running.lastActive, clients: running.clients } : null,
    };
  });
  res.json(result);
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

  const cwd = projectPath
    ? path.resolve(ROOT_DIR, projectPath.replace(/^\//, ''))
    : ROOT_DIR;

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
