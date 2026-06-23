const CACHE_VERSION = 'stan-cli-v50';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/term.js',
  '/projects.js',
  '/agents.js',
  '/diff.js',
  '/pi.js',
  '/browser.js',
  '/files.js',
  '/ai.js',
  '/manifest.webmanifest',
  '/brand/tokens.css',
  '/brand/icon.svg',
  '/vendor/xterm.js',
  '/vendor/xterm.css',
  '/vendor/addon-fit.js',
  '/vendor/addon-web-links.js',
  '/vendor/codemirror.js',
  '/vendor/qrcode.js',
  '/vendor/jsqr.js',
  '/vendor/novnc.js',
  '/vendor/novnc-loader.js',
  '/screen.js',
  '/phone.js',
  '/ops.js',
  '/chatpane.js',
  '/shell.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c =>
      // {cache:'reload'} bypasses the browser HTTP cache so a new version always
      // pulls fresh bytes — otherwise a bumped cache can be filled with stale assets.
      Promise.allSettled(SHELL_ASSETS.map(url => c.add(new Request(url, { cache: 'reload' }))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request)); return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// ── Web Push ──────────────────────────────────────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(data.title || 'Stan CLI', {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    for (const w of wins) { if ('focus' in w) return w.focus(); }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
