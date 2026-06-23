// chatpane.js — the native Chat tab in the Stan CLI cockpit.
//
// Part of the Stan ecosystem unification: instead of the Chat button jumping out
// to the standalone StanChat PWA, we mount the SAME chat client (public/stanchat/
// chat.js + chat.css) right here, inside a Shadow DOM, so it renders natively in
// the cockpit with zero CSS collisions against styles.css. One codebase, two
// surfaces — StanChat stays a standalone product too.
(() => {
  'use strict';
  let mounted = false;

  async function activate() {
    const host = document.getElementById('chat-host');
    if (!host || !host.attachShadow) return;

    if (mounted) {                       // tab re-shown — nudge the socket + scroll
      try { window.StanChat?.show?.(); } catch {}
      return;
    }
    mounted = true;

    const shadow = host.attachShadow({ mode: 'open' });
    // Pull the chat's stylesheet verbatim and inject it into the shadow root.
    let css = '';
    try { css = await fetch('/stanchat/chat.css').then(r => r.text()); } catch {}

    if (window.StanChat) {
      window.StanChat.mount({ root: shadow, standalone: false, css });
    } else {
      // chat.js failed to load — show a graceful fallback with a link to the app.
      host.innerHTML =
        '<div style="padding:40px 20px;text-align:center;color:var(--text-dim);font-size:14px">' +
        'Chat failed to load. <a href="/stanchat/" style="color:var(--accent)">Open StanChat ↗</a></div>';
      mounted = false;
    }
  }

  window.Chat = { activate };
})();
