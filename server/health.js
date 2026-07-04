const express = require('express');
const http = require('http');
const https = require('https');
const { OLLAMA_URL } = require('./config');

const router = express.Router();

let _ollamaCache = { online: false, models: 0, checkedAt: 0 };
const OLLAMA_CACHE_MS = 10_000;

function checkOllama(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const url = new URL('/api/tags', OLLAMA_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            online: res.statusCode === 200,
            models: (data.models || []).length,
          });
        } catch {
          resolve({ online: false, models: 0 });
        }
      });
    });
    req.on('error', () => resolve({ online: false, models: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ online: false, models: 0 }); });
    req.end();
  });
}

async function ollamaStatus() {
  if (Date.now() - _ollamaCache.checkedAt < OLLAMA_CACHE_MS) {
    return { online: _ollamaCache.online, models: _ollamaCache.models };
  }
  const result = await checkOllama();
  _ollamaCache = { ...result, checkedAt: Date.now() };
  return result;
}

router.get('/', async (req, res) => {
  const ollama = await ollamaStatus();
  res.json({
    server: 'online',
    ollama: ollama.online ? 'online' : 'offline',
    models: ollama.models,
  });
});

module.exports = router;
module.exports.checkOllama = checkOllama;
module.exports.ollamaStatus = ollamaStatus;
