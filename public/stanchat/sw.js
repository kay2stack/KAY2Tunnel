// Stan Chat — app-shell service worker. Cache-first for the shell, never for
// /api or WebSockets. Bump CACHE_VERSION on every change.
const CACHE_VERSION = 'stan-chat-v4';
const SHELL = [
  './', './index.html', './chat.css', './chat.js', './manifest.webmanifest',
  '/brand/tokens.css', '/brand/icon.svg',
  '/icons/icon-192.png', '/icons/icon-512.png',
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
