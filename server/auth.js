const { AUTH_TOKEN } = require('./config');

function bearerAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null;
  // Also accept ?token= for browser-initiated GETs (downloads, etc.)
  const fromQuery = req.query?.token || null;
  if (fromHeader === AUTH_TOKEN || fromQuery === AUTH_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function wsAuth(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token') === AUTH_TOKEN;
}

module.exports = { bearerAuth, wsAuth };
