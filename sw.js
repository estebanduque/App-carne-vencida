const CACHE = 'mis-carnes-v1';
const ASSETS = ['/App-carne-vencida/', '/App-carne-vencida/index.html', '/App-carne-vencida/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
