// Offline support: cache the whole app shell, serve it cache-first.
// Bump VERSION on every release so phones pick up the new files.
const VERSION = 'v1.5.0';
const CACHE = 'lift-log-' + VERSION;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './src/styles.css',
  './src/app.js',
  './src/components.js',
  './src/db.js',
  './src/device.js',
  './src/myo.js',
  './src/progression.js',
  './src/program.js',
  './src/importer.js',
  './src/seed.js',
  './src/session-logic.js',
  './src/sheets.js',
  './src/store.js',
  './src/sync.js',
  './src/util.js',
  './src/vendor/preact-htm.js',
  './src/views/exercises.js',
  './src/views/history.js',
  './src/views/more.js',
  './src/views/session.js',
  './src/views/templates.js',
  './src/views/train.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lift-log-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google Sheets calls go straight to the network
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
