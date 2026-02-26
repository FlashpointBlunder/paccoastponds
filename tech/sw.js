// Service Worker — Pacific Coast Ponds Tech App
const CACHE = 'pcp-tech-v1';
const PRECACHE = ['/', '/index.html', '/supabase.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for assets
  if (e.request.url.includes('supabase.co') || e.request.url.includes('googleapis')) {
    return; // Let these go straight to network
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
