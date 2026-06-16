// WebSocket → TCP proxy for wayvnc on localhost:5900.
// Backpressure-aware: a slow WS client must not make Node buffer the
// framebuffer stream without bound (OOM guard).
const net = require('net');

const VNC_HOST = '127.0.0.1';
const VNC_PORT = 5900;

const WS_HIGH_WATER = 8 * 1024 * 1024;  // pause the Pi→client stream above this
const WS_LOW_WATER  = 2 * 1024 * 1024;  // resume below this
const MAX_PENDING   = 512;              // frames buffered before TCP connects

function handleVncWs(ws) {
  const pending = [];
  const tcp = net.createConnection({ host: VNC_HOST, port: VNC_PORT });

  // Drain the client send buffer: pause wayvnc while the WS is backed up.
  const drainTimer = setInterval(() => {
    if (tcp.isPaused() && ws.bufferedAmount < WS_LOW_WATER) tcp.resume();
  }, 50);

  const cleanup = () => { clearInterval(drainTimer); tcp.destroy(); };

  tcp.on('connect', () => {
    for (const chunk of pending) tcp.write(chunk);
    pending.length = 0;
  });

  tcp.on('data', data => {
    if (ws.readyState !== 1 /* OPEN */) return;
    ws.send(data, { binary: true });
    if (ws.bufferedAmount > WS_HIGH_WATER) tcp.pause();
  });

  tcp.on('close', () => { clearInterval(drainTimer); try { ws.close(); } catch {} });

  tcp.on('error', err => {
    console.error('[vnc] TCP error:', err.message);
    clearInterval(drainTimer);
    try { ws.close(1011, err.message); } catch {}
  });

  ws.on('message', (data, isBinary) => {
    const buf = isBinary ? data : Buffer.from(data);
    if (!tcp.connecting && tcp.writable) {
      tcp.write(buf);
    } else if (pending.length < MAX_PENDING) {
      pending.push(buf);
    } else {
      try { ws.close(1011, 'handshake buffer overflow'); } catch {}
      cleanup();
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

module.exports = { handleVncWs };
