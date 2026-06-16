/* ============================================================================
   MacPiOs EXTRAS  —  drop-in upgrade pack
   Add to MacPiOs with ONE line before </body>:
       <script src="kay2os-extras.js" defer></script>
   100% additive. Touches nothing in the base file. Hooks only via the stable
   CSS classes (.window/.titlebar/.lights/.win-body/.dock/#windows/#wallpaper)
   and feature-detects everything else, so the lock screen / wired CONFIG /
   anything Claude Code changed all keep working.
   Adds: Mission Control (F3) · 4 new apps (Calculator, Notes, Activity Monitor,
   Visualizer) · Clive desktop widget · idle screensaver · UI sounds + boot
   chime · animated aurora wallpaper (⌃⌥W cycles) · keyboard window tiling
   (⌃⌥ arrows) · Show Desktop (F11 / bottom-right hot corner).
   ============================================================================ */
(function(){
  if (window.__kay2x) return; window.__kay2x = true;
  const $  = s => document.querySelector(s);
  const el = (t,c,h)=>{ const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
  const svg= d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const ls = { get(k,d){ try{const v=localStorage.getItem('k2x.'+k); return v==null?d:JSON.parse(v);}catch(e){return d;} },
               set(k,v){ try{localStorage.setItem('k2x.'+k,JSON.stringify(v));}catch(e){} } };
  const X = { z:1000, wins:{}, mc:false, showedDesktop:false };
  /* ---------- styles ---------- */
  const css = `
  .k2x-win .win-body{background:var(--win-bg-solid,#26262a);}
  .k2x-pad{padding:16px;height:100%;overflow:auto;color:var(--bg-text,#f5f5f7);font-family:var(--sf,-apple-system,sans-serif);}
  /* desktop widget */
  .k2x-widget{position:fixed;z-index:50;border-radius:18px;padding:15px 17px;min-width:210px;
    background:var(--win-bg,rgba(40,40,44,.72));backdrop-filter:saturate(180%) blur(26px);-webkit-backdrop-filter:saturate(180%) blur(26px);
    border:.5px solid var(--win-border,rgba(255,255,255,.12));box-shadow:0 18px 50px rgba(0,0,0,.45);color:var(--bg-text,#f5f5f7);
    font-family:var(--sf,sans-serif);cursor:grab;-webkit-user-select:none;user-select:none;}
  .k2x-widget .wx{position:absolute;top:9px;right:11px;opacity:0;font-size:13px;cursor:pointer;transition:opacity .15s;}
  .k2x-widget:hover .wx{opacity:.5;}
  .k2x-w-h{font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--clive,#2BE5FF);margin-bottom:9px;display:flex;align-items:center;gap:7px;}
  .k2x-w-h .dotpulse{width:7px;height:7px;border-radius:50%;background:var(--clive,#2BE5FF);box-shadow:0 0 8px var(--clive,#2BE5FF);animation:k2xpulse 2s infinite;}
  @keyframes k2xpulse{0%,100%{opacity:1}50%{opacity:.35}}
  .k2x-stat{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;font-variant-numeric:tabular-nums;}
  .k2x-stat b{font-weight:600;} .k2x-up{color:#32d74b;} .k2x-dn{color:#ff6961;}
  /* calculator */
  .k2x-calc{display:flex;flex-direction:column;height:100%;background:#1c1c1e;}
  .k2x-calc .disp{flex:0 0 auto;text-align:right;font-size:42px;font-weight:300;color:#fff;padding:22px 20px 14px;font-variant-numeric:tabular-nums;overflow:hidden;}
  .k2x-calc .grid{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#000;}
  .k2x-calc button{border:none;font-size:21px;color:#fff;background:#333;cursor:pointer;transition:filter .1s;font-family:var(--sf,sans-serif);}
  .k2x-calc button:active{filter:brightness(1.5);}
  .k2x-calc button.op{background:#ff9f0a;} .k2x-calc button.fn{background:#a5a5a5;color:#000;} .k2x-calc button.zero{grid-column:span 2;}
  /* notes */
  .k2x-notes{height:100%;width:100%;border:none;outline:none;resize:none;background:transparent;color:var(--bg-text,#f5f5f7);
    font-family:var(--mono,ui-monospace,monospace);font-size:14px;line-height:1.6;padding:16px;-webkit-user-select:text;user-select:text;}
  /* activity monitor */
  .k2x-am{padding:14px;height:100%;overflow:auto;background:var(--win-bg-solid,#1f1f23);}
  .k2x-am .graphs{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}
  .k2x-am .gcard{background:rgba(255,255,255,.05);border-radius:11px;padding:10px 12px;}
  .k2x-am .gcard .lbl{font-size:11px;color:var(--bg-text-dim,#9a9aa0);display:flex;justify-content:space-between;margin-bottom:4px;}
  .k2x-am canvas{width:100%;height:46px;display:block;}
  .k2x-am .plist{font-size:12.5px;font-variant-numeric:tabular-nums;}
  .k2x-am .plist .ph,.k2x-am .plist .pr{display:grid;grid-template-columns:1fr 64px 70px;gap:8px;padding:5px 6px;}
  .k2x-am .plist .ph{color:var(--bg-text-dim,#9a9aa0);font-weight:700;border-bottom:.5px solid var(--hairline,rgba(255,255,255,.09));}
  .k2x-am .plist .pr:nth-child(even){background:rgba(255,255,255,.03);}
  /* visualizer */
  .k2x-viz{position:relative;height:100%;background:radial-gradient(circle at 50% 40%,#10243a,#05080f);display:flex;flex-direction:column;}
  .k2x-viz canvas{flex:1;width:100%;display:block;}
  .k2x-viz .ctl{flex:0 0 auto;display:flex;gap:10px;align-items:center;justify-content:center;padding:12px;}
  .k2x-viz button{background:var(--clive,#2BE5FF);color:#04222a;border:none;font-weight:700;border-radius:20px;padding:8px 22px;cursor:pointer;font-family:var(--sf,sans-serif);}
  /* screensaver */
  #k2x-saver{position:fixed;inset:0;z-index:99999;background:#000;display:none;}
  #k2x-saver.on{display:block;}
  #k2x-saver .clk{position:absolute;left:0;right:0;bottom:9%;text-align:center;color:#fff;font-family:var(--sf,sans-serif);
    font-size:84px;font-weight:200;letter-spacing:-2px;text-shadow:0 2px 30px rgba(43,229,255,.5);font-variant-numeric:tabular-nums;}
  /* mission control */
  #k2x-mc{position:fixed;inset:0;z-index:4000;display:none;opacity:0;background:rgba(0,0,0,.45);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:opacity .26s ease;}
  #k2x-mc.on{display:block;opacity:1;}
  .mc-label{position:fixed;z-index:4002;transform:translate(-50%,0);padding:4px 11px;border-radius:9px;font:600 12.5px -apple-system,system-ui,sans-serif;
    color:#fff;background:rgba(20,20,28,.7);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:.5px solid rgba(255,255,255,.14);
    white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s ease .12s;box-shadow:0 6px 18px rgba(0,0,0,.4);}
  .mc-label.on{opacity:1;}
  /* toast */
  #k2x-toast{position:fixed;top:36px;right:12px;z-index:9600;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
  .k2x-tn{min-width:230px;max-width:320px;padding:11px 14px;border-radius:13px;background:var(--menu-pop,rgba(46,46,52,.82));
    backdrop-filter:saturate(180%) blur(26px);-webkit-backdrop-filter:saturate(180%) blur(26px);border:.5px solid var(--win-border,rgba(255,255,255,.12));
    box-shadow:0 14px 40px rgba(0,0,0,.5);color:var(--bg-text,#f5f5f7);font-family:var(--sf,sans-serif);font-size:13px;
    transform:translateX(120%);transition:transform .4s cubic-bezier(.22,.61,.36,1);pointer-events:auto;}
  .k2x-tn.in{transform:none;}
  .k2x-tn b{display:block;font-size:13.5px;margin-bottom:2px;}
  .k2x-tn .ag{color:var(--clive,#2BE5FF);}
  /* aurora wallpaper */
  @keyframes k2xaurora{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  body.k2x-aurora #wallpaper{background:linear-gradient(120deg,#06121f,#0d3b4d,#3a1f5e,#0a2a3f,#06121f)!important;
    background-size:300% 300%!important;animation:k2xaurora 26s ease infinite;}
  `;
  document.head.appendChild(el('style',null,css));
  /* ---------- toast / notification ---------- */
  const toastWrap = el('div'); toastWrap.id='k2x-toast'; document.body.appendChild(toastWrap);
  function notify(title, body, agent){
    const n=el('div','k2x-tn',`<b class="${agent?'ag':''}">${title}</b><span>${body||''}</span>`);
    toastWrap.appendChild(n); requestAnimationFrame(()=>n.classList.add('in'));
    setTimeout(()=>{ n.classList.remove('in'); setTimeout(()=>n.remove(),450); }, 4200);
  }
  window.k2xNotify = notify;
  /* ---------- audio engine (armed on first gesture) ---------- */
  let actx=null, soundOn=ls.get('sound',true);
  function arm(){ if(actx) return; try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
  function beep(freq,dur,type,gain){ if(!actx||!soundOn) return; const t=actx.currentTime;
    const o=actx.createOscillator(), g=actx.createGain(); o.type=type||'sine'; o.frequency.value=freq;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain||0.18,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t+dur); }
  function sound(name){ if(!soundOn) return;
    if(name==='pock') beep(420,0.09,'sine',0.12);
    else if(name==='launch'){ beep(560,0.10,'triangle',0.12); setTimeout(()=>beep(840,0.10,'triangle',0.10),60); }
    else if(name==='chime'){ [523.25,659.25,783.99,1046.5].forEach((f,i)=>setTimeout(()=>beep(f,0.7,'sine',0.14),i*120)); } }
  let armed=false;
  const armOnce=()=>{ if(armed) return; armed=true; arm(); setTimeout(()=>sound('chime'),120); };
  addEventListener('pointerdown',armOnce,{once:true}); addEventListener('keydown',armOnce,{once:true});
  /* ---------- mini window manager (for new apps; matches base styling) ---------- */
  function focusWin(win){ document.querySelectorAll('.window').forEach(w=>w.classList.remove('focused')); win.classList.add('focused'); win.style.zIndex=++X.z;
    const an=$('#mb-appname'); if(an&&win.dataset.title) an.textContent=win.dataset.title; }
  function drag(handle,win){
    handle.addEventListener('pointerdown',e=>{ if(e.target.closest('.light'))return; focusWin(win);
      const sx=e.clientX,sy=e.clientY,ol=win.offsetLeft,ot=win.offsetTop;
      const mv=ev=>{ win.style.left=Math.max(0,ol+ev.clientX-sx)+'px'; win.style.top=Math.max(28,ot+ev.clientY-sy)+'px'; };
      const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);};
      addEventListener('pointermove',mv); addEventListener('pointerup',up); });
  }
  function toggleMax(o){ const w=o.win;
    if(o.prev){ Object.assign(w.style,o.prev); o.prev=null; }
    else{ o.prev={left:w.style.left,top:w.style.top,width:w.style.width,height:w.style.height};
      w.style.left='6px'; w.style.top='34px'; w.style.width=(innerWidth-12)+'px'; w.style.height=(innerHeight-34-96)+'px'; } }
  function openApp(id,title,w,h,build,opaque){
    if(X.wins[id]){ const o=X.wins[id]; if(o.min){o.win.style.display='flex';o.min=false;} focusWin(o.win); return o; }
    const cont=$('#windows')||document.body;
    const win=el('div','window k2x-win'+(opaque?' opaque':'')); win.dataset.title=title;
    const W=Math.min(w,innerWidth-24), H=Math.min(h,innerHeight-130), n=Object.keys(X.wins).length;
    const L=clamp(Math.round((innerWidth-W)/2+((n*26)%140)-70),8,innerWidth-W-8), T=clamp(60+((n*24)%90),34,innerHeight-H-100);
    win.style.cssText=`position:absolute;pointer-events:auto;width:${W}px;height:${H}px;left:${L}px;top:${T}px;`;
    win.innerHTML=`<div class="titlebar"><div class="lights">
        <span class="light l-close">${svg('<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>')}</span>
        <span class="light l-min">${svg('<line x1="5" y1="12" x2="19" y2="12"/>')}</span>
        <span class="light l-max">${svg('<polyline points="7 13 7 7 13 7"/><polyline points="17 11 17 17 11 17"/>')}</span>
      </div><div class="wt">${title}</div></div><div class="win-body"></div>`;
    cont.appendChild(win);
    const o={win,id,min:false,prev:null}; X.wins[id]=o;
    win.addEventListener('pointerdown',()=>focusWin(win),true);
    win.querySelector('.l-close').addEventListener('click',e=>{e.stopPropagation(); if(o.cleanup)o.cleanup(); win.remove(); delete X.wins[id]; dockRunning(id,false); sound('pock');});
    win.querySelector('.l-min').addEventListener('click',e=>{e.stopPropagation(); win.style.display='none'; o.min=true;});
    win.querySelector('.l-max').addEventListener('click',e=>{e.stopPropagation(); toggleMax(o);});
    drag(win.querySelector('.titlebar'),win);
    focusWin(win); dockRunning(id,true); sound('pock');
    try{ build(win.querySelector('.win-body'),o); }catch(err){ win.querySelector('.win-body').innerHTML='<div class="k2x-pad">app failed to load</div>'; }
    return o;
  }
  /* ---------- dock integration (graceful if no dock) ---------- */
  const dock=$('#dock');
  function dockRunning(id,on){ const it=dock&&dock.querySelector(`.dock-item[data-x="${id}"]`); if(it)it.classList.toggle('running',on); }
  function addDockItem(id,name,grad,glyph,onClick){
    if(!dock) return;
    const it=el('div','dock-item'); it.dataset.x=id;
    it.innerHTML=`<div class="dock-tip">${name}</div><div class="dock-icon" style="background:${grad};color:#fff">${glyph}</div><div class="runningdot"></div>`;
    it.addEventListener('click',onClick);
    const trash=dock.querySelector('.dock-item[data-app="trash"]'); dock.insertBefore(it, trash||null);
  }
  // separator before extras (only if dock present)
  if(dock){ const trash=dock.querySelector('.dock-item[data-app="trash"]'); const sep=el('div','dock-sep'); dock.insertBefore(sep,trash||null); }
  /* ============================== NEW APPS ============================== */
  // Calculator
  function buildCalc(b){
    b.innerHTML=`<div class="k2x-calc"><div class="disp">0</div><div class="grid">
      <button class="fn" data-k="C">AC</button><button class="fn" data-k="neg">±</button><button class="fn" data-k="pct">%</button><button class="op" data-k="/">÷</button>
      <button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button><button class="op" data-k="*">×</button>
      <button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button><button class="op" data-k="-">−</button>
      <button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button><button class="op" data-k="+">+</button>
      <button class="zero" data-k="0">0</button><button data-k=".">.</button><button class="op" data-k="=">=</button></div></div>`;
    const disp=b.querySelector('.disp'); let cur='0',prev=null,op=null,fresh=false;
    const show=v=>{ disp.textContent=String(v).length>9?Number(v).toPrecision(7):v; };
    const calc=()=>{ const a=parseFloat(prev),c=parseFloat(cur); return op==='+'?a+c:op==='-'?a-c:op==='*'?a*c:op==='/'?a/c:c; };
    b.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{ const k=btn.dataset.k; sound('pock');
      if(/[0-9]/.test(k)){ cur=(cur==='0'||fresh)?k:cur+k; fresh=false; }
      else if(k==='.'){ if(!cur.includes('.'))cur+='.'; }
      else if(k==='C'){ cur='0';prev=null;op=null; }
      else if(k==='neg'){ cur=String(parseFloat(cur)*-1); }
      else if(k==='pct'){ cur=String(parseFloat(cur)/100); }
      else if(k==='='){ if(op!=null){ cur=String(calc()); op=null; prev=null; fresh=true; } }
      else{ if(op!=null&&!fresh){ cur=String(calc()); } prev=cur; op=k; fresh=true; }
      show(cur); }));
  }
  // Notes
  function buildNotes(b){ const ta=el('textarea','k2x-notes'); ta.value=ls.get('notes',"MacPiOs notes\n\nno talk just make."); ta.spellcheck=false;
    ta.addEventListener('input',()=>ls.set('notes',ta.value)); b.appendChild(ta); setTimeout(()=>ta.focus(),60); }
  // Activity Monitor
  function buildActivity(b,o){
    b.innerHTML=`<div class="k2x-am">
      <div class="graphs">
        <div class="gcard"><div class="lbl"><span>CPU</span><span class="v" data-v="cpu">—</span></div><canvas data-g="cpu"></canvas></div>
        <div class="gcard"><div class="lbl"><span>Memory</span><span class="v" data-v="mem">—</span></div><canvas data-g="mem"></canvas></div>
        <div class="gcard"><div class="lbl"><span>Network</span><span class="v" data-v="net">—</span></div><canvas data-g="net"></canvas></div>
        <div class="gcard"><div class="lbl"><span>Temp</span><span class="v" data-v="tmp">—</span></div><canvas data-g="tmp"></canvas></div>
      </div>
      <div class="plist"><div class="ph"><span>Process</span><span>%CPU</span><span>Memory</span></div>
        ${['clive','hermz','kay2tunnel','node','pm2','ollama','tailscaled'].map(p=>`<div class="pr" data-p="${p}"><span>${p}</span><span class="c">—</span><span class="m">—</span></div>`).join('')}
      </div></div>`;
    const series={cpu:[],mem:[],net:[],tmp:[]}, base={cpu:24,mem:58,net:12,tmp:48};
    const draw=(cv,arr,col,max)=>{ const w=cv.width=cv.clientWidth*2, h=cv.height=cv.clientHeight*2, c=cv.getContext('2d');
      c.clearRect(0,0,w,h); c.lineWidth=2.5; c.strokeStyle=col; c.beginPath();
      arr.forEach((v,i)=>{ const x=i/(arr.length-1)*w, y=h-(v/max)*h; i?c.lineTo(x,y):c.moveTo(x,y); }); c.stroke();
      const g=c.createLinearGradient(0,0,0,h); g.addColorStop(0,col+'55'); g.addColorStop(1,col+'00');
      c.lineTo(w,h); c.lineTo(0,h); c.closePath(); c.fillStyle=g; c.fill(); };
    const tick=()=>{ if(!document.body.contains(b)){return;}
      for(const k in series){ base[k]=clamp(base[k]+(Math.random()-0.5)*14,5,k==='tmp'?72:95); series[k].push(base[k]); if(series[k].length>40)series[k].shift(); }
      b.querySelector('[data-v="cpu"]').textContent=base.cpu.toFixed(0)+'%';
      b.querySelector('[data-v="mem"]').textContent=(base.mem/100*8).toFixed(1)+' / 8 GB';
      b.querySelector('[data-v="net"]').textContent=(base.net*12).toFixed(0)+' KB/s';
      b.querySelector('[data-v="tmp"]').textContent=base.tmp.toFixed(0)+'°C';
      draw(b.querySelector('[data-g="cpu"]'),series.cpu,'#2BE5FF',100);
      draw(b.querySelector('[data-g="mem"]'),series.mem,'#9b4dff',100);
      draw(b.querySelector('[data-g="net"]'),series.net,'#32d74b',100);
      draw(b.querySelector('[data-g="tmp"]'),series.tmp,'#ff9f0a',80);
      b.querySelectorAll('.pr').forEach(r=>{ r.querySelector('.c').textContent=(Math.random()*22).toFixed(1); r.querySelector('.m').textContent=(40+Math.random()*260).toFixed(0)+' MB'; });
    };
    tick(); o.timer=setInterval(tick,1000); o.cleanup=()=>clearInterval(o.timer);
  }
  // Visualizer (WebAudio drone + analyser)
  function buildViz(b,o){
    b.innerHTML=`<div class="k2x-viz"><canvas></canvas><div class="ctl"><button>▶ Play</button></div></div>`;
    const cv=b.querySelector('canvas'), btn=b.querySelector('button'); let playing=false,nodes=[],an=null,raf=null;
    const stop=()=>{ playing=false; btn.textContent='▶ Play'; nodes.forEach(n=>{try{n.stop&&n.stop();}catch(e){}}); nodes=[]; cancelAnimationFrame(raf); };
    o.cleanup=stop;
    const render=()=>{ if(!document.body.contains(b))return stop(); const w=cv.width=cv.clientWidth*2,h=cv.height=cv.clientHeight*2,c=cv.getContext('2d');
      c.clearRect(0,0,w,h); let data;
      if(an){ data=new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(data);} else { data=Array.from({length:48},()=>60+Math.random()*120); }
      const n=48, bw=w/n; for(let i=0;i<n;i++){ const v=(data[i]||0)/255, bh=v*h*0.9; const g=c.createLinearGradient(0,h,0,h-bh);
        g.addColorStop(0,'#2BE5FF'); g.addColorStop(1,'#9b4dff'); c.fillStyle=g; c.fillRect(i*bw+2,h-bh,bw-4,bh); }
      raf=requestAnimationFrame(render); };
    btn.addEventListener('click',()=>{ arm(); if(playing){stop();return;} playing=true; btn.textContent='■ Stop';
      if(actx){ an=actx.createAnalyser(); an.fftSize=128; const out=actx.createGain(); out.gain.value=0.12; out.connect(actx.destination); an.connect(out);
        [110,164.81,220,329.63].forEach((f,i)=>{ const osc=actx.createOscillator(); osc.type=i%2?'sine':'triangle'; osc.frequency.value=f;
          const lfo=actx.createOscillator(), lg=actx.createGain(); lfo.frequency.value=0.1+i*0.07; lg.gain.value=3; lfo.connect(lg).connect(osc.frequency); lfo.start();
          osc.connect(an); osc.start(); nodes.push(osc,lfo); }); }
      render(); });
    render();
  }
  addDockItem('calc','Calculator','linear-gradient(150deg,#3a3a3c,#1c1c1e)',svg('<rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="12" x2="9.01" y2="12"/><line x1="12" y1="12" x2="12.01" y2="12"/><line x1="15" y1="12" x2="15.01" y2="12"/>'),()=>openApp('calc','Calculator',280,400,buildCalc,true));
  addDockItem('notes','Notes','linear-gradient(150deg,#ffd45e,#ff9f0a)',svg('<path d="M5 4h14v16H5z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>'),()=>openApp('notes','Notes',420,460,buildNotes,true));
  addDockItem('activity','Activity','linear-gradient(150deg,#32d74b,#1a7a2e)',svg('<polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/>'),()=>openApp('activity','Activity Monitor',560,500,buildActivity,true));
  addDockItem('viz','Visualizer','linear-gradient(150deg,#2BE5FF,#9b4dff)',svg('<line x1="6" y1="9" x2="6" y2="15"/><line x1="10" y1="5" x2="10" y2="19"/><line x1="14" y1="8" x2="14" y2="16"/><line x1="18" y1="6" x2="18" y2="18"/>'),()=>openApp('viz','Visualizer',520,420,buildViz,true));
  addDockItem('mc','Mission Control','linear-gradient(150deg,#6e6e73,#3a3a3c)',svg('<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8" y="14" width="8" height="6" rx="1"/>'),()=>missionControl());
  /* ============================== CLIVE DESKTOP WIDGET ============================== */
  function makeWidget(id,build){
    const w=el('div','k2x-widget'); w.dataset.x=id; const pos=ls.get('wpos.'+id,null);
    w.style.left=(pos?pos.l:innerWidth-250)+'px'; w.style.top=(pos?pos.t:50)+'px';
    w.innerHTML=`<span class="wx">✕</span>`; document.body.appendChild(w);
    w.querySelector('.wx').addEventListener('click',()=>{ w.remove(); ls.set('wid.'+id,false); });
    w.addEventListener('pointerdown',e=>{ if(e.target.classList.contains('wx'))return; const sx=e.clientX,sy=e.clientY,ol=w.offsetLeft,ot=w.offsetTop; w.style.cursor='grabbing';
      const mv=ev=>{ w.style.left=clamp(ol+ev.clientX-sx,0,innerWidth-w.offsetWidth)+'px'; w.style.top=clamp(ot+ev.clientY-sy,28,innerHeight-w.offsetHeight)+'px'; };
      const up=()=>{ w.style.cursor='grab'; ls.set('wpos.'+id,{l:w.offsetLeft,t:w.offsetTop}); removeEventListener('pointermove',mv);removeEventListener('pointerup',up); };
      addEventListener('pointermove',mv); addEventListener('pointerup',up); });
    build(w); return w;
  }
  if(ls.get('wid.clive',true)){
    let pnl=2.4, whales=49, conv=2;
    const w=makeWidget('clive',c=>{ c.insertAdjacentHTML('beforeend',`
      <div class="k2x-w-h"><span class="dotpulse"></span>CLIVE</div>
      <div class="k2x-stat"><span>24h PnL</span><b class="pnl"></b></div>
      <div class="k2x-stat"><span>Whales tracked</span><b class="wh"></b></div>
      <div class="k2x-stat"><span>Convergence</span><b class="cv"></b></div>
      <div class="k2x-stat"><span>Heartbeat</span><b style="color:#32d74b">● live</b></div>`); });
    const upd=()=>{ if(!document.body.contains(w))return; pnl=clamp(pnl+(Math.random()-0.45)*0.6,-8,12);
      const prevConv=conv; if(Math.random()<0.12){ conv++; }
      w.querySelector('.pnl').textContent=(pnl>=0?'+':'')+pnl.toFixed(2)+'%'; w.querySelector('.pnl').className='pnl '+(pnl>=0?'k2x-up':'k2x-dn');
      w.querySelector('.wh').textContent=whales; w.querySelector('.cv').textContent=conv+' alerts';
      }; /* whale-convergence toast removed — real Pi alerts come from the base */
    upd(); setInterval(upd,3500);
  }
  /* ============================== MISSION CONTROL ============================== */
  let mcEl=el('div'); mcEl.id='k2x-mc'; document.body.appendChild(mcEl);
  function missionControl(){
    if(X.mc) return exitMC();
    const wins=[...document.querySelectorAll('#windows .window')].filter(w=>w.style.display!=='none'&&w.offsetParent!==null);
    if(!wins.length){ notify('Mission Control','No open windows.'); return; }
    X.mc=true; mcEl.classList.add('on'); sound('pock');
    const n=wins.length, cols=Math.ceil(Math.sqrt(n)), rows=Math.ceil(n/cols);
    const padX=60, padY=80, cw=(innerWidth-padX*2)/cols, ch=(innerHeight-padY*2)/rows;
    wins.forEach((w,i)=>{ w._mc={t:w.style.transition,tr:w.style.transform,z:w.style.zIndex};
      const r=i/cols|0, col=i%cols, rect=w.getBoundingClientRect();
      const cx=padX+col*cw+cw/2, cy=padY+r*ch+ch/2, s=Math.min(cw*0.86/rect.width, ch*0.86/rect.height,1);
      const tx=cx-(rect.left+rect.width/2), ty=cy-(rect.top+rect.height/2);
      w.style.transition='transform .34s cubic-bezier(.22,.7,.3,1) '+(i*0.028).toFixed(3)+'s'; w.style.zIndex=4001+i;
      w.style.transform=`translate(${tx}px,${ty}px) scale(${s})`; w.style.cursor='pointer';
      // title label under each tiled window
      const lbl=el('div'); lbl.className='mc-label'; lbl.textContent=(w.querySelector('.wt')||{}).textContent||'Window';
      lbl.style.left=cx+'px'; lbl.style.top=(cy+(rect.height*s)/2+8)+'px'; document.body.appendChild(lbl);
      requestAnimationFrame(()=>lbl.classList.add('on')); w._mcLabel=lbl;
      const pick=ev=>{ ev.stopPropagation(); exitMC(w); w.removeEventListener('click',pick); };
      w.addEventListener('click',pick); });
  }
  function exitMC(focus){ if(!X.mc)return; X.mc=false; mcEl.classList.remove('on');
    document.querySelectorAll('#windows .window').forEach(w=>{ if(w._mc){ w.style.transition='transform .3s cubic-bezier(.3,.7,.3,1)'; w.style.transform=w._mc.tr; w.style.zIndex=w._mc.z; w.style.cursor='';
      if(w._mcLabel){ w._mcLabel.remove(); w._mcLabel=null; }
      setTimeout(()=>{w.style.transition=w._mc.t; w._mc=null;},340); } });
    if(focus){ try{focusWin(focus);}catch(e){} } }
  mcEl.addEventListener('click',()=>exitMC());
  /* ============================== SHOW DESKTOP ============================== */
  function showDesktop(){ const wins=[...document.querySelectorAll('#windows .window')].filter(w=>w.style.display!=='none');
    if(!X.showedDesktop){ X.showedDesktop=true; wins.forEach(w=>{ w._sd={tr:w.style.transform,tn:w.style.transition}; w.style.transition='transform .3s ease';
      const r=w.getBoundingClientRect(), goRight=r.left+r.width/2>innerWidth/2; w.style.transform=`translateX(${goRight?innerWidth:-innerWidth}px)`; }); }
    else { X.showedDesktop=false; wins.forEach(w=>{ if(w._sd){ w.style.transform=w._sd.tr; setTimeout(()=>{if(w._sd){w.style.transition=w._sd.tn;w._sd=null;}},310); } }); } }
  /* ============================== SCREENSAVER ============================== */
  const saver=el('div'); saver.id='k2x-saver'; saver.innerHTML='<canvas></canvas><div class="clk"></div>'; document.body.appendChild(saver);
  let idleT=null, saverRaf=null;
  function startSaver(){ if(saver.classList.contains('on'))return; saver.classList.add('on'); const cv=saver.querySelector('canvas'),clk=saver.querySelector('.clk');
    const stars=Array.from({length:240},()=>({x:(Math.random()-0.5),y:(Math.random()-0.5),z:Math.random()}));
    const loop=()=>{ if(!saver.classList.contains('on'))return; const w=cv.width=innerWidth,h=cv.height=innerHeight,c=cv.getContext('2d');
      c.fillStyle='#000'; c.fillRect(0,0,w,h);
      stars.forEach(s=>{ s.z-=0.006; if(s.z<=0)s.z=1; const sx=w/2+(s.x/s.z)*w, sy=h/2+(s.y/s.z)*h, r=(1-s.z)*2.4;
        const a=(1-s.z); c.fillStyle=`rgba(43,229,255,${a})`; c.beginPath(); c.arc(sx,sy,r,0,7); c.fill(); });
      const d=new Date(); clk.textContent=(d.getHours()%12||12)+':'+String(d.getMinutes()).padStart(2,'0');
      saverRaf=requestAnimationFrame(loop); }; loop();
  }
  function stopSaver(){ if(!saver.classList.contains('on'))return; saver.classList.remove('on'); cancelAnimationFrame(saverRaf); }
  function resetIdle(){ if(saver.classList.contains('on'))stopSaver(); clearTimeout(idleT); idleT=setTimeout(startSaver, 90000); }
  ['pointermove','pointerdown','keydown','touchstart'].forEach(e=>addEventListener(e,resetIdle,{passive:true})); resetIdle();
  /* ============================== AURORA WALLPAPER ============================== */
  const walls=['off','aurora']; let wallIdx=ls.get('wall','off')==='aurora'?1:0;
  function applyWall(){ document.body.classList.toggle('k2x-aurora',walls[wallIdx]==='aurora'); ls.set('wall',walls[wallIdx]); }
  applyWall();
  function cycleWall(){ wallIdx=(wallIdx+1)%walls.length; applyWall(); notify('Wallpaper', walls[wallIdx]==='aurora'?'Aurora (animated)':'Default'); }
  /* ============================== KEYBOARD + HOT CORNER ============================== */
  function topWin(){ const ws=[...document.querySelectorAll('#windows .window')].filter(w=>w.style.display!=='none'); return ws.sort((a,b)=>(+a.style.zIndex||0)-(+b.style.zIndex||0)).pop(); }
  function tile(dir){ const w=topWin(); if(!w)return; const top=34, h=innerHeight-top-96, halfW=(innerWidth-12)/2;
    w.style.transition='all .18s ease'; setTimeout(()=>w.style.transition='',200);
    if(dir==='left'){ w.style.left='6px'; w.style.top=top+'px'; w.style.width=halfW+'px'; w.style.height=h+'px'; }
    if(dir==='right'){ w.style.left=(halfW+6)+'px'; w.style.top=top+'px'; w.style.width=halfW+'px'; w.style.height=h+'px'; }
    if(dir==='up'){ w.style.left='6px'; w.style.top=top+'px'; w.style.width=(innerWidth-12)+'px'; w.style.height=h+'px'; }
    if(dir==='down'){ const cw=Math.min(720,innerWidth-80); w.style.left=((innerWidth-cw)/2)+'px'; w.style.top=(top+20)+'px'; w.style.width=cw+'px'; w.style.height=Math.min(520,h)+'px'; } }
  addEventListener('keydown',e=>{
    if(e.key==='F3'){ e.preventDefault(); missionControl(); }
    else if(e.key==='F11'){ e.preventDefault(); showDesktop(); }
    else if(e.key==='Escape'&&X.mc){ exitMC(); }
    else if(e.ctrlKey&&e.altKey){ const k=e.key;
      if(k==='ArrowLeft'){e.preventDefault();tile('left');} else if(k==='ArrowRight'){e.preventDefault();tile('right');}
      else if(k==='ArrowUp'){e.preventDefault();tile('up');} else if(k==='ArrowDown'){e.preventDefault();tile('down');}
      else if(k.toLowerCase()==='w'){e.preventDefault();cycleWall();} }
  });
  // hot corner: bottom-right -> show desktop
  let hcT=null; addEventListener('pointermove',e=>{ if(e.clientX>innerWidth-4&&e.clientY>innerHeight-4){ if(!hcT)hcT=setTimeout(()=>{showDesktop();hcT=null;},350); } else { clearTimeout(hcT); hcT=null; } });
  /* ---------- sound toggle into Control Center (if present) ---------- */
  try{ const cc=$('#cc'); if(cc){ const card=cc.querySelector('.cc-card'); if(card){ const row=el('div','cc-row','Sound Effects'); const tg=el('div','cc-toggle'+(soundOn?' on':'')); row.appendChild(tg);
    tg.addEventListener('click',()=>{ soundOn=!soundOn; tg.classList.toggle('on',soundOn); ls.set('sound',soundOn); if(soundOn){arm();sound('pock');} }); card.appendChild(row); } } }catch(e){}
  /* ---------- ready ---------- */
  setTimeout(()=>notify('MacPiOs extras', 'Loaded ✦ Try the new dock apps · F3 Mission Control · ⌃⌥ arrows tile · idle for the screensaver'), 1400);
})();
