const express = require('express');
const http = require('http');
const https = require('https');
const { OLLAMA_URL } = require('./config');

const router = express.Router();

function ollamaRequest(path, options, body, res) {
  const url = new URL(path, OLLAMA_URL);
  const lib = url.protocol === 'https:' ? https : http;
  const reqOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: options.method || 'GET',
    headers: options.headers || {},
  };
  const proxyReq = lib.request(reqOptions, (proxyRes) => {
    res.status(proxyRes.statusCode);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) res.setHeader(k, v);
    });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ error: 'Ollama unreachable: ' + e.message });
  });
  if (body) proxyReq.write(body);
  proxyReq.end();
}

router.get('/models', (req, res) => {
  ollamaRequest('/api/tags', { method: 'GET' }, null, res);
});

router.post('/chat', express.json({ limit: '1mb' }), (req, res) => {
  const { model, messages } = req.body || {};
  if (!model || !messages) return res.status(400).json({ error: 'model and messages required' });
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    system: 'You are an assistant running on the kay2 Raspberry Pi. When you suggest shell commands, format them in a fenced code block with the sh language tag.',
  });
  ollamaRequest('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body, res);
});

module.exports = router;
