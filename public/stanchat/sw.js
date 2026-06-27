// Stan Chat — app-shell service worker. Cache-first for the shell, never for
// /api or WebSockets. Bump CACHE_VERSION on every change.
const CACHE_VERSION = 'stan-chat-v22';
const SHELL = [
  './', './index.html', './chat.css', './chat.js', './manifest.webmanifest',
  './icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  '/brand/tokens.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c =>
    Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))
  ));
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
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request)); return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// ── Web Push — turn-complete / autopilot pings ────────────────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(data.title || 'StanAI', {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || '/stanchat/' },
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/stanchat/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    // Focus an existing StanChat window if one's open; tell it which chat to show.
    for (const w of wins) {
      if (w.url.includes('/stanchat') && 'focus' in w) {
        try { w.postMessage({ type: 'open-chat', url: target }); } catch {}
        return w.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
