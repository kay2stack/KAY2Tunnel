const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { PORT } = require('./config');

const execFileAsync = promisify(execFile);
const router = express.Router();

const DIAG_DIR = path.join(os.homedir(), 'pi-diagnostics');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

function run(cmd, args = [], opts = {}) {
  return execFileAsync(cmd, args, {
    timeout: opts.timeout || 8000,
    maxBuffer: 2 * 1024 * 1024,
    ...opts,
  }).then(r => (r.stdout || '').trim()).catch(() => null);
}

function runShell(script, args = []) {
  return execFileAsync('bash', [path.join(SCRIPTS_DIR, script), ...args], {
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  }).then(r => r.stdout || '').catch(err => {
    throw new Error((err.stderr || err.message || 'script failed').trim());
  });
}

async function readProc(key) {
  try {
    return fs.readFileSync(`/proc/${key}`, 'utf8').trim();
  } catch {
    return null;
  }
}

function parseMeminfo(raw) {
  if (!raw) return {};
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) out[m[1]] = parseInt(m[2], 10);
  }
  return out;
}

function parseThrottled(hexStr) {
  const m = (hexStr || '').match(/0x([0-9a-f]+)/i);
  if (!m) return { raw: hexStr, undervoltage: false, throttled: false, freqCapped: false };
  const v = parseInt(m[1], 16);
  return {
    raw: hexStr,
    undervoltage: !!(v & 0x1) || !!(v & 0x10000),
    throttled: !!(v & 0x4) || !!(v & 0x40000),
    freqCapped: !!(v & 0x2) || !!(v & 0x20000),
    everUndervoltage: !!(v & 0x10000),
    everThrottled: !!(v & 0x40000),
  };
}

function parseTemp(raw) {
  const m = (raw || '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

async function getPiMetrics() {
  const throttledRaw = await run('vcgencmd', ['get_throttled']);
  const tempRaw = await run('vcgencmd', ['measure_temp']);
  const voltsRaw = await run('vcgencmd', ['measure_volts', 'core']);
  return {
    available: !!throttledRaw || !!tempRaw,
    throttled: parseThrottled(throttledRaw),
    tempC: parseTemp(tempRaw),
    coreVolts: parseTemp(voltsRaw),
  };
}

async function getTailscale() {
  const version = await run('tailscale', ['version']);
  if (!version) return { installed: false, active: false, enabled: false };

  const [status, ip, serve, active, enabled] = await Promise.all([
    run('tailscale', ['status', '--json']).then(async json => {
      if (!json) return run('tailscale', ['status']);
      try {
        const data = JSON.parse(json);
        const self = data.Self || {};
        return {
          online: self.Online,
          hostname: self.HostName,
          tailscaleIPs: self.TailscaleIPs || [],
          peers: Object.keys(data.Peer || {}).length,
        };
      } catch {
        return json;
      }
    }),
    run('tailscale', ['ip', '-4']),
    run('tailscale', ['serve', 'status']),
    run('systemctl', ['is-active', 'tailscaled']),
    run('systemctl', ['is-enabled', 'tailscaled']),
  ]);

  const serveActive = serve && !serve.includes('No serve config');
  return {
    installed: true,
    active: active === 'active',
    enabled: enabled === 'enabled',
    version: version.split('\n')[0],
    ip: ip || null,
    serveActive,
    serveStatus: serve,
    status,
  };
}

async function getPm2() {
  const raw = await run('pm2', ['jlist']);
  if (!raw) return { installed: false, processes: [] };
  try {
    const list = JSON.parse(raw);
    return {
      installed: true,
      processes: list.map(p => ({
        name: p.name,
        status: p.pm2_env?.status,
        restarts: p.pm2_env?.restart_time,
        memory: p.monit?.memory,
        cpu: p.monit?.cpu,
      })),
    };
  } catch {
    return { installed: true, processes: [], raw };
  }
}

async function getRebootHistory() {
  const raw = await run('last', ['-x', 'reboot', 'shutdown'], { timeout: 5000 });
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).slice(0, 8).map(line => {
    const parts = line.split(/\s+/);
    return { line: line.trim() };
  });
}

async function getOomEvents() {
  const journal = await run('journalctl', ['-k', '--since', '7 days ago', '--no-pager'], { timeout: 15000 });
  if (!journal) return [];
  return journal
    .split('\n')
    .filter(l => /oom|killed process|out of memory/i.test(l))
    .slice(-10);
}

async function getTopProcesses() {
  const raw = await run('ps', ['aux', '--sort=-%mem'], { timeout: 5000 });
  if (!raw) return [];
  return raw.split('\n').slice(1, 11).map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      user: parts[0],
      pid: parts[1],
      memPct: parts[3],
      command: parts.slice(10).join(' ').slice(0, 80),
    };
  });
}

async function getDisk() {
  const raw = await run('df', ['-h', '/'], { timeout: 3000 });
  if (!raw) return null;
  const line = raw.split('\n')[1];
  if (!line) return null;
  const parts = line.split(/\s+/);
  return {
    size: parts[1],
    used: parts[2],
    avail: parts[3],
    usePct: parseInt(parts[4], 10) || 0,
    mount: parts[5],
  };
}

async function getNetwork() {
  const [addrs, route, pingOk] = await Promise.all([
    run('ip', ['-br', 'addr']),
    run('ip', ['route']),
    run('ping', ['-c', '1', '-W', '2', '8.8.8.8']).then(r => !!r),
  ]);
  const lanIp = (addrs || '').split('\n')
    .flatMap(l => l.split(/\s+/).slice(2))
    .find(a => a && !a.startsWith('127.') && a.includes('.')) || null;
  return { addrs, route, internetOk: pingOk, lanIp };
}

function buildIssues(snapshot) {
  const issues = [];

  if (snapshot.pi.available) {
    if (snapshot.pi.throttled.undervoltage || snapshot.pi.throttled.everUndervoltage) {
      issues.push({
        id: 'undervoltage',
        severity: 'critical',
        title: 'Power undervoltage detected',
        detail: 'The Pi has seen low voltage. Use an official 5V/3A+ PSU and a short, thick USB-C cable.',
        action: null,
      });
    }
    if (snapshot.pi.throttled.throttled || snapshot.pi.throttled.everThrottled) {
      issues.push({
        id: 'thermal-throttle',
        severity: 'warning',
        title: 'Thermal throttling',
        detail: 'CPU has been throttled due to heat. Improve airflow or add a heatsink/fan.',
        action: null,
      });
    }
    if (snapshot.pi.tempC != null && snapshot.pi.tempC > 78) {
      issues.push({
        id: 'high-temp',
        severity: 'warning',
        title: `CPU temperature ${snapshot.pi.tempC.toFixed(1)}°C`,
        detail: 'Running hot. Check case ventilation.',
        action: null,
      });
    }
  }

  if (snapshot.memory.usePct > 90) {
    issues.push({
      id: 'memory-high',
      severity: 'warning',
      title: `Memory ${snapshot.memory.usePct}% used`,
      detail: 'High RAM pressure. Ollama or agents may trigger OOM kills.',
      action: 'restart-pm2',
    });
  }

  if (snapshot.disk && snapshot.disk.usePct > 90) {
    issues.push({
      id: 'disk-full',
      severity: 'warning',
      title: `Disk ${snapshot.disk.usePct}% full`,
      detail: 'Free space on root filesystem before SD wear or write failures.',
      action: null,
    });
  }

  if (snapshot.oomEvents.length > 0) {
    issues.push({
      id: 'oom',
      severity: 'critical',
      title: `${snapshot.oomEvents.length} OOM event(s) in recent logs`,
      detail: 'The kernel killed processes for lack of memory. Reduce model size or stop heavy services.',
      action: 'restart-pm2',
    });
  }

  if (snapshot.rebootHistory.length >= 4) {
    issues.push({
      id: 'reboot-loop',
      severity: 'warning',
      title: 'Frequent reboots',
      detail: 'Multiple reboots recorded. Run a full diagnostic snapshot and isolate Tailscale.',
      action: 'diagnose',
    });
  }

  if (snapshot.tailscale.installed && !snapshot.tailscale.active) {
    issues.push({
      id: 'tailscale-off',
      severity: 'info',
      title: 'Tailscale is stopped',
      detail: 'Remote access via tailnet is unavailable. LAN and local access still work.',
      action: 'tailscale-enable',
    });
  }

  const stan = snapshot.pm2.processes.find(p => p.name === 'stan-cli');
  if (snapshot.pm2.installed && (!stan || stan.status !== 'online')) {
    issues.push({
      id: 'stan-down',
      severity: 'critical',
      title: 'Stan CLI not running',
      detail: 'PM2 process stan-cli is offline.',
      action: 'restart-pm2',
    });
  }

  return issues;
}

function computeScore(snapshot, issues) {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 25;
    else if (issue.severity === 'warning') score -= 12;
    else score -= 3;
  }
  if (snapshot.pi.tempC != null && snapshot.pi.tempC > 70) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function grade(score) {
  if (score >= 85) return { label: 'Healthy', color: 'green' };
  if (score >= 60) return { label: 'Degraded', color: 'amber' };
  return { label: 'Critical', color: 'red' };
}

async function collectHealth() {
  const uptimeSec = os.uptime();
  const loadavg = os.loadavg();
  const memRaw = parseMeminfo(await readProc('meminfo'));
  const memTotal = memRaw.MemTotal || os.totalmem() / 1024;
  const memAvail = memRaw.MemAvailable || os.freemem() / 1024;
  const memUsed = memTotal - memAvail;

  const [pi, tailscale, pm2, rebootHistory, oomEvents, topProcesses, disk, network] =
    await Promise.all([
      getPiMetrics(),
      getTailscale(),
      getPm2(),
      getRebootHistory(),
      getOomEvents(),
      getTopProcesses(),
      getDisk(),
      getNetwork(),
    ]);

  const snapshot = {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    uptime: {
      seconds: uptimeSec,
      human: formatUptime(uptimeSec),
    },
    load: { '1m': loadavg[0], '5m': loadavg[1], '15m': loadavg[2] },
    memory: {
      totalKb: memTotal,
      availKb: memAvail,
      usedKb: memUsed,
      usePct: Math.round((memUsed / memTotal) * 100),
      totalHuman: kbHuman(memTotal),
      usedHuman: kbHuman(memUsed),
    },
    disk,
    network,
    pi,
    tailscale,
    pm2,
    port7420: await checkPort7420(),
    rebootHistory,
    oomEvents,
    topProcesses,
  };

  const issues = buildIssues(snapshot);
  const score = computeScore(snapshot, issues);
  const health = grade(score);

  return { score, health, issues, ...snapshot };
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function kbHuman(kb) {
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

async function checkPort7420() {
  const raw = await run('ss', ['-tlnp']);
  return raw ? raw.includes(':7420') || raw.includes(`:${PORT}`) : false;
}

function summaryFrom(full) {
  return {
    timestamp: full.timestamp,
    score: full.score,
    health: full.health,
    issueCount: full.issues.length,
    criticalCount: full.issues.filter(i => i.severity === 'critical').length,
    uptime: full.uptime,
    tempC: full.pi.tempC,
    memoryUsePct: full.memory.usePct,
    diskUsePct: full.disk?.usePct ?? null,
    tailscale: {
      active: full.tailscale.active,
      ip: full.tailscale.ip,
      serveActive: full.tailscale.serveActive,
    },
    stanOnline: full.pm2.processes.some(p => p.name === 'stan-cli' && p.status === 'online'),
    internetOk: full.network.internetOk,
    lanIp: full.network.lanIp,
  };
}

router.get('/', async (req, res) => {
  try {
    res.json(await collectHealth());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    res.json(summaryFrom(await collectHealth()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshot', async (req, res) => {
  try {
    const out = await runShell('pi-diagnose-reboots.sh');
    const match = out.match(/Report saved:\s*(.+)/);
    res.json({ ok: true, report: match ? match[1].trim() : null, output: out.slice(-500) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/actions/:action', async (req, res) => {
  const { action } = req.params;
  const confirm = req.body?.confirm === true;

  try {
    switch (action) {
      case 'tailscale-disable': {
        if (!confirm) return res.status(400).json({ error: 'Set confirm:true to disable Tailscale' });
        const out = await runShell('pi-remove-tailscale.sh');
        res.json({ ok: true, message: 'Tailscale stopped and disabled', output: out.slice(-400) });
        break;
      }
      case 'tailscale-enable': {
        if (!confirm) return res.status(400).json({ error: 'Set confirm:true to enable Tailscale' });
        await run('sudo', ['systemctl', 'enable', '--now', 'tailscaled']);
        await run('sudo', ['tailscale', 'up']);
        await run('sudo', ['tailscale', 'serve', '--bg', String(PORT)]);
        const ts = await getTailscale();
        res.json({ ok: true, message: 'Tailscale enabled', tailscale: ts });
        break;
      }
      case 'restart-pm2': {
        await run('pm2', ['restart', 'stan-cli']);
        res.json({ ok: true, message: 'stan-cli restarted' });
        break;
      }
      case 'pm2-save': {
        await run('pm2', ['save']);
        res.json({ ok: true, message: 'PM2 state saved' });
        break;
      }
      default:
        res.status(404).json({ error: 'Unknown action' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports', async (req, res) => {
  try {
    if (!fs.existsSync(DIAG_DIR)) return res.json([]);
    const files = fs.readdirSync(DIAG_DIR)
      .filter(f => f.endsWith('.txt'))
      .map(f => {
        const fp = path.join(DIAG_DIR, f);
        const st = fs.statSync(fp);
        return { name: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime))
      .slice(0, 20);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.collectHealth = collectHealth;
