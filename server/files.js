const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { ROOT_DIR } = require('./config');

const router = express.Router();
const upload = multer({ dest: '/tmp/stan-cli-uploads/' });
const MAX_INLINE = 5 * 1024 * 1024; // 5 MB

function jail(reqPath) {
  const resolved = path.resolve(ROOT_DIR, reqPath.replace(/^\//, ''));
  if (!resolved.startsWith(ROOT_DIR + path.sep) && resolved !== ROOT_DIR) {
    return null;
  }
  return resolved;
}

function jailOrFail(res, reqPath) {
  const p = jail(reqPath || '');
  if (!p) { res.status(400).json({ error: 'Path outside ROOT_DIR' }); return null; }
  return p;
}

router.get('/list', (req, res) => {
  const p = jailOrFail(res, req.query.path);
  if (!p) return;
  let entries;
  try { entries = fs.readdirSync(p, { withFileTypes: true }); }
  catch (e) { return res.status(404).json({ error: e.message }); }
  const result = entries.map((e) => {
    const full = path.join(p, e.name);
    let size = 0, mtime = 0;
    try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs; } catch {}
    return { name: e.name, type: e.isDirectory() ? 'dir' : 'file', size, mtime };
  }).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  res.json(result);
});

router.get('/read', (req, res) => {
  const p = jailOrFail(res, req.query.path);
  if (!p) return;
  let stat;
  try { stat = fs.statSync(p); } catch (e) { return res.status(404).json({ error: e.message }); }
  if (stat.size > MAX_INLINE) return res.status(413).json({ error: 'File too large for inline read; use /download' });
  res.sendFile(p);
});

router.put('/write', express.json({ limit: '5mb' }), (req, res) => {
  const { path: reqPath, content } = req.body || {};
  const p = jailOrFail(res, reqPath);
  if (!p) return;
  if (content === undefined) return res.status(400).json({ error: 'content required' });
  const tmp = p + '.k2tmp';
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, p);
    res.json({ ok: true });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    res.status(500).json({ error: e.message });
  }
});

router.post('/mkdir', express.json(), (req, res) => {
  const p = jailOrFail(res, req.body?.path);
  if (!p) return;
  try { fs.mkdirSync(p, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/rename', express.json(), (req, res) => {
  const from = jailOrFail(res, req.body?.from);
  if (!from) return;
  const to = jailOrFail(res, req.body?.to);
  if (!to) return;
  try { fs.renameSync(from, to); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/', (req, res) => {
  const p = jailOrFail(res, req.query.path);
  if (!p) return;
  try {
    fs.rmSync(p, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const destDir = jailOrFail(res, req.body?.path || '');
  if (!destDir) { fs.unlinkSync(req.file.path); return; }
  const dest = path.join(destDir, req.file.originalname);
  if (!dest.startsWith(ROOT_DIR)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Path outside ROOT_DIR' });
  }
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(req.file.path, dest);
    res.json({ ok: true, name: req.file.originalname });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: e.message });
  }
});

router.get('/download', (req, res) => {
  const p = jailOrFail(res, req.query.path);
  if (!p) return;
  res.download(p, path.basename(p), (e) => {
    if (e && !res.headersSent) res.status(500).json({ error: e.message });
  });
});

module.exports = router;
