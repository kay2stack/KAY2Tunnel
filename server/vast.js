const express = require('express');
const vast = require('./vast-client');

const router = express.Router();

router.get('/config', (req, res) => {
  res.json({
    configured: vast.configured(),
    maxDph: parseFloat(process.env.VAST_MAX_DPH || '0.55'),
    minGpuRamGb: parseInt(process.env.VAST_MIN_GPU_RAM_MB || '16384', 10) / 1024,
    label: process.env.VAST_GPU_LABEL || 'stan-gpu',
    ollamaModel: process.env.VAST_OLLAMA_MODEL || 'gemma2:2b',
    tailscaleAuto: !!process.env.TAILSCALE_AUTHKEY,
  });
});

router.get('/status', async (req, res) => {
  try {
    res.json(await vast.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/offers', async (req, res) => {
  if (!vast.configured()) return res.status(503).json({ error: 'VAST_API_KEY not configured' });
  try {
    const limit = Math.min(parseInt(req.query.limit || '12', 10), 24);
    res.json(await vast.searchOffers(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/launch', express.json(), async (req, res) => {
  if (!vast.configured()) return res.status(503).json({ error: 'VAST_API_KEY not configured' });
  try {
    const { offerId, confirm } = req.body || {};
    if (!confirm) return res.status(400).json({ error: 'Set confirm:true to launch a GPU instance (billed hourly)' });

    const status = await vast.getStatus();
    if (status.instance?.running) {
      return res.status(409).json({ error: 'GPU instance already running', instance: status.instance });
    }

    let result;
    if (offerId) {
      result = await vast.createInstance(offerId);
    } else {
      result = await vast.launchBest();
    }
    res.json({ ok: true, ...result, message: 'GPU instance launching — poll /api/gpu/status' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/destroy', express.json(), async (req, res) => {
  if (!vast.configured()) return res.status(503).json({ error: 'VAST_API_KEY not configured' });
  try {
    const { confirm, instanceId } = req.body || {};
    if (!confirm) return res.status(400).json({ error: 'Set confirm:true to destroy GPU instance' });

    const state = vast.loadState();
    const id = instanceId || state?.instanceId;
    if (!id) return res.status(404).json({ error: 'No tracked GPU instance' });

    await vast.destroyInstance(id);
    res.json({ ok: true, destroyed: id, message: 'GPU instance destroyed — billing stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
