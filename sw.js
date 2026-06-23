const CACHE = 'mis-carnes-v3';
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
  if (e.request.url.includes('workers.dev') || e.request.url.includes('anthropic.com') || e.request.url.includes('supabase.co')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
