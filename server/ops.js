// Stan CLI — Agent Ops: read-only view of Hermes cron jobs + kanban tasks (subagent work).
// Memory-conscious: cron is read straight from ~/.hermes/cron/jobs.json (no process
// spawn); kanban is one short `hermes kanban list` spawn, both cached briefly. Clients
// fetch on demand / manual refresh — never auto-poll — so the Pi never gets hammered.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const jobs = require('./jobs');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));   // for the job POST routes

const CRON_JOBS = path.join(os.homedir(), '.hermes', 'cron', 'jobs.json');
const HERMES_BIN = process.env.HERMES_BIN || path.join(os.homedir(), '.local', 'bin', 'hermes');

// tiny TTL cache so rapid re-renders don't re-spawn / re-read
const _cache = {};
function cached(key, ttlMs, produce) {
  const hit = _cache[key];
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve(produce()).then(val => { _cache[key] = { at: Date.now(), val }; return val; });
}

function readCron() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(CRON_JOBS, 'utf8')); }
  catch { return []; }
  const jobs = Array.isArray(raw) ? raw
    : Array.isArray(raw.jobs) ? raw.jobs
    : Object.values(raw).filter(j => j && typeof j === 'object' && j.id);
  return jobs.map(j => ({
    id: j.id,
    name: j.name,
    schedule: (j.schedule && (j.schedule.display || j.schedule.expr)) || j.schedule_display || '',
    enabled: j.enabled !== false && j.state !== 'paused',
    state: j.state || (j.enabled === false ? 'paused' : 'scheduled'),
    nextRun: j.next_run_at || null,
    lastRun: j.last_run_at || null,
    lastStatus: j.last_status || null,
    lastError: j.last_error || j.last_delivery_error || null,
    mode: j.no_agent ? 'script' : 'agent',
    target: j.script || j.skill || (j.prompt ? 'prompt' : ''),
    deliver: j.deliver || '',
    runs: (j.repeat && j.repeat.completed) || 0,
  })).sort((a, b) => String(a.nextRun || '~').localeCompare(String(b.nextRun || '~')));
}

function hermes(args, timeout = 8000) {
  return new Promise(resolve => {
    execFile(HERMES_BIN, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.toString());
    });
  });
}

async function readKanban() {
  const out = await hermes(['kanban', 'list']);
  if (out == null) return { available: false, tasks: [] };
  let arr;
  try { arr = JSON.parse(out); } catch { return { available: true, tasks: [] }; }
  if (!Array.isArray(arr)) arr = arr.tasks || [];
  const tasks = arr.map(t => ({
    id: t.id || t.task_id,
    title: t.title || t.name || '',
    status: t.status || t.state || '',
    assignee: t.assignee || t.profile || '',
    board: t.board || '',
    updated: t.updated_at || t.updated || null,
  }));
  return { available: true, tasks };
}

// GET /api/ops/cron — Hermes scheduled jobs
router.get('/cron', async (req, res) => {
  try { res.json(await cached('cron', 8000, readCron)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ops/kanban — Hermes kanban tasks (subagent work)
router.get('/kanban', async (req, res) => {
  try { res.json(await cached('kanban', 12000, readKanban)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── StanCLI jobs (owned by us, runnable/schedulable from the PWA) ────────────
// GET /api/ops/jobs — list with run state + next-run estimate
router.get('/jobs', (req, res) => {
  const out = jobs.list().map(j => ({ ...j, nextRun: j.schedule ? jobs.nextRun(j.schedule) : null }));
  res.json(out);
});

// POST /api/ops/jobs/:id/run — run now
router.post('/jobs/:id/run', (req, res) => {
  const r = jobs.run(req.params.id, { manual: true });
  res.status(r.ok ? 202 : 400).json(r);
});

// POST /api/ops/jobs/:id/toggle  { enabled }
router.post('/jobs/:id/toggle', (req, res) => {
  const r = jobs.setEnabled(req.params.id, !!(req.body && req.body.enabled));
  res.status(r.ok ? 200 : 400).json(r);
});

// GET /api/ops/jobs/:id/log — last captured output
router.get('/jobs/:id/log', (req, res) => {
  const t = jobs.tail(req.params.id);
  if (t == null) return res.status(404).json({ error: 'no such job' });
  res.json({ output: t });
});

// POST /api/ops/jobs  { name, cmd, schedule?, desc?, group?, cwd?, enabled? }
router.post('/jobs', (req, res) => {
  const r = jobs.add(req.body || {});
  res.status(r.ok ? 201 : 400).json(r);
});

// DELETE /api/ops/jobs/:id — user-created jobs only
router.delete('/jobs/:id', (req, res) => {
  const r = jobs.remove(req.params.id);
  res.status(r.ok ? 200 : 400).json(r);
});

module.exports = router;
