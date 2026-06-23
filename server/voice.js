// server/voice.js — on-device speech-to-text for the StanChat composer.
//
// Fully local (nothing leaves the Pi): a phone records audio → we transcode with
// ffmpeg to the 16kHz mono WAV whisper.cpp wants → run the whisper-cli binary →
// return text the composer drops into the prompt. iOS Safari's MediaRecorder
// emits mp4/webm; ffmpeg normalizes either.
//
// Engine: ~/whisper.cpp (built from source, base.en model). If it isn't present
// the routes report unavailable and the client just hides the mic button.

const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const WHISPER = path.join(HOME, 'whisper.cpp', 'build', 'bin', 'whisper-cli');
const MODEL = path.join(HOME, 'whisper.cpp', 'models', 'ggml-base.en.bin');
const TMP = '/tmp/stan-voice';
try { fs.mkdirSync(TMP, { recursive: true }); } catch {}
const upload = multer({ dest: TMP + '/', limits: { fileSize: 20 * 1024 * 1024 } });

function available() {
  try { return fs.existsSync(WHISPER) && fs.existsSync(MODEL); } catch { return false; }
}

// Anything iOS/Android records → 16kHz mono 16-bit PCM WAV.
function toWav(input, output) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output],
      { timeout: 30000 }, e => (e ? reject(e) : resolve(output)));
  });
}

function transcribe(wav) {
  return new Promise((resolve, reject) => {
    // -nt: no timestamps · -np: no progress prints · -l en. Transcript → stdout.
    execFile(WHISPER, ['-m', MODEL, '-f', wav, '-nt', '-np', '-l', 'en'],
      { timeout: 120000, maxBuffer: 4 << 20 }, (e, stdout) => {
        if (e) return reject(e);
        resolve(String(stdout || '').replace(/\s+/g, ' ').trim());
      });
  });
}

function rm(p) { if (p) { try { fs.unlinkSync(p); } catch {} } }

const router = express.Router();
router.get('/status', (req, res) => res.json({ available: available() }));
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!available()) { rm(req.file && req.file.path); return res.status(503).json({ error: 'stt-unavailable' }); }
  if (!req.file) return res.status(400).json({ error: 'no-audio' });
  const wav = req.file.path + '.wav';
  try {
    await toWav(req.file.path, wav);
    res.json({ text: await transcribe(wav) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    rm(req.file.path); rm(wav);
  }
});

module.exports = { router, available };
