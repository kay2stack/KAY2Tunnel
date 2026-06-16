/* kay2OS service worker — minimal, install-friendly.
   Caches the app shell + icons so the PWA launches offline (into demo mode when
   the backend is unreachable). The shell is fetched network-first so a redeploy
   is picked up immediately; static icons are cache-first. */
const CACHE = 'kay2os-v7';
const SHELL = ['./', './index.html', './kay2os-extras.js', './manifest.webmanifest',
  './xterm.min.js', './xterm.min.css', './xterm-addon-fit.min.js',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './apple-touch-icon.png', './favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                          // never cache API writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // let backend/CDN calls pass through
  const isDoc = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isDoc) {
    // network-first for the shell so deploys land instantly
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  } else {
    // cache-first for static assets (icons, etc.)
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(resp => {
      const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return resp;
    })));
  }
});
