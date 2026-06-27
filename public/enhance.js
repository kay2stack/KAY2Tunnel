/* Stan CLI cockpit — enhancements (additive only).
   NEVER touches core scripts. Wrapped to fail silent so a bug here can never
   break the live cockpit. Exposes window.__enhToast(msg) for reuse. */
(function () {
  'use strict';

  // Shared toast helper.
  var toastEl;
  function toast(msg) {
    try {
      if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'enh-toast'; document.body.appendChild(toastEl); }
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1400);
    } catch (e) {}
  }
  window.__enhToast = toast;

  // JS scrollTo({behavior:'smooth'}) ignores prefers-reduced-motion (CSS scroll-behavior respects it).
  // Resolve the right behavior per call so reduced-motion users get instant jumps.
  function smoothBehavior() {
    try { return (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth'; }
    catch (e) { return 'smooth'; }
  }

  // Feature: gentle fade-in for newly added chat messages.
  // #thread mounts lazily (when the Chat tab opens), so poll for it, then observe.
  try {
    if ('MutationObserver' in window) {
      var attached = false, ticks = 0;
      var poll = setInterval(function () {
        ticks++;
        var thread = document.getElementById('thread');
        if (thread && !attached) {
          attached = true;
          var skip = { 'empty-state': 1, 'jump-btn': 1 };
          new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
              var added = muts[i].addedNodes;
              for (var j = 0; j < added.length; j++) {
                var n = added[j];
                if (n.nodeType === 1 && !skip[n.id]) {
                  try { n.classList.add('enh-in'); } catch (e) {}
                }
              }
            }
          }).observe(thread, { childList: true });
        }
        if (attached || ticks > 250) clearInterval(poll); // give up after ~5 min
      }, 1200);
    }
  } catch (e) { /* never break the cockpit */ }

  // Feature: subtle fade-in for Home-feed cards as they populate.
  try {
    var feed = document.getElementById('home-feed');
    if (feed && 'MutationObserver' in window) {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType === 1) { try { n.classList.add('enh-in'); } catch (e) {} }
          }
        }
      }).observe(feed, { childList: true });
    }
  } catch (e) {}

  // Feature: "scroll to top" affordance for long chat threads.
  try {
    var stTicks = 0;
    var stPoll = setInterval(function () {
      stTicks++;
      var thread = document.getElementById('thread');
      if (thread && thread.parentNode && !thread._enhTop) {
        thread._enhTop = true;
        var btn = document.createElement('button');
        btn.className = 'enh-totop'; btn.type = 'button'; btn.setAttribute('aria-label', 'Scroll to top');
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        btn.addEventListener('click', function () { try { thread.scrollTo({ top: 0, behavior: smoothBehavior() }); } catch (e) { thread.scrollTop = 0; } });
        thread.parentNode.appendChild(btn);
        thread.addEventListener('scroll', function () {
          try { if (thread.scrollTop > 600) btn.classList.add('show'); else btn.classList.remove('show'); } catch (e) {}
        }, { passive: true });
      }
      if ((thread && thread._enhTop) || stTicks > 250) clearInterval(stPoll);
    }, 1200);
  } catch (e) {}

  // Feature: subtle haptic on send (mobile). Delegated so it survives lazy mount.
  try {
    if (navigator.vibrate) {
      document.addEventListener('click', function (e) {
        try { if (e.target && e.target.closest && e.target.closest('#send-btn')) navigator.vibrate(8); } catch (er) {}
      }, true);
    }
  } catch (e) {}

  // Feature: double-tap a message to copy its text. No chrome; double-tap doesn't fight
  // native long-press selection, and we skip interactive bits (buttons/links/code already copy).
  try {
    var dtTicks = 0;
    var dtPoll = setInterval(function () {
      dtTicks++;
      var thread = document.getElementById('thread');
      if (thread && !thread._enhCopy) {
        thread._enhCopy = true;
        thread.addEventListener('dblclick', function (e) {
          try {
            var t = e.target;
            if (t.closest('button, a, input, textarea, .code-bar, pre, code')) return;
            // Double-tap empty thread space → jump to latest (complements #jump-btn).
            if (!t.closest('.turn')) {
              try { thread.scrollTo({ top: thread.scrollHeight, behavior: smoothBehavior() }); } catch (e2) { thread.scrollTop = thread.scrollHeight; }
              return;
            }
            var turn = t.closest('.turn.assistant, .turn.user');
            if (!turn) return;
            var src = turn.querySelector('.prose') || turn.querySelector('.turn-body') || turn;
            var text = (src.innerText || '').trim();
            if (!text || !navigator.clipboard) return;
            navigator.clipboard.writeText(text).then(function () {
              if (navigator.vibrate) navigator.vibrate(8);
              if (window.__enhToast) window.__enhToast('Copied message');
            }).catch(function () {});
          } catch (err) {}
        });
      }
      if ((thread && thread._enhCopy) || dtTicks > 250) clearInterval(dtPoll);
    }, 1200);
  } catch (e) {}

  // Feature: a cute "Stan cat" mascot on the welcome screen (only shows before you start chatting).
  try {
    var ecTicks = 0;
    var ecPoll = setInterval(function () {
      ecTicks++;
      var es = document.getElementById('empty-state');
      if (es && !es._enhCat) {
        es._enhCat = true;
        var wrap = document.createElement('div');
        wrap.className = 'enh-cat'; wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML = '<img class="enh-cat-img" src="/stanchat/img/stan-hero.png" alt="" draggable="false">';
        es.appendChild(wrap);
      }
      if ((es && es._enhCat) || ecTicks > 250) clearInterval(ecPoll);
    }, 1200);
  } catch (e) {}

  // Feature: Stan reacts — thinking-cat peeks in while the agent is working (#status-dot.thinking).
  try {
    var scTicks = 0;
    var scPoll = setInterval(function () {
      scTicks++;
      var dot = document.getElementById('status-dot');
      if (dot && !window._enhStatusCat) {
        window._enhStatusCat = true;
        var cat = document.createElement('div');
        cat.className = 'enh-statuscat'; cat.setAttribute('aria-hidden', 'true');
        cat.innerHTML = '<img src="/stanchat/img/stan-thinking.png" alt="">';
        document.body.appendChild(cat);
        var update = function () {
          try { if (dot.classList.contains('thinking')) cat.classList.add('show'); else cat.classList.remove('show'); } catch (e) {}
        };
        new MutationObserver(update).observe(dot, { attributes: true, attributeFilter: ['class'] });
        update();
      }
      if (window._enhStatusCat || scTicks > 250) clearInterval(scPoll);
    }, 1200);
  } catch (e) {}

  // Feature: Stan on the auth/lock screen — swap the mascot image to cute Stan + float.
  try {
    var amTicks = 0;
    var amPoll = setInterval(function () {
      amTicks++;
      var am = document.querySelector('img.auth-mascot');
      if (am && !am._enhStan) {
        am._enhStan = true;
        am.src = '/stanchat/img/stan-hero.png';
        am.classList.add('enh-auth-stan');
      }
      if ((am && am._enhStan) || amTicks > 200) clearInterval(amPoll);
    }, 800);
  } catch (e) {}

  // Feature: Stan greeting in the home hero (only if app.js hasn't filled it — never clobber core).
  try {
    var hhTicks = 0;
    var hhPoll = setInterval(function () {
      hhTicks++;
      var hero = document.getElementById('home-hero');
      if (hero && !hero._enhStan && !hero.innerHTML.trim()) {
        hero._enhStan = true;
        hero.innerHTML = '<div class="enh-hero-stan"><img src="/stanchat/img/stan-hero.png" alt=""><div class="enh-hero-txt"><b>Stan’s ready.</b><span>Your Pi, in your pocket.</span></div></div>';
      }
      if ((hero && hero._enhStan) || hhTicks > 200) clearInterval(hhPoll);
    }, 1000);
  } catch (e) {}

  // Easter eggs 🥚 — hidden, fun, fail-silent.
  try {
    function party() {
      try {
        if (window.__enhToast) window.__enhToast('🎉 You found Party Stan!');
        var rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        var n = rm ? 0 : 22;
        var poses = ['celebrating', 'peeking', 'hero', 'napping', 'thinking'];
        for (var i = 0; i < n; i++) {
          (function () {
            var d = document.createElement('div'); d.className = 'enh-rain';
            d.style.left = (Math.random() * 100) + 'vw';
            var dur = 2.4 + Math.random() * 1.9; d.style.animationDuration = dur.toFixed(2) + 's';
            d.style.animationDelay = (Math.random() * 0.6).toFixed(2) + 's';
            d.style.setProperty('--enh-rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
            d.innerHTML = '<img src="/stanchat/img/stan-' + poses[Math.floor(Math.random() * poses.length)] + '.png" alt="">';
            document.body.appendChild(d);
            setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, dur * 1000 + 1200);
          })();
        }
        try { if (navigator.vibrate) navigator.vibrate([10, 40, 10]); } catch (e) {}
        try { localStorage.setItem('stan_party', '1'); } catch (e) {}
      } catch (e) {}
    }
    window.__enhParty = party;

    // Egg 1: tap any Stan 5× quickly.
    var taps = 0, tapT = 0;
    document.addEventListener('click', function (e) {
      try {
        var t = e.target;
        if (t && t.closest && (t.closest('.enh-cat') || t.closest('.enh-hero-stan') || (t.classList && t.classList.contains('auth-mascot')) || t.closest('.enh-statuscat'))) {
          var now = Date.now(); if (now - tapT > 1200) taps = 0; tapT = now; taps++;
          if (taps >= 5) { taps = 0; party(); }
        }
      } catch (err) {}
    }, true);

    // Egg 2: konami code (desktop bonus) ↑↑↓↓←→←→ B A.
    var K = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65], ki = 0;
    document.addEventListener('keydown', function (e) {
      try {
        ki = (e.keyCode === K[ki]) ? ki + 1 : (e.keyCode === K[0] ? 1 : 0);
        if (ki === K.length) { ki = 0; party(); }
      } catch (err) {}
    });
  } catch (e) {}

  // Feature: Stan celebrates when a turn completes (#status-dot leaves 'thinking').
  try {
    var ceTicks = 0, wasThinking = false;
    var cePoll = setInterval(function () {
      ceTicks++;
      var dot = document.getElementById('status-dot');
      if (dot && !window._enhCelebrate) {
        window._enhCelebrate = true;
        var cel = document.createElement('div'); cel.className = 'enh-celebrate'; cel.setAttribute('aria-hidden', 'true');
        cel.innerHTML = '<img src="/stanchat/img/stan-celebrating.png" alt="">';
        document.body.appendChild(cel);
        var check = function () {
          try {
            var now = dot.classList.contains('thinking');
            if (wasThinking && !now) {
              cel.classList.add('pop');
              try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
              clearTimeout(cel._t); cel._t = setTimeout(function () { cel.classList.remove('pop'); }, 1600);
            }
            wasThinking = now;
          } catch (e) {}
        };
        new MutationObserver(check).observe(dot, { attributes: true, attributeFilter: ['class'] });
        check();
      }
      if (window._enhCelebrate || ceTicks > 250) clearInterval(cePoll);
    }, 1200);
  } catch (e) {}
})();
