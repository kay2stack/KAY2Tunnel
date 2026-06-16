/* ============================================================================
   MacPiOs PRO  —  second drop-in pack. Load AFTER kay2os-extras.js:
       <script src="kay2os-extras.js" defer></script>
       <script src="kay2os-pro.js"   defer></script>
   Additive + defensive. Integrates with the base + extras via stable CSS
   classes / DOM and window.k2xNotify; no dependency on their internals.
   Adds: live-data desktop widgets (real /api/system + /api/pi, demo fallback) ·
   full macOS Control Center (augments the existing one, keeps its toggles) ·
   Launchpad (F4, mirrors the dock) · upgraded session Lock Screen (⌃⌘Q) ·
   draggable Desktop icons · Spaces / multi-desktop (⌃← ⌃→ switch, ⌃⇧→ move).
   API: served from the Pi (same origin) the widgets hit /api/system & /api/pi.
   To point a remote deploy (e.g. Netlify) at the Pi, set before this script:
       <script>window.KAY2_API = "https://kay2.<tailnet>.ts.net";</script>
   Unreachable → widgets fall back to animated demo data automatically.
   ============================================================================ */
(function(){
  if (window.__kay2pro) return; window.__kay2pro = true;
  const $  = s => document.querySelector(s);
  const el = (t,c,h)=>{ const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
  const svg= d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const ls = { get(k,d){ try{const v=localStorage.getItem('k2p.'+k); return v==null?d:JSON.parse(v);}catch(e){return d;} },
               set(k,v){ try{localStorage.setItem('k2p.'+k,JSON.stringify(v));}catch(e){} } };
  const notify = (t,b,a)=> (window.k2xNotify ? window.k2xNotify(t,b,a) : console.log('[k2p]',t,b));
  const API = (window.KAY2_API||'').replace(/\/$/,'');
  async function getJSON(path){ try{ const c=new AbortController(); const id=setTimeout(()=>c.abort(),3500);
      const r=await fetch(API+path,{signal:c.signal}); clearTimeout(id); if(!r.ok)throw 0; return await r.json(); }catch(e){ return null; } }
  /* ---------- styles ---------- */
  document.head.appendChild(el('style',null,`
  /* widgets (match extras look) */
  .k2p-widget{position:fixed;z-index:52;border-radius:18px;padding:14px 16px;min-width:215px;
    background:var(--win-bg,rgba(40,40,44,.72));backdrop-filter:saturate(180%) blur(26px);-webkit-backdrop-filter:saturate(180%) blur(26px);
    border:.5px solid var(--win-border,rgba(255,255,255,.12));box-shadow:0 18px 50px rgba(0,0,0,.45);color:var(--bg-text,#f5f5f7);
    font-family:var(--sf,sans-serif);cursor:grab;-webkit-user-select:none;user-select:none;}
  .k2p-widget .wx{position:absolute;top:9px;right:11px;opacity:0;font-size:13px;cursor:pointer;transition:opacity .15s;}
  .k2p-widget:hover .wx{opacity:.5;}
  .k2p-h{font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--clive,#2BE5FF);margin-bottom:9px;display:flex;gap:7px;align-items:center;}
  .k2p-h.pi{color:#ff9f4d;}
  .k2p-stat{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;font-variant-numeric:tabular-nums;}
  .k2p-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin:5px 0 8px;}
  .k2p-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--clive,#2BE5FF),#9b4dff);transition:width .5s;}
  .k2p-proc{display:grid;grid-template-columns:1fr auto;font-size:12px;padding:2px 0;color:var(--bg-text-dim,#a1a1a6);}
  .k2p-proc .ok{color:#32d74b;} .k2p-proc .bad{color:#ff6961;}
  .k2p-demo{font-size:10px;color:var(--bg-text-dim,#888);text-align:right;margin-top:6px;opacity:.7;}
  /* control center additions */
  .k2p-cc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}
  .k2p-tile{background:var(--field,rgba(255,255,255,.08));border-radius:12px;padding:11px;display:flex;flex-direction:column;gap:7px;cursor:pointer;}
  .k2p-tile.wide{grid-column:span 2;}
  .k2p-tile .ico{width:30px;height:30px;border-radius:50%;background:rgba(140,140,150,.4);display:flex;align-items:center;justify-content:center;}
  .k2p-tile.on .ico{background:var(--accent,#2b7fff);} .k2p-tile.on.aur .ico{background:linear-gradient(135deg,#2BE5FF,#9b4dff);}
  .k2p-tile .ico svg{width:16px;height:16px;stroke:#fff;} .k2p-tile .lab{font-size:12px;font-weight:600;} .k2p-tile .sub{font-size:10.5px;color:var(--bg-text-dim,#9a9aa0);}
  .k2p-cc-slider{display:flex;align-items:center;gap:9px;background:var(--field,rgba(255,255,255,.08));border-radius:12px;padding:10px 12px;margin-bottom:8px;}
  .k2p-cc-slider svg{width:16px;height:16px;stroke:var(--bg-text,#fff);flex:0 0 auto;}
  .k2p-cc-slider input{flex:1;-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:rgba(140,140,150,.4);outline:none;}
  .k2p-cc-slider input::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);}
  /* launchpad */
  #k2p-lp{position:fixed;inset:0;z-index:9700;display:none;align-items:flex-start;justify-content:center;
    background:rgba(0,0,0,.28);backdrop-filter:saturate(160%) blur(34px);-webkit-backdrop-filter:saturate(160%) blur(34px);}
  #k2p-lp.on{display:flex;animation:k2pfade .2s ease;}
  @keyframes k2pfade{from{opacity:0}to{opacity:1}}
  #k2p-lp .inner{width:min(900px,92vw);margin-top:7vh;}
  #k2p-lp .lpsearch{display:flex;justify-content:center;margin-bottom:34px;}
  #k2p-lp .lpsearch input{width:260px;text-align:center;border:none;outline:none;border-radius:9px;padding:9px 14px;font-size:14px;
    background:rgba(255,255,255,.14);color:#fff;font-family:var(--sf,sans-serif);-webkit-user-select:text;user-select:text;}
  #k2p-lp .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:26px 10px;}
  #k2p-lp .lpapp{display:flex;flex-direction:column;align-items:center;gap:9px;cursor:pointer;}
  #k2p-lp .lpapp .ic{width:64px;height:64px;border-radius:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.35);transition:transform .12s;}
  #k2p-lp .lpapp:hover .ic{transform:scale(1.1);} #k2p-lp .lpapp .ic svg{width:60%;height:60%;}
  #k2p-lp .lpapp .nm{font-size:12.5px;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.5);font-family:var(--sf,sans-serif);}
  /* lock screen */
  #k2p-lock{position:fixed;inset:0;z-index:100000;display:none;flex-direction:column;align-items:center;justify-content:center;color:#fff;
    background:rgba(6,9,20,.55);backdrop-filter:blur(40px) brightness(.7);-webkit-backdrop-filter:blur(40px) brightness(.7);font-family:var(--sf,sans-serif);}
  #k2p-lock.on{display:flex;animation:k2pfade .35s ease;}
  #k2p-lock .lt{font-size:96px;font-weight:200;letter-spacing:-2px;font-variant-numeric:tabular-nums;text-shadow:0 2px 30px rgba(0,0,0,.4);}
  #k2p-lock .ld{font-size:19px;font-weight:500;opacity:.85;margin-bottom:8vh;}
  #k2p-lock .av{width:78px;height:78px;border-radius:50%;background:linear-gradient(150deg,#2BE5FF,#1d6fff);display:flex;align-items:center;justify-content:center;
    font-size:34px;font-weight:700;color:#04222a;margin-bottom:12px;box-shadow:0 8px 26px rgba(0,0,0,.4);}
  #k2p-lock .nm{font-size:17px;font-weight:600;margin-bottom:16px;}
  #k2p-lock .pf{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.16);border-radius:20px;padding:7px 8px 7px 16px;}
  #k2p-lock .pf input{border:none;outline:none;background:transparent;color:#fff;font-size:14px;width:170px;font-family:var(--sf,sans-serif);-webkit-user-select:text;user-select:text;}
  #k2p-lock .pf button{border:none;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.25);color:#fff;cursor:pointer;font-size:15px;}
  #k2p-lock .pf.shake{animation:k2pshake .35s;} @keyframes k2pshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
  #k2p-lock .hint{font-size:12px;opacity:.6;margin-top:12px;}
  /* desktop icons */
  #k2p-desk{position:fixed;inset:0 0 96px 0;z-index:30;pointer-events:none;}
  .k2p-icon{position:absolute;width:84px;display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;pointer-events:auto;padding:6px 4px;border-radius:8px;-webkit-user-select:none;user-select:none;}
  .k2p-icon.sel{background:rgba(43,229,255,.22);}
  .k2p-icon .gi{width:52px;height:52px;border-radius:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.3);}
  .k2p-icon .gi svg{width:54%;height:54%;stroke:#fff;}
  .k2p-icon .nm{font-size:12px;color:#fff;text-align:center;text-shadow:0 1px 4px rgba(0,0,0,.7);max-width:80px;line-height:1.2;}
  /* spaces pill */
  #k2p-spaces{position:fixed;bottom:96px;left:50%;transform:translateX(-50%) translateY(20px);z-index:9300;display:flex;gap:10px;align-items:center;
    padding:8px 12px;border-radius:16px;background:var(--bar,rgba(28,28,32,.6));backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
    border:.5px solid var(--win-border,rgba(255,255,255,.12));box-shadow:0 12px 36px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;}
  #k2p-spaces.show{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0);}
  #k2p-spaces .sp{width:54px;height:34px;border-radius:7px;border:1.5px solid rgba(255,255,255,.3);cursor:pointer;display:flex;align-items:center;justify-content:center;
    font-size:11px;color:var(--bg-text,#fff);font-family:var(--sf,sans-serif);transition:all .15s;}
  #k2p-spaces .sp.cur{border-color:var(--clive,#2BE5FF);background:rgba(43,229,255,.18);box-shadow:0 0 10px rgba(43,229,255,.3);}
  #k2p-spaces .addsp{width:30px;height:34px;border-radius:7px;border:1.5px dashed rgba(255,255,255,.3);cursor:pointer;color:var(--bg-text,#fff);font-size:18px;background:none;}
  .window.k2p-off{display:none!important;}
  `));
  /* ---------- generic desktop widget ---------- */
  function makeWidget(id, defLeft, defTop, build){
    if(ls.get('wid.'+id,true)===false) return null;
    const w=el('div','k2p-widget'); const pos=ls.get('wpos.'+id,null);
    w.style.left=(pos?pos.l:defLeft)+'px'; w.style.top=(pos?pos.t:defTop)+'px';
    w.innerHTML='<span class="wx">✕</span>'; document.body.appendChild(w);
    w.querySelector('.wx').addEventListener('click',()=>{ w.remove(); ls.set('wid.'+id,false); });
    w.addEventListener('pointerdown',e=>{ if(e.target.classList.contains('wx'))return; const sx=e.clientX,sy=e.clientY,ol=w.offsetLeft,ot=w.offsetTop; w.style.cursor='grabbing';
      const mv=ev=>{ w.style.left=clamp(ol+ev.clientX-sx,0,innerWidth-w.offsetWidth)+'px'; w.style.top=clamp(ot+ev.clientY-sy,28,innerHeight-w.offsetHeight)+'px'; };
      const up=()=>{ w.style.cursor='grab'; ls.set('wpos.'+id,{l:w.offsetLeft,t:w.offsetTop}); removeEventListener('pointermove',mv);removeEventListener('pointerup',up); };
      addEventListener('pointermove',mv); addEventListener('pointerup',up); });
    build(w); return w;
  }
  /* ---------- System widget (/api/system) ---------- */
  makeWidget('system', 24, 270, w=>{
    w.insertAdjacentHTML('beforeend',`
      <div class="k2p-h">${svg('<rect x="3" y="4" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>')} System</div>
      <div class="k2p-stat"><span>CPU</span><b class="cpu">—</b></div><div class="k2p-bar"><i class="cpub" style="width:0"></i></div>
      <div class="k2p-stat"><span>Memory</span><b class="mem">—</b></div><div class="k2p-bar"><i class="memb" style="width:0"></i></div>
      <div class="k2p-stat"><span>Uptime</span><b class="up">—</b></div>
      <div class="k2p-stat"><span>Load</span><b class="load">—</b></div>
      <div class="k2p-demo"></div>`);
    let demoCpu=22,demoMem=57;
    const upd=async()=>{ if(!document.body.contains(w))return;
      let d=await getJSON('/api/system'), live=!!d;
      if(!d){ demoCpu=clamp(demoCpu+(Math.random()-0.5)*12,4,96); demoMem=clamp(demoMem+(Math.random()-0.5)*5,35,88);
        d={cpu:demoCpu, mem:{used:demoMem/100*8,total:8}, uptime:824000+Date.now()%1e6, load:[demoCpu/100*4,0,0]}; }
      const cpu=Math.round(d.cpu||0), memPct=d.mem?Math.round(d.mem.used/d.mem.total*100):0;
      w.querySelector('.cpu').textContent=cpu+'%'; w.querySelector('.cpub').style.width=cpu+'%';
      w.querySelector('.mem').textContent=d.mem?d.mem.used.toFixed(1)+' / '+d.mem.total+' GB':'—'; w.querySelector('.memb').style.width=memPct+'%';
      const us=Math.floor((d.uptime||0)/1000); w.querySelector('.up').textContent=Math.floor(us/86400)+'d '+Math.floor(us%86400/3600)+'h';
      w.querySelector('.load').textContent=(d.load&&d.load[0]!=null)?d.load[0].toFixed(2):'—';
      w.querySelector('.k2p-demo').textContent=live?'● live · /api/system':'demo (Pi offline)'; };
    upd(); const t=setInterval(upd,4000); w.addEventListener('remove',()=>clearInterval(t));
  });
  /* ---------- Pi widget (/api/pi) ---------- */
  makeWidget('pi', 24, 470, w=>{
    w.insertAdjacentHTML('beforeend',`
      <div class="k2p-h pi">${svg('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="15" x2="22" y2="15"/>')} Raspberry Pi</div>
      <div class="k2p-stat"><span>Core temp</span><b class="tmp">—</b></div>
      <div class="k2p-stat"><span>Throttled</span><b class="thr">—</b></div>
      <div class="procs" style="margin-top:8px;"></div>
      <div class="k2p-demo"></div>`);
    const demoProcs=['clive','hermz','kay2tunnel','ollama'];
    const upd=async()=>{ if(!document.body.contains(w))return;
      let d=await getJSON('/api/pi'), live=!!d;
      if(!d){ d={tempC:46+Math.random()*8, throttled:false, processes:demoProcs.map(n=>({name:n,status:Math.random()<0.97?'online':'stopped',cpu:(Math.random()*15).toFixed(1)}))}; }
      w.querySelector('.tmp').textContent=(d.tempC!=null?d.tempC.toFixed(1):'—')+'°C';
      w.querySelector('.thr').innerHTML=d.throttled?'<span style="color:#ff6961">⚠ yes</span>':'<span style="color:#32d74b">no</span>';
      w.querySelector('.procs').innerHTML=(d.processes||[]).map(p=>`<div class="k2p-proc"><span>${p.name}</span><span class="${p.status==='online'?'ok':'bad'}">${p.status==='online'?'● '+(p.cpu||0)+'%':'● '+p.status}</span></div>`).join('');
      w.querySelector('.k2p-demo').textContent=live?'● live · /api/pi':'demo (Pi offline)'; };
    upd(); const t=setInterval(upd,4000); w.addEventListener('remove',()=>clearInterval(t));
  });
  /* ---------- FULL CONTROL CENTER (augment existing #cc) ---------- */
  (function(){
    const cc=$('#cc'); if(!cc) return;
    const themeOn=()=>document.documentElement.getAttribute('data-theme')==='dark';
    const grid=el('div','k2p-cc-grid');
    const tile=(cls,icon,lab,sub,on,fn)=>{ const t=el('div','k2p-tile'+(cls?' '+cls:'')+(on?' on':''),`<div class="ico">${svg(icon)}</div><div class="lab">${lab}</div><div class="sub">${sub}</div>`);
      t.addEventListener('click',()=>{ const now=t.classList.toggle('on'); t.querySelector('.sub').textContent=now?'On':'Off'; fn&&fn(now); }); return t; };
    grid.appendChild(tile('','<path d="M5 12.5a10 10 0 0114 0"/><path d="M8.5 15.5a5 5 0 017 0"/><circle cx="12" cy="18.5" r="1" fill="#fff"/>','Wi-Fi','kay2-net',true));
    grid.appendChild(tile('','<path d="M7 7l10 10-5 4V3l5 4L7 17"/>','Bluetooth','On',true));
    grid.appendChild(tile('','<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>','AirDrop','Contacts',true));
    grid.appendChild(tile('aur','<path d="M3 18c4-6 6-8 9-8s5 2 9 8"/><circle cx="12" cy="6" r="2"/>','Aurora','Wallpaper', document.body.classList.contains('k2x-aurora'),
      on=>{ document.body.classList.toggle('k2x-aurora',on); try{localStorage.setItem('k2x.wall',JSON.stringify(on?'aurora':'off'));}catch(e){} }));
    cc.insertBefore(grid, cc.firstChild);
    // sliders
    const mkSlider=(icon,id,val,fn)=>{ const s=el('div','k2p-cc-slider',svg(icon)+`<input type="range" min="0" max="100" value="${val}">`); s.querySelector('input').addEventListener('input',e=>fn(+e.target.value)); return s; };
    const brightEl=$('#brightness');
    cc.appendChild(mkSlider('<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>','disp',100,
      v=>{ if(brightEl){brightEl.style.transition='opacity .12s';brightEl.style.opacity=(1-v/100);} }));
    cc.appendChild(mkSlider('<path d="M4 9v6h4l5 5V4L8 9z"/><path d="M16 8a4 4 0 010 8"/>','vol',70,v=>{}));
    // lock button (wide tile)
    const lockBtn=el('div','k2p-tile wide',`<div style="display:flex;align-items:center;gap:10px"><div class="ico">${svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>')}</div><div class="lab" style="font-size:13px">Lock Screen</div></div>`);
    lockBtn.style.cursor='pointer'; lockBtn.addEventListener('click',()=>{ cc.classList.remove('show'); lock(); }); cc.appendChild(lockBtn);
  })();
  /* ---------- LAUNCHPAD (mirror the dock) ---------- */
  const lp=el('div'); lp.id='k2p-lp';
  lp.innerHTML=`<div class="inner"><div class="lpsearch"><input placeholder="Search" autocomplete="off"></div><div class="grid"></div></div>`;
  document.body.appendChild(lp);
  const lpGrid=lp.querySelector('.grid'), lpSearch=lp.querySelector('input');
  function buildLaunchpad(filter){
    lpGrid.innerHTML=''; const items=[...document.querySelectorAll('#dock .dock-item')].filter(d=>d.dataset.app!=='trash');
    items.forEach(d=>{ const tip=d.querySelector('.dock-tip'), icon=d.querySelector('.dock-icon'); const name=tip?tip.textContent:'App';
      if(filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
      const a=el('div','lpapp',`<div class="ic" style="background:${icon?icon.style.background:'#444'}">${icon?icon.innerHTML:''}</div><div class="nm">${name}</div>`);
      a.addEventListener('click',()=>{ closeLP(); d.click(); }); lpGrid.appendChild(a); });
  }
  function openLP(){ buildLaunchpad(''); lpSearch.value=''; lp.classList.add('on'); setTimeout(()=>lpSearch.focus(),60); }
  function closeLP(){ lp.classList.remove('on'); }
  lpSearch.addEventListener('input',e=>buildLaunchpad(e.target.value));
  lp.addEventListener('click',e=>{ if(e.target===lp) closeLP(); });
  // launchpad dock item (front of dock) + key
  (function(){ const dock=$('#dock'); if(dock){ const it=el('div','dock-item'); it.dataset.x='launchpad';
    it.innerHTML=`<div class="dock-tip">Launchpad</div><div class="dock-icon" style="background:linear-gradient(150deg,#5b5bff,#2BE5FF);color:#fff">${svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')}</div><div class="runningdot"></div>`;
    it.addEventListener('click',openLP); dock.insertBefore(it, dock.firstChild); } })();
  /* ---------- LOCK SCREEN (session lock; cosmetic, doesn't touch boot auth) ---------- */
  const lockEl=el('div'); lockEl.id='k2p-lock';
  lockEl.innerHTML=`<div class="lt"></div><div class="ld"></div>
    <div class="av">k</div><div class="nm">kay2</div>
    <div class="pf"><input type="password" placeholder="Enter Password"><button>→</button></div>
    <div class="hint">Touch ID or enter password · session lock</div>`;
  document.body.appendChild(lockEl);
  const lpf=lockEl.querySelector('.pf'), lpi=lockEl.querySelector('input');
  function lockClock(){ const d=new Date(),days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],mon=['January','February','March','April','May','June','July','August','September','October','November','December'];
    lockEl.querySelector('.lt').textContent=(d.getHours()%12||12)+':'+String(d.getMinutes()).padStart(2,'0');
    lockEl.querySelector('.ld').textContent=days[d.getDay()]+', '+d.getDate()+' '+mon[d.getMonth()]; }
  let lockTimer=null;
  function lock(){ lockClock(); lockEl.classList.add('on'); lpi.value=''; setTimeout(()=>lpi.focus(),200); clearInterval(lockTimer); lockTimer=setInterval(lockClock,1000); }
  function unlock(){ lockEl.classList.remove('on'); clearInterval(lockTimer); }
  function tryUnlock(){ unlock(); } // cosmetic: any input unlocks; wire to real auth later
  lockEl.querySelector('button').addEventListener('click',tryUnlock);
  lpi.addEventListener('keydown',e=>{ if(e.key==='Enter'){ tryUnlock(); } });
  window.k2pLock = lock;
  /* ---------- DESKTOP ICONS ---------- */
  const desk=el('div'); desk.id='k2p-desk'; document.body.appendChild(desk);
  function winLite(id,title,w,h,html){ // tiny self-contained window for README/Finder
    const cont=$('#windows')||document.body; const win=el('div','window k2p-win opaque'); win.dataset.title=title;
    const W=Math.min(w,innerWidth-30),H=Math.min(h,innerHeight-140);
    win.style.cssText=`position:absolute;pointer-events:auto;width:${W}px;height:${H}px;left:${(innerWidth-W)/2}px;top:90px;z-index:300;`;
    win.innerHTML=`<div class="titlebar"><div class="lights"><span class="light l-close">${svg('<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>')}</span><span class="light l-min"></span><span class="light l-max"></span></div><div class="wt">${title}</div></div><div class="win-body" style="padding:18px;overflow:auto;-webkit-user-select:text;user-select:text">${html}</div>`;
    cont.appendChild(win);
    const tb=win.querySelector('.titlebar');
    tb.addEventListener('pointerdown',e=>{ if(e.target.closest('.light'))return; const sx=e.clientX,sy=e.clientY,ol=win.offsetLeft,ot=win.offsetTop;
      const mv=ev=>{win.style.left=Math.max(0,ol+ev.clientX-sx)+'px';win.style.top=Math.max(28,ot+ev.clientY-sy)+'px';}; const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);};
      addEventListener('pointermove',mv);addEventListener('pointerup',up); });
    win.querySelector('.l-close').addEventListener('click',()=>win.remove());
    return win;
  }
  function openDockApp(appId){ const d=document.querySelector(`#dock .dock-item[data-app="${appId}"],#dock .dock-item[data-x="${appId}"]`); if(d){d.click();return true;} return false; }
  const ICONS=[
    {id:'hd',  name:'Macintosh HD', grad:'linear-gradient(150deg,#c8c8cc,#8e8e93)', glyph:'<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="12" cy="12" r="3"/>', open:()=>winLite('hd','Macintosh HD',420,300,'<b>MacPiOs</b> · Raspberry Pi<br><br>Storage, system, and your files live here.<br>Double-click Projects to browse, or open Files from the dock.')},
    {id:'proj',name:'Projects', grad:'linear-gradient(150deg,#5ac8fa,#0a84ff)', glyph:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>', open:()=>{ if(!openDockApp('files')) winLite('proj','Projects',460,320,'SubSlash · Wildling · Spool · GLINT · RayBot · FindIt'); }},
    {id:'term',name:'Terminal', grad:'linear-gradient(150deg,#3a3a3c,#1c1c1e)', glyph:'<path d="M4 5h16v14H4z"/><path d="M7 9l3 3-3 3"/><line x1="12" y1="15" x2="16" y2="15"/>', open:()=>openDockApp('terminal')},
    {id:'clive',name:'Clive', grad:'linear-gradient(150deg,#2BE5FF,#0aa6c2)', glyph:'<path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z"/>', open:()=>openDockApp('clive')},
    {id:'rd', name:'README.txt', grad:'linear-gradient(150deg,#e8e8ec,#b0b0b6)', glyph:'<path d="M6 3h9l4 4v14H6z"/><line x1="9" y1="11" x2="16" y2="11"/><line x1="9" y1="15" x2="16" y2="15"/>', open:()=>winLite('rd','README.txt',440,280,'<div style="font-family:var(--mono,monospace);font-size:13px;line-height:1.7"># MacPiOs<br><br>macOS desktop shell for KAY2Tunnel.<br>Built on iPhone. Served over Tailscale.<br><br>no talk just make.</div>')}
  ];
  function placeIcons(){
    const saved=ls.get('icons',{}); desk.innerHTML='';
    ICONS.forEach((ic,i)=>{ const node=el('div','k2p-icon',`<div class="gi" style="background:${ic.grad}">${svg(ic.glyph)}</div><div class="nm">${ic.name}</div>`);
      const p=saved[ic.id]||{x:innerWidth-100,y:40+i*96}; node.style.left=p.x+'px'; node.style.top=p.y+'px';
      let moved=false;
      node.addEventListener('pointerdown',e=>{ desk.querySelectorAll('.k2p-icon').forEach(n=>n.classList.remove('sel')); node.classList.add('sel'); moved=false;
        const sx=e.clientX,sy=e.clientY,ox=node.offsetLeft,oy=node.offsetTop;
        const mv=ev=>{ moved=true; node.style.left=clamp(ox+ev.clientX-sx,0,innerWidth-84)+'px'; node.style.top=clamp(oy+ev.clientY-sy,30,innerHeight-180)+'px'; };
        const up=()=>{ removeEventListener('pointermove',mv); removeEventListener('pointerup',up); if(moved){ const s=ls.get('icons',{}); s[ic.id]={x:node.offsetLeft,y:node.offsetTop}; ls.set('icons',s); } };
        addEventListener('pointermove',mv); addEventListener('pointerup',up); });
      node.addEventListener('dblclick',()=>ic.open());
      desk.appendChild(node); });
  }
  placeIcons();
  addEventListener('pointerdown',e=>{ if(!e.target.closest('.k2p-icon')) desk.querySelectorAll('.k2p-icon').forEach(n=>n.classList.remove('sel')); });
  /* ---------- SPACES (multi-desktop) ---------- */
  let spaceCount=ls.get('spaceCount',2), current=0;
  const winsContainer=$('#windows');
  function tagNew(node){ if(node.classList&&node.classList.contains('window')&&!node.dataset.space) node.dataset.space=current; }
  if(winsContainer){ winsContainer.querySelectorAll('.window').forEach(w=>{ if(!w.dataset.space)w.dataset.space=0; });
    new MutationObserver(muts=>muts.forEach(m=>m.addedNodes.forEach(tagNew))).observe(winsContainer,{childList:true}); }
  const spacesPill=el('div'); spacesPill.id='k2p-spaces'; document.body.appendChild(spacesPill);
  let pillTimer=null;
  function renderPill(){ spacesPill.innerHTML='';
    for(let i=0;i<spaceCount;i++){ const sp=el('div','sp'+(i===current?' cur':''),'Desktop '+(i+1)); sp.addEventListener('click',()=>switchSpace(i)); spacesPill.appendChild(sp); }
    if(spaceCount<4){ const add=el('button','addsp','+'); add.addEventListener('click',()=>{ spaceCount++; ls.set('spaceCount',spaceCount); renderPill(); showPill(); }); spacesPill.appendChild(add); } }
  function showPill(){ renderPill(); spacesPill.classList.add('show'); clearTimeout(pillTimer); pillTimer=setTimeout(()=>spacesPill.classList.remove('show'),1800); }
  function switchSpace(i){ if(i===current||i<0||i>=spaceCount||!winsContainer) return;
    winsContainer.style.transition='opacity .12s'; winsContainer.style.opacity='0';
    setTimeout(()=>{ current=i; winsContainer.querySelectorAll('.window').forEach(w=>{ w.classList.toggle('k2p-off', String(w.dataset.space)!==String(current)); });
      winsContainer.style.opacity='1'; }, 120);
    showPill(); }
  function moveWinToSpace(dir){ const ws=[...winsContainer.querySelectorAll('.window')].filter(w=>!w.classList.contains('k2p-off')&&w.style.display!=='none');
    const w=ws.sort((a,b)=>(+a.style.zIndex||0)-(+b.style.zIndex||0)).pop(); if(!w)return;
    const target=clamp(current+dir,0,spaceCount-1); if(target===current)return; w.dataset.space=target; switchSpace(target); }
  /* ---------- keyboard ---------- */
  addEventListener('keydown',e=>{
    if(e.key==='F4'){ e.preventDefault(); lp.classList.contains('on')?closeLP():openLP(); }
    else if(e.key==='Escape'){ if(lp.classList.contains('on'))closeLP(); }
    else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='q'&&e.ctrlKey){ e.preventDefault(); lock(); } // ⌃⌘Q-ish (Ctrl+Q)
    else if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&e.key==='ArrowRight'){ e.preventDefault(); switchSpace((current+1)%spaceCount); }
    else if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&e.key==='ArrowLeft'){ e.preventDefault(); switchSpace((current-1+spaceCount)%spaceCount); }
    else if(e.ctrlKey&&e.shiftKey&&e.key==='ArrowRight'){ e.preventDefault(); moveWinToSpace(1); }
    else if(e.ctrlKey&&e.shiftKey&&e.key==='ArrowLeft'){ e.preventDefault(); moveWinToSpace(-1); }
  });
  setTimeout(()=>notify('MacPiOs pro','Live widgets · F4 Launchpad · ⌃← ⌃→ Spaces · ⌃⇧→ move window · ⌃Q Lock · desktop icons'),2600);
})();
