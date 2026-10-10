const CACHE = 'vade-mecum-shell-v2';
const SHELL = ['/', '/index.html', '/app.css', '/app.js?v=2', '/db.js', '/local-parser.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/.netlify/')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
