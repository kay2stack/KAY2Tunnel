const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { PORT, HOST } = require('./config');
const { bearerAuth, wsAuth } = require('./auth');
const { handleWs, listSessions } = require('./terminal');
const filesRouter = require('./files');
const aiRouter = require('./ai');
const agentsRouter = require('./agents');
const projectsRouter = require('./projects');
const diffRouter = require('./diff');
const piRouter = require('./pi');
const browserRouter = require('./browser');
const system = require('./system');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', bearerAuth);
app.use('/api/files', filesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/diff', diffRouter);
app.use('/api/pi', piRouter);
app.use('/api/browser', browserRouter);
app.get('/api/system', (req, res) => res.json({ cpu: system.cpu(), mem: system.mem(), load: system.load(), temp: system.temp(), uptime: system.uptime() }));
app.get('/api/term/sessions', (req, res) => res.json(listSessions()));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws/term')) { socket.destroy(); return; }
  if (!wsAuth(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => handleWs(ws, req));
});

server.listen(PORT, HOST, () => console.log(`Stan CLI v1.0.0 — http://${HOST}:${PORT}`));
