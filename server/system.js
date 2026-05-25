const fs = require('fs');

let _prev = null;

function cpu() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const vals = line.split(/\s+/).slice(1).map(Number);
    const idle  = vals[3] + (vals[4] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    if (!_prev) { _prev = { idle, total }; return 0; }
    const di = idle - _prev.idle, dt = total - _prev.total;
    _prev = { idle, total };
    return dt === 0 ? 0 : +((1 - di / dt) * 100).toFixed(1);
  } catch { return 0; }
}

function mem() {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = k => parseInt(m.match(new RegExp(k + ':\\s+(\\d+)'))[1]) * 1024;
    const total = get('MemTotal'), avail = get('MemAvailable');
    return { total, used: total - avail, pct: +((1 - avail / total) * 100).toFixed(1) };
  } catch { return { total: 0, used: 0, pct: 0 }; }
}

function load() {
  try {
    return fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number);
  } catch { return [0, 0, 0]; }
}

function temp() {
  try {
    return +(parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000).toFixed(1);
  } catch { return null; }
}

function uptime() {
  try { return +fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]; }
  catch { return 0; }
}

module.exports = { cpu, mem, load, temp, uptime };
