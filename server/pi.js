const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execFileAsync = promisify(execFile);
const router = express.Router();

// ── PM2 ─────────────────────────────────────────────────────────────────
const ALLOWED_PM2_ACTIONS = ['restart', 'stop', 'start', 'flush'];

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

// ── Disk (simple) ────────────────────────────────────────────────────────
router.get('/disk', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('df', ['-h', '/'], { timeout: 5000 });
    const parts = stdout.trim().split('\n')[1].split(/\s+/);
    res.json({ total: parts[1], used: parts[2], avail: parts[3], pct: parts[4] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Storage (all mounts) ─────────────────────────────────────────────────
router.get('/storage', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('df', ['-h', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs'], { timeout: 5000 });
    const lines = stdout.trim().split('\n').slice(1);
    const mounts = lines.map(line => {
      const p = line.trim().split(/\s+/);
      return { fs: p[0], size: p[1], used: p[2], avail: p[3], pct: p[4], mount: p[5] };
    }).filter(m => m.mount && !m.mount.startsWith('/sys') && !m.mount.startsWith('/proc'));
    res.json({ mounts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Network ──────────────────────────────────────────────────────────────
router.get('/network', async (req, res) => {
  try {
    const { stdout: addrOut } = await execFileAsync('ip', ['-j', 'addr'], { timeout: 5000 });
    let ifaces = [];
    try {
      const raw = JSON.parse(addrOut);
      ifaces = raw.filter(i => i.ifname !== 'lo').map(i => ({
        name: i.ifname,
        state: i.operstate,
        mac: i.address,
        addrs: (i.addr_info || [])
          .filter(a => a.family === 'inet' || a.family === 'inet6')
          .map(a => ({ addr: a.local, prefix: a.prefixlen, family: a.family })),
      }));
    } catch {}

    let wifi = null;
    try {
      const { stdout: iwOut } = await execFileAsync('iw', ['dev', 'wlan0', 'link'], { timeout: 3000 });
      if (iwOut.includes('Not connected')) {
        wifi = { connected: false };
      } else {
        const ssid    = (iwOut.match(/SSID: (.+)/)         || [])[1]?.trim();
        const signal  = (iwOut.match(/signal: ([-\d]+)/)   || [])[1];
        const bitrate = (iwOut.match(/tx bitrate: ([\d.]+ \w+)/) || [])[1];
        const freq    = (iwOut.match(/freq: (\d+)/)        || [])[1];
        wifi = { connected: true, ssid, signal: signal ? parseInt(signal) : null, bitrate, freq };
      }
    } catch {}

    res.json({ ifaces, wifi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Top Processes ────────────────────────────────────────────────────────
router.get('/top', async (req, res) => {
  try {
    const { stdout } = await execFileAsync(
      'ps', ['aux', '--sort=-%cpu', '--no-headers', '-ww'],
      { timeout: 5000 }
    );
    const procs = stdout.trim().split('\n').slice(0, 20).map(line => {
      const p = line.trim().split(/\s+/);
      const cmdParts = p.slice(10);
      return {
        user: p[0], pid: p[1],
        cpu: parseFloat(p[2]), mem: parseFloat(p[3]),
        rss: parseInt(p[5]) * 1024,
        cmd: cmdParts.join(' '),
        name: cmdParts[0]?.split('/').pop() || '',
      };
    });
    res.json(procs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── System Info ──────────────────────────────────────────────────────────
router.get('/sysinfo', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      execFileAsync('hostname', [], { timeout: 2000 }),
      execFileAsync('uname', ['-r'], { timeout: 2000 }),
    ]);
    const hostname = results[0].status === 'fulfilled' ? results[0].value.stdout.trim() : '';
    const kernel   = results[1].status === 'fulfilled' ? results[1].value.stdout.trim() : '';

    let osName = '', model = '';
    try {
      const osr = fs.readFileSync('/etc/os-release', 'utf8');
      const m = osr.match(/^PRETTY_NAME="(.+)"/m);
      if (m) osName = m[1];
    } catch {}
    try {
      model = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
    } catch {}

    res.json({ hostname, kernel, osName, model });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Systemd Services ────────────────────────────────────────────────────
const MONITORED_SERVICES = [
  'ssh', 'sshd', 'nginx', 'apache2', 'postgresql', 'mysql', 'mariadb',
  'docker', 'cron', 'crond', 'bluetooth', 'NetworkManager', 'avahi-daemon',
  'cups', 'ufw', 'fail2ban', 'redis', 'redis-server', 'mosquitto',
  'lightdm', 'wpa_supplicant', 'systemd-timesyncd',
];

router.get('/services', async (req, res) => {
  try {
    const results = await Promise.allSettled(
      MONITORED_SERVICES.map(async name => {
        try {
          const { stdout } = await execFileAsync('systemctl', ['is-active', name], { timeout: 3000 });
          return { name, active: stdout.trim() === 'active', status: stdout.trim() };
        } catch (e) {
          const s = (e.stdout || '').trim();
          return { name, active: false, status: s || 'inactive' };
        }
      })
    );
    const services = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(s => s.status !== 'not-found');
    res.json(services);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/service', express.json(), async (req, res) => {
  const { action, name } = req.body || {};
  if (!['start', 'stop', 'restart'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  if (!MONITORED_SERVICES.includes(name)) return res.status(400).json({ error: 'service not in allowlist' });
  try {
    await execFileAsync('sudo', ['systemctl', action, name], { timeout: 15000 });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Logs ─────────────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  const unit  = req.query.unit;

  try {
    if (unit) {
      if (!/^[\w\-. ]+$/.test(unit)) return res.status(400).json({ error: 'invalid unit' });
      const { stdout } = await execFileAsync(
        'pm2', ['logs', unit, '--lines', String(lines), '--nostream', '--no-color'],
        { timeout: 10000 }
      );
      return res.json({ lines: stdout.split('\n').filter(Boolean) });
    }

    const args = ['-n', String(lines), '--no-pager', '-o', 'short-iso', '--no-hostname'];
    if (req.query.priority) args.push('-p', req.query.priority);
    const { stdout } = await execFileAsync('journalctl', args, { timeout: 8000 });
    res.json({ lines: stdout.split('\n').filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Power ────────────────────────────────────────────────────────────────
router.post('/power', express.json(), async (req, res) => {
  const { action } = req.body || {};
  if (!['reboot', 'poweroff'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  res.json({ ok: true, message: `${action} initiated` });
  setTimeout(async () => {
    try { await execFileAsync('sudo', ['systemctl', action], { timeout: 5000 }); }
    catch { try { await execFileAsync('sudo', [action], { timeout: 5000 }); } catch {} }
  }, 600);
});

// ── Docker ───────────────────────────────────────────────────────────────
const ALLOWED_DOCKER_ACTIONS = ['start', 'stop', 'restart'];

router.get('/docker', async (req, res) => {
  try {
    const { stdout } = await execFileAsync(
      'docker', ['ps', '-a', '--format', '{{json .}}'],
      { timeout: 8000 }
    );
    const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      try {
        const c = JSON.parse(line);
        return {
          id: c.ID, name: c.Names, image: c.Image,
          state: c.State, status: c.Status,
          ports: c.Ports, created: c.CreatedAt,
        };
      } catch { return null; }
    }).filter(Boolean);
    res.json(containers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/docker', express.json(), async (req, res) => {
  const { action, id } = req.body || {};
  if (!ALLOWED_DOCKER_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid action' });
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(id))
    return res.status(400).json({ error: 'invalid container id' });
  try {
    await execFileAsync('docker', [action, id], { timeout: 20000 });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/docker/logs', async (req, res) => {
  const id = req.query.id;
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(id))
    return res.status(400).json({ error: 'invalid container id' });
  try {
    const { stdout, stderr } = await execFileAsync(
      'docker', ['logs', '--tail', String(lines), id],
      { timeout: 8000 }
    );
    const combined = (stdout + '\n' + stderr).trim();
    res.json({ lines: combined.split('\n').filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Hardware ─────────────────────────────────────────────────────────────
router.get('/hardware', async (req, res) => {
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  const [cpuFreq, cpuMaxFreq, governor, availGovs, usbOut, vcTemp, vcVolts, vcThrottle, vcGpuMem] = await Promise.all([
    safe(() => fs.promises.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq', 'utf8').then(v => parseInt(v) / 1000)),
    safe(() => fs.promises.readFile('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq', 'utf8').then(v => parseInt(v) / 1000)),
    safe(() => fs.promises.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'utf8').then(v => v.trim())),
    safe(() => fs.promises.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors', 'utf8').then(v => v.trim().split(/\s+/))),
    safe(() => execFileAsync('lsusb', [], { timeout: 4000 }).then(r => r.stdout.trim().split('\n').filter(Boolean).map(l => {
      const m = l.match(/ID [\da-f:]+\s+(.+)/i);
      return m ? m[1].trim() : l.trim();
    }))),
    safe(() => execFileAsync('vcgencmd', ['measure_temp'], { timeout: 2000 }).then(r => parseFloat(r.stdout.match(/([\d.]+)/)?.[1]))),
    safe(() => execFileAsync('vcgencmd', ['measure_volts', 'core'], { timeout: 2000 }).then(r => r.stdout.match(/([\d.]+)V/)?.[1])),
    safe(() => execFileAsync('vcgencmd', ['get_throttled'], { timeout: 2000 }).then(r => r.stdout.match(/0x([\da-fA-F]+)/)?.[0])),
    safe(() => execFileAsync('vcgencmd', ['get_mem', 'gpu'], { timeout: 2000 }).then(r => r.stdout.match(/(\d+M)/)?.[1])),
  ]);

  // Parse CPU info for model/core count
  let cpuModel = '', cores = 0;
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const modelMatch = cpuinfo.match(/Model name\s*:\s*(.+)/i) || cpuinfo.match(/Hardware\s*:\s*(.+)/i);
    if (modelMatch) cpuModel = modelMatch[1].trim();
    cores = (cpuinfo.match(/^processor\s*:/gm) || []).length;
  } catch {}

  // Decode throttle flags
  const throttleVal = vcThrottle ? parseInt(vcThrottle, 16) : 0;
  const throttleFlags = [];
  if (throttleVal & 0x1) throttleFlags.push('Under-voltage');
  if (throttleVal & 0x2) throttleFlags.push('Freq capped');
  if (throttleVal & 0x4) throttleFlags.push('Throttled');
  if (throttleVal & 0x8) throttleFlags.push('Temp limit');
  if (throttleVal & 0x10000) throttleFlags.push('Was under-voltage');
  if (throttleVal & 0x20000) throttleFlags.push('Was freq capped');
  if (throttleVal & 0x40000) throttleFlags.push('Was throttled');

  res.json({
    cpuModel, cores,
    cpuFreqMHz: cpuFreq, cpuMaxMHz: cpuMaxFreq,
    governor, availGovs,
    vcTemp, vcVolts, vcGpuMem,
    throttle: { raw: vcThrottle, flags: throttleFlags, ok: throttleFlags.length === 0 },
    usb: usbOut || [],
  });
});

router.post('/hardware/governor', express.json(), async (req, res) => {
  const { governor } = req.body || {};
  const allowed = ['ondemand', 'performance', 'powersave', 'schedutil', 'conservative'];
  if (!allowed.includes(governor)) return res.status(400).json({ error: 'invalid governor' });
  try {
    // Write to all CPU cores
    const cpuCount = parseInt((await execFileAsync('nproc', [], { timeout: 2000 })).stdout) || 4;
    for (let i = 0; i < cpuCount; i++) {
      await fs.promises.writeFile(
        `/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_governor`,
        governor
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Cron Jobs ────────────────────────────────────────────────────────────
router.get('/cron', async (req, res) => {
  const results = { user: [], system: [] };
  try {
    const { stdout } = await execFileAsync('crontab', ['-l'], { timeout: 3000 });
    results.user = parseCrontab(stdout);
  } catch {}
  try {
    const files = fs.readdirSync('/etc/cron.d').filter(f => !f.startsWith('.'));
    for (const f of files.slice(0, 20)) {
      try {
        const content = fs.readFileSync(`/etc/cron.d/${f}`, 'utf8');
        const entries = parseCrontab(content, f);
        results.system.push(...entries);
      } catch {}
    }
  } catch {}
  // Also /etc/crontab
  try {
    const content = fs.readFileSync('/etc/crontab', 'utf8');
    results.system.push(...parseCrontab(content, 'crontab'));
  } catch {}
  res.json(results);
});

function parseCrontab(text, source) {
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('@')) {
      const parts = trimmed.split(/\s+/);
      entries.push({ schedule: parts[0], cmd: parts.slice(1).join(' '), source });
    } else {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 6) {
        entries.push({
          schedule: parts.slice(0, 5).join(' '),
          cmd: parts.slice(5).join(' '),
          source,
        });
      }
    }
  }
  return entries;
}

module.exports = router;
