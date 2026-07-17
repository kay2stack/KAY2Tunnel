// Stan CLI — vast.ai GPU panel

const Gpu = (() => {
  let _poll = null;

  function el(id) { return document.getElementById(id); }

  function money(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `$${Number(n).toFixed(2)}/hr`;
  }

  async function fetchJson(path, opts) {
    const r = await App.apiFetch(path, opts);
    return r.json();
  }

  function renderConfig(cfg) {
    const note = el('gpu-config-note');
    if (!note) return;
    if (!cfg.configured) {
      note.textContent = 'Add VAST_API_KEY to .env on this host to enable GPU burst.';
      note.style.color = 'var(--amber)';
      return;
    }
    note.textContent = `Filters: ≥${cfg.minGpuRamGb}GB VRAM · max ${money(cfg.maxDph)} · model ${cfg.ollamaModel}`;
    note.style.color = 'var(--text-dim)';
  }

  function renderInstance(st) {
    const box = el('gpu-instance');
    if (!box) return;
    const inst = st?.instance;
    if (!inst) {
      box.innerHTML = `<div class="health-empty">No GPU running. Launch one below — billed per hour on vast.ai.</div>`;
      el('gpu-action-destroy')?.classList.add('hidden');
      return;
    }
    el('gpu-action-destroy')?.classList.remove('hidden');
    const ssh = inst.sshHost ? `${inst.sshHost}:${inst.sshPort || 22}` : 'pending…';
    box.innerHTML = `
      <div class="gpu-active-card">
        <div class="gpu-active-head">
          <span class="gpu-status-pill ${inst.running ? 'on' : 'boot'}">${inst.status}</span>
          <span class="gpu-active-label">${inst.label || 'stan-gpu'}</span>
        </div>
        <div class="gpu-active-grid">
          <div><span class="health-metric-label">GPU</span><div class="health-metric-value">${inst.gpuName || '—'}</div></div>
          <div><span class="health-metric-label">Cost</span><div class="health-metric-value">${money(inst.dph)}</div></div>
          <div><span class="health-metric-label">SSH</span><div class="health-metric-value" style="font-size:11px">${ssh}</div></div>
          <div><span class="health-metric-label">ID</span><div class="health-metric-value" style="font-size:11px">${inst.id}</div></div>
        </div>
        <p class="gpu-hint">Tailscale: SSH to box after onstart completes (~2 min). Check <code>/workspace/stan-onstart.log</code> on the instance.</p>
      </div>`;
  }

  function renderOffers(data) {
    const list = el('gpu-offers');
    if (!list) return;
    const offers = data?.offers || [];
    if (!offers.length) {
      list.innerHTML = '<div class="health-empty">No offers match filters — relax VAST_MAX_DPH in .env</div>';
      return;
    }
    list.innerHTML = offers.map(o => `
      <div class="gpu-offer-row">
        <div class="gpu-offer-main">
          <div class="gpu-offer-name">${o.gpuName} ×${o.numGpus}</div>
          <div class="gpu-offer-meta">${o.gpuRamGb || '?'}GB VRAM · ${o.cpuRamGb || '?'}GB RAM · ${o.location || '—'}</div>
        </div>
        <div class="gpu-offer-right">
          <div class="gpu-offer-price">${money(o.dph)}</div>
          <button class="health-issue-action" data-offer="${o.id}">Launch</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-offer]').forEach(btn => {
      btn.addEventListener('click', () => launch(parseInt(btn.dataset.offer, 10)));
    });
  }

  async function refresh() {
    try {
      const [cfg, st, offers] = await Promise.all([
        fetchJson('/api/gpu/config'),
        fetchJson('/api/gpu/status'),
        fetchJson('/api/gpu/offers?limit=8').catch(() => ({ offers: [] })),
      ]);
      renderConfig(cfg);
      renderInstance(st);
      if (cfg.configured) renderOffers(offers);

      const homeGpu = el('home-gpu-status');
      if (homeGpu) {
        homeGpu.textContent = st.instance?.running ? 'GPU on' : 'GPU off';
        homeGpu.style.color = st.instance?.running ? 'var(--green)' : 'var(--text-dim)';
      }
    } catch (e) {
      el('gpu-instance').innerHTML = `<div class="health-empty" style="color:var(--red)">${e.message}</div>`;
    }
  }

  async function launch(offerId) {
    const msg = offerId
      ? `Launch GPU offer #${offerId}? You pay vast.ai hourly until destroyed.`
      : 'Launch cheapest matching GPU? Billed hourly on vast.ai until destroyed.';
    if (!confirm(msg)) return;
    try {
      const body = { confirm: true };
      if (offerId) body.offerId = offerId;
      const r = await App.apiFetch('/api/gpu/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Launch failed');
      alert(j.message || 'GPU launching');
      await refresh();
    } catch (e) {
      alert(e.message);
    }
  }

  async function destroy() {
    if (!confirm('Destroy GPU instance? Billing stops immediately.')) return;
    try {
      const r = await App.apiFetch('/api/gpu/destroy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Destroy failed');
      alert(j.message || 'Destroyed');
      await refresh();
    } catch (e) {
      alert(e.message);
    }
  }

  function open() {
    el('gpu-sheet-backdrop')?.classList.remove('hidden');
    refresh();
    _poll = setInterval(refresh, 15000);
  }

  function close() {
    el('gpu-sheet-backdrop')?.classList.add('hidden');
    if (_poll) { clearInterval(_poll); _poll = null; }
  }

  function init() {
    el('gpu-close-btn')?.addEventListener('click', close);
    el('gpu-sheet-backdrop')?.addEventListener('click', e => {
      if (e.target.id === 'gpu-sheet-backdrop') close();
    });
    el('gpu-refresh-btn')?.addEventListener('click', refresh);
    el('qa-gpu')?.addEventListener('click', open);
    el('settings-gpu-row')?.addEventListener('click', open);
    el('gpu-action-best')?.addEventListener('click', () => launch(null));
    el('gpu-action-destroy')?.addEventListener('click', destroy);
  }

  return { init, open, close, refresh };
})();
