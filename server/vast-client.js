const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://console.vast.ai/api/v0';
const STATE_DIR = path.join(os.homedir(), '.stan-vast');
const STATE_FILE = path.join(STATE_DIR, 'instance.json');

function apiKey() {
  const key = process.env.VAST_API_KEY;
  if (!key) throw new Error('VAST_API_KEY not set in .env');
  return key;
}

function configured() {
  return !!process.env.VAST_API_KEY;
}

async function vastRequest(method, apiPath, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
    },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${apiPath}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data.msg || data.error || data.detail || res.statusText;
    throw new Error(typeof msg === 'string' ? msg : `Vast API ${res.status}`);
  }
  return data;
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return null;
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearState() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

function defaultQuery() {
  const minGpuMb = parseInt(process.env.VAST_MIN_GPU_RAM_MB || '16384', 10);
  const maxDph = parseFloat(process.env.VAST_MAX_DPH || '0.55');
  const minRam = parseInt(process.env.VAST_MIN_CPU_RAM_MB || '16000', 10);
  return {
    rentable: { eq: true },
    verified: { eq: true },
    external: { eq: null },
    num_gpus: { gte: 1 },
    gpu_ram: { gte: minGpuMb },
    cpu_ram: { gte: minRam },
    dph_total: { lte: maxDph },
    reliability2: { gte: 0.94 },
    disk_space: { gte: 40 },
  };
}

function formatOffer(o) {
  const id = o.id ?? o.ask_contract_id ?? o.ask_id;
  return {
    id,
    gpuName: o.gpu_name || o.gpu_display_name || 'GPU',
    numGpus: o.num_gpus ?? 1,
    gpuRamGb: o.gpu_ram ? Math.round(o.gpu_ram / 1024) : null,
    cpuRamGb: o.cpu_ram ? Math.round(o.cpu_ram / 1024) : null,
    dph: o.dph_total ?? o.search?.dph_total ?? o.dph,
    reliability: o.reliability2 ?? o.reliability,
    diskGb: o.disk_space,
    location: o.geolocation || o.location || '',
    cuda: o.cuda_max_good,
  };
}

async function searchOffers(limit = 12, customQuery) {
  const q = customQuery || defaultQuery();
  const data = await vastRequest('GET', `/bundles/?q=${encodeURIComponent(JSON.stringify(q))}`);
  const offers = (data.offers || []).slice(0, limit).map(formatOffer);
  return { offers, query: q };
}

function buildOnstart() {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'vast-onstart.sh');
  let script = fs.readFileSync(scriptPath, 'utf8');
  const model = process.env.VAST_OLLAMA_MODEL || 'gemma2:2b';
  script = script.replace('__OLLAMA_MODEL__', model);
  if (script.length > 4000) {
    throw new Error('vast-onstart.sh exceeds Vast onstart limit (~4048 chars)');
  }
  return script;
}

async function createInstance(offerId, opts = {}) {
  const label = opts.label || process.env.VAST_GPU_LABEL || 'stan-gpu';
  const disk = opts.disk || parseFloat(process.env.VAST_DISK_GB || '40');
  const image = opts.image || process.env.VAST_IMAGE || 'vastai/base-image:@vastai-automatic-tag';

  const envParts = ['-e DEBIAN_FRONTEND=noninteractive'];
  if (process.env.TAILSCALE_AUTHKEY) {
    envParts.push(`-e TAILSCALE_AUTHKEY=${process.env.TAILSCALE_AUTHKEY}`);
  }
  if (process.env.VAST_OLLAMA_MODEL) {
    envParts.push(`-e OLLAMA_MODEL=${process.env.VAST_OLLAMA_MODEL}`);
  }

  const body = {
    image,
    disk,
    runtype: 'ssh_direct',
    label,
    onstart: buildOnstart(),
    env: envParts.join(' '),
    cancel_unavail: true,
    target_state: 'running',
  };

  const data = await vastRequest('PUT', `/asks/${offerId}/`, body);
  const instanceId = data.new_contract;
  if (!instanceId) throw new Error('No instance id returned from Vast');

  const state = {
    instanceId,
    offerId,
    label,
    createdAt: new Date().toISOString(),
    dph: opts.dph ?? null,
  };
  saveState(state);
  return { instanceId, state };
}

async function listInstances() {
  const data = await vastRequest('GET', '/instances/');
  return data.instances || [];
}

async function getInstance(id) {
  const data = await vastRequest('GET', `/instances/${id}/`);
  return data.instances || data;
}

async function destroyInstance(id) {
  await vastRequest('DELETE', `/instances/${id}/`);
  const state = loadState();
  if (state && String(state.instanceId) === String(id)) clearState();
  return { ok: true, destroyed: id };
}

async function getStatus() {
  if (!configured()) {
    return { configured: false, instance: null, state: null };
  }

  const state = loadState();
  let instances = [];
  try {
    instances = await listInstances();
  } catch (e) {
    return { configured: true, error: e.message, state, instance: null };
  }

  const stanInstances = instances.filter(i =>
    (i.label || '').startsWith('stan') || (state && i.id === state.instanceId)
  );

  let active = stanInstances.find(i =>
    ['running', 'loading', 'created'].includes(i.actual_status || i.cur_state || i.status)
  ) || stanInstances[0];

  if (!active && state?.instanceId) {
    try {
      active = await getInstance(state.instanceId);
    } catch {
      clearState();
    }
  }

  if (!active) {
    return { configured: true, instance: null, state: null, instances: stanInstances };
  }

  const inst = Array.isArray(active) ? active[0] : active;
  const formatted = formatInstance(inst);
  saveState({
    instanceId: inst.id,
    offerId: state?.offerId,
    label: inst.label || state?.label,
    createdAt: state?.createdAt || new Date().toISOString(),
    dph: inst.dph_total ?? state?.dph,
  });

  return {
    configured: true,
    instance: formatted,
    state: loadState(),
    instances: stanInstances.map(formatInstance),
  };
}

function formatInstance(inst) {
  if (!inst) return null;
  const status = inst.actual_status || inst.cur_state || inst.status || 'unknown';
  return {
    id: inst.id,
    label: inst.label,
    status,
    gpuName: inst.gpu_name,
    numGpus: inst.num_gpus,
    dph: inst.dph_total,
    sshHost: inst.ssh_host || inst.public_ipaddr,
    sshPort: inst.ssh_port || 22,
    startDate: inst.start_date,
    uptimeSec: inst.uptime_mins ? inst.uptime_mins * 60 : null,
    directPortCount: inst.direct_port_count,
    running: status === 'running',
  };
}

async function launchBest() {
  const { offers } = await searchOffers(8);
  if (!offers.length) throw new Error('No GPU offers match your filters');
  offers.sort((a, b) => (a.dph || 999) - (b.dph || 999));
  const pick = offers[0];
  const result = await createInstance(pick.id, { dph: pick.dph });
  return { ...result, offer: pick };
}

module.exports = {
  configured,
  searchOffers,
  createInstance,
  launchBest,
  getStatus,
  destroyInstance,
  listInstances,
  loadState,
  clearState,
};
