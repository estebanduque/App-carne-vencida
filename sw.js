const CACHE = 'mis-carnes-v10';
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
  if (e.request.url.includes('workers.dev') || 
      e.request.url.includes('anthropic.com') || 
      e.request.url.includes('supabase.co')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
 
// Manejar notificaciones push entrantes
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'Mi App', body: e.data.text() }; }
  
  e.waitUntil(
    self.registration.showNotification(data.title || 'Mi App', {
      body: data.body || '',
      icon: '/App-carne-vencida/icon-192.png',
      badge: '/App-carne-vencida/icon-192.png',
      vibrate: [200, 100, 200],
      requireInteraction: false
    })
  );
});
 
// Abrir la app al hacer clic en la notificación
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('App-carne-vencida') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/App-carne-vencida/');
    })
  );
});
