const express = require('express');
const os = require('os');

const router = express.Router();

router.get('/', (req, res) => {
  const role = process.env.HOST_ROLE || 'pi';
  res.json({
    role,
    name: process.env.HOST_NAME || os.hostname(),
    hostname: os.hostname(),
    isPrimary: role === 'pi',
    isFallback: role === 'vps',
    capabilities: {
      localFiles: role === 'pi',
      ollama: role === 'pi',
      agents: true,
      openclaw: role === 'vps' || process.env.OPENCLAW_ENABLED === '1',
      vastGpu: !!process.env.VAST_API_KEY,
    },
  });
});

module.exports = router;
