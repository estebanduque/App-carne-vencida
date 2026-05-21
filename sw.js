const CACHE = 'mis-carnes-v2';
const ASSETS = ['/App-carne-vencida/', '/App-carne-vencida/index.html', '/App-carne-vencida/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // No interceptar llamadas a workers.dev ni a anthropic
  if (e.request.url.includes('workers.dev') || e.request.url.includes('anthropic.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
