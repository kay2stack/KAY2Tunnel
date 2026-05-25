const CACHE_VERSION = 'stan-cli-v10';
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
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c =>
      Promise.allSettled(SHELL_ASSETS.map(url => c.add(url)))
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
