const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const router = express.Router();

const ALLOWED_PM2_ACTIONS = ['restart', 'stop', 'start'];

// GET /api/pi/processes
router.get('/processes', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: 8000 });
    const procs = JSON.parse(stdout);
    res.json(procs.map(p => ({
      id: p.pm_id,
      name: p.name,
      status: p.pm2_env?.status || 'unknown',
      pid: p.pid || null,
      cpu: p.monit?.cpu ?? 0,
      mem: p.monit?.memory ?? 0,
      restarts: p.pm2_env?.restart_time ?? 0,
      uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/pi/pm2  { action, name }
router.post('/pm2', express.json(), async (req, res) => {
  const { action, name } = req.body || {};
  if (!ALLOWED_PM2_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid action' });
  if (!name || typeof name !== 'string' || !/^[\w\-. ]+$/.test(name))
    return res.status(400).json({ error: 'invalid name' });
  try {
    await execFileAsync('pm2', [action, name], { timeout: 15000 });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pi/disk
router.get('/disk', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('df', ['-h', '/'], { timeout: 5000 });
    const parts = stdout.trim().split('\n')[1].split(/\s+/);
    res.json({ total: parts[1], used: parts[2], avail: parts[3], pct: parts[4] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
