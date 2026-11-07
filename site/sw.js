/* Orbuni service worker — receives notifications when the site is closed. */
const TAG_PREFIX = 'orbuni-';

self.addEventListener('install',  e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {
    try { d = { title: 'Orbuni', body: event.data.text() }; } catch (__) {}
  }
  const title = d.title || 'Orbuni';
  const opts = {
    body:  d.body || '',
    icon:  d.icon  || '/icon-192.png',
    badge: d.badge || '/badge-96.png',
    tag:   TAG_PREFIX + (d.tag || 'general'),
    renotify: true,
    requireInteraction: !!d.important,
    data: { url: d.url || '/', kind: d.kind || null },
    timestamp: Date.now()
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.indexOf(self.registration.scope) === 0) {
        await c.focus();
        c.postMessage({ orbuni: 'open', url: target });
        return;
      }
    }
    await clients.openWindow(target);
  })());
});
