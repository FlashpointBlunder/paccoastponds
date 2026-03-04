const CACHE = 'pcp-sales-v1';
const PRECACHE = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Always network for API/auth calls
  if (
    e.request.url.includes('supabase.co') ||
    e.request.url.includes('stripe.com') ||
    e.request.url.includes('googleapis.com') ||
    e.request.url.includes('.netlify/functions')
  ) return;
  // Network-first with cache fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
