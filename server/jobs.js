// Stan CLI — Job Runner. A self-contained automation layer StanCLI *owns* (kept
// deliberately separate from the shared crontab / Hermes cron, which drive Clive &
// GLINT and must not be mutated from the PWA).
//
// A job = { id, name, desc, group, cmd, cwd, schedule, enabled, builtin, + run state }.
// Jobs are defined in DEFAULT_JOBS and/or added at runtime; the registry persists to
// server/jobs.state.json. An in-process cron scheduler (60s tick) fires due jobs.
//
// Scripts talk back to the notifier without needing the auth token, via stdout lines:
//   @@PUSH: some message      → forwarded as a web-push notification
//   @@QUIET                   → suppress the automatic failure push for this run
// and a non-zero exit also pushes a failure alert (unless @@QUIET).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const push = require('./push');

const PROJECT = path.join(__dirname, '..');
const STATE_FILE = path.join(__dirname, 'jobs.state.json');
const OUT_CAP = 32 * 1024;          // per-run captured-output cap
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

// ── seed jobs ───────────────────────────────────────────────────────────────
// builtin:true jobs can't be deleted from the UI (only toggled / run). cmd runs
// under `bash -lc` with cwd = the project root, so `scripts/x.sh` resolves.
const DEFAULT_JOBS = [
  { id: 'pi-health', name: 'Pi health check', group: 'ops', builtin: true,
    desc: 'Disk / memory / CPU temp / load. Pushes an alert only when a threshold is crossed.',
    cmd: 'bash scripts/pi-health.sh', schedule: '*/30 * * * *', enabled: true },
  { id: 'agent-watchdog', name: 'Agent watchdog', group: 'ops', builtin: true,
    desc: 'Restarts any pm2 agent in the "errored" (crashed) state — never touches intentionally-stopped ones. Pushes on action.',
    cmd: 'bash scripts/agent-watchdog.sh', schedule: '*/5 * * * *', enabled: true },
  { id: 'pi-backup', name: 'Nightly backup', group: 'ops', builtin: true,
    desc: 'Backs up Claude memory, Hermes config, crontab & StanCLI .env to ~/backups (prunes >14d). Quiet unless it fails.',
    cmd: 'bash scripts/pi-backup.sh', schedule: '15 4 * * *', enabled: true },
  { id: 'clive-digest', name: 'Clive digest', group: 'crypto', builtin: true,
    desc: 'Summarises the Clive/TrenchesAI cron logs (income-runner, token scans, positions) into one push.',
    cmd: 'bash scripts/clive-digest.sh', schedule: null, enabled: false },
  { id: 'phone-routine', name: 'Phone routine (thermal-safe)', group: 'phone', builtin: true,
    desc: 'Runs a DroidLoop task only when the phone is connected and cool; no-ops when unplugged or hot. Scaffold — set the GOAL.',
    cmd: 'bash scripts/phone-routine.sh', schedule: null, enabled: false },
  { id: 'clip-pipeline', name: 'Clive Clips pipeline', group: 'content', builtin: true,
    desc: 'Generate + stage a clip for YouTube (Clive Clips) / TikTok (CliveAIClips). Scaffold — fill in render/post steps.',
    cmd: 'bash scripts/clip-pipeline.sh', schedule: null, enabled: false },
];

// ── registry (definitions + persisted run state) ─────────────────────────────
let jobs = [];
const running = new Map();   // id -> { child, startedAt }

function loadState() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  const savedJobs = Array.isArray(saved.jobs) ? saved.jobs : [];
  const byId = new Map(savedJobs.map(j => [j.id, j]));
  // builtins: definition from code, run-state + enabled/schedule overrides from disk
  jobs = DEFAULT_JOBS.map(def => {
    const s = byId.get(def.id) || {};
    byId.delete(def.id);
    return { ...def, ...pickState(s), enabled: s.enabled ?? def.enabled, schedule: s.schedule ?? def.schedule };
  });
  // user-created jobs (anything left that isn't a builtin)
  for (const s of byId.values()) if (s && s.id && !s.builtin) jobs.push({ ...s, builtin: false });
}

function pickState(s) {
  const { lastRun, lastStatus, lastExit, lastDurationMs, lastOutput, runs } = s;
  return { lastRun, lastStatus, lastExit, lastDurationMs, lastOutput, runs };
}

function save() {
  const out = { jobs: jobs.map(j => ({ ...j })) };
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2)); } catch {}
}

const find = id => jobs.find(j => j.id === id);

function publicJob(j) {
  return {
    id: j.id, name: j.name, desc: j.desc || '', group: j.group || 'other',
    cmd: j.cmd, cwd: j.cwd || '~', schedule: j.schedule || null,
    enabled: j.enabled !== false, builtin: !!j.builtin,
    running: running.has(j.id),
    lastRun: j.lastRun || null, lastStatus: j.lastStatus || null,
    lastExit: j.lastExit ?? null, lastDurationMs: j.lastDurationMs ?? null,
    runs: j.runs || 0,
  };
}

const list = () => jobs.map(publicJob);
const tail = id => { const j = find(id); return j ? (j.lastOutput || '') : null; };

// ── runner ───────────────────────────────────────────────────────────────────
function run(id, { manual = false } = {}) {
  const j = find(id);
  if (!j) return { ok: false, error: 'no such job' };
  if (running.has(id)) return { ok: false, error: 'already running' };

  const startedAt = Date.now();
  const cwd = j.cwd && j.cwd !== '~' ? j.cwd : PROJECT;
  const child = spawn('bash', ['-lc', j.cmd], { cwd, env: process.env });
  running.set(id, { child, startedAt });

  let buf = '';
  const grab = d => { buf += d.toString(); if (buf.length > OUT_CAP) buf = buf.slice(-OUT_CAP); };
  child.stdout.on('data', grab);
  child.stderr.on('data', grab);

  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, RUN_TIMEOUT_MS);

  child.on('close', code => {
    clearTimeout(timer);
    running.delete(id);
    const dur = Date.now() - startedAt;
    j.lastRun = new Date(startedAt).toISOString();
    j.lastExit = code;
    j.lastStatus = code === 0 ? 'ok' : 'fail';
    j.lastDurationMs = dur;
    j.lastOutput = buf.slice(-OUT_CAP);
    j.runs = (j.runs || 0) + 1;
    save();

    const quiet = /^@@QUIET\b/m.test(buf);
    // forward explicit @@PUSH: lines from the script
    for (const m of buf.matchAll(/^@@PUSH:\s*(.+)$/gm)) {
      fire(j, m[1].trim());
    }
    // failure alert (scheduled or manual) unless silenced
    if (code !== 0 && !quiet) {
      const why = lastLine(buf) || `exit ${code}`;
      fire(j, `⚠️ ${j.name} failed — ${why}`);
    }
  });

  child.on('error', err => {
    clearTimeout(timer);
    running.delete(id);
    j.lastRun = new Date(startedAt).toISOString();
    j.lastStatus = 'fail'; j.lastExit = -1; j.lastDurationMs = Date.now() - startedAt;
    j.lastOutput = 'spawn error: ' + err.message; save();
    fire(j, `⚠️ ${j.name} couldn't start — ${err.message}`);
  });

  return { ok: true, started: true };
}

const GROUP_TITLE = { ops: 'Pi Ops', phone: 'Phone', content: 'Clips', crypto: 'Clive' };
function fire(j, body) {
  push.notify({ title: GROUP_TITLE[j.group] || 'StanCLI', body, tag: 'job-' + j.id, url: '/' }).catch(() => {});
}
function lastLine(s) {
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean).filter(l => !l.startsWith('@@'));
  return lines[lines.length - 1] || '';
}

// ── mutations ────────────────────────────────────────────────────────────────
function setEnabled(id, on) {
  const j = find(id); if (!j) return { ok: false, error: 'no such job' };
  j.enabled = !!on; save(); return { ok: true, job: publicJob(j) };
}

function add({ name, desc, cmd, schedule, group, cwd, enabled }) {
  if (!name || !cmd) return { ok: false, error: 'name and cmd are required' };
  if (schedule && !validCron(schedule)) return { ok: false, error: 'invalid cron (need 5 fields)' };
  const base = slug(name) || 'job';
  let id = base, n = 2;
  while (find(id)) id = `${base}-${n++}`;
  const job = { id, name, desc: desc || '', group: group || 'other', cmd,
    cwd: cwd || '~', schedule: schedule || null, enabled: enabled !== false, builtin: false, runs: 0 };
  jobs.push(job); save();
  return { ok: true, job: publicJob(job) };
}

function remove(id) {
  const j = find(id); if (!j) return { ok: false, error: 'no such job' };
  if (j.builtin) return { ok: false, error: 'built-in jobs can be disabled but not deleted' };
  if (running.has(id)) { try { running.get(id).child.kill('SIGKILL'); } catch {} running.delete(id); }
  jobs = jobs.filter(x => x.id !== id); save();
  return { ok: true };
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

// ── minimal cron (5-field: min hour dom mon dow) ──────────────────────────────
function matchField(expr, val, min, max) {
  if (expr === '*' || expr === '?') return true;
  return expr.split(',').some(part => {
    let step = 1, range = part;
    const slash = part.split('/');
    if (slash.length === 2) { range = slash[0]; step = parseInt(slash[1], 10) || 1; }
    let lo, hi;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) { const [a, b] = range.split('-'); lo = +a; hi = +b; }
    else { lo = hi = +range; }
    if (Number.isNaN(lo) || Number.isNaN(hi)) return false;
    for (let v = lo; v <= hi; v += step) if (v === val) return true;
    return false;
  });
}
function validCron(expr) {
  return typeof expr === 'string' && expr.trim().split(/\s+/).length === 5;
}
function cronDue(expr, d) {
  if (!validCron(expr)) return false;
  const [mi, ho, dom, mo, dow] = expr.trim().split(/\s+/);
  return matchField(mi, d.getMinutes(), 0, 59)
    && matchField(ho, d.getHours(), 0, 23)
    && matchField(dom, d.getDate(), 1, 31)
    && matchField(mo, d.getMonth() + 1, 1, 12)
    && matchField(dow, d.getDay(), 0, 6);
}

// next-run estimate (scan forward up to ~32 days of minutes) — for the UI only
function nextRun(expr, from = new Date()) {
  if (!validCron(expr)) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 46080; i++) { // 32 days
    if (cronDue(expr, d)) return d.toISOString();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

// ── scheduler ─────────────────────────────────────────────────────────────────
let _tick = null;
let _firstTimer = null;
let _lastMin = '';
function start() {
  loadState();
  const tick = () => {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (key === _lastMin) return;     // never fire a job twice in the same minute
    _lastMin = key;
    for (const j of jobs) {
      if (j.enabled !== false && j.schedule && !running.has(j.id) && cronDue(j.schedule, now)) {
        run(j.id, { manual: false });
      }
    }
  };
  _tick = setInterval(tick, 20000);   // check 3×/min; the minute-key guard dedupes
  _firstTimer = setTimeout(tick, 5000);
  console.log(`[jobs] runner up — ${jobs.length} jobs (${jobs.filter(j => j.enabled !== false && j.schedule).length} scheduled)`);
}
function stop() {
  if (_tick) clearInterval(_tick); _tick = null;
  if (_firstTimer) clearTimeout(_firstTimer); _firstTimer = null;
}

module.exports = { start, stop, list, run, setEnabled, add, remove, tail, nextRun };
