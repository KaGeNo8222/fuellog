// Offline cache. Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = '1.2.0';
const CACHE = `fuellog-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './logic.js',
  './app.js',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './fonts/sarabun-400-thai.woff2',
  './fonts/sarabun-400-latin.woff2',
  './fonts/sarabun-600-thai.woff2',
  './fonts/sarabun-600-latin.woff2',
  './fonts/sarabun-700-thai.woff2',
  './fonts/sarabun-700-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fuellog-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request)));
});
