require('dotenv').config();

const PORT = parseInt(process.env.PORT || '7420', 10);
const HOST = '127.0.0.1';
const ROOT_DIR = process.env.ROOT_DIR || '/home/kay2';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN || AUTH_TOKEN === 'changeme-REQUIRED') {
  console.error('AUTH_TOKEN is not set in .env — refusing to start.');
  process.exit(1);
}

module.exports = { PORT, HOST, ROOT_DIR, OLLAMA_URL, AUTH_TOKEN };
