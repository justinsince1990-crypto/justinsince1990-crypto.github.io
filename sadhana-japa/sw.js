/* Sadhana Japa service worker: cache-first, fully offline. No network calls beyond its own files. */
var CACHE = 'sadhana-japa-v7';
var LEGACY = 'sadhana-japa-v1'; // v1 pages have no update prompt, so they are upgraded automatically
var FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); })
    .then(function () { return caches.has(LEGACY); })
    .then(function (legacy) { if (legacy) return self.skipWaiting(); }));
});
self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.has(LEGACY).then(function (legacy) {
    return caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
      .then(function () {
        if (!legacy) return;
        // Reload open v1 pages once so they pick up the new app. Data lives in localStorage and is untouched.
        return self.clients.matchAll({ type: 'window' }).then(function (cs) { cs.forEach(function (c) { if (c.navigate) c.navigate(c.url).catch(function () {}); }); });
      });
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (cs) { if (cs.length) return cs[0].focus(); return self.clients.openWindow('./'); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (r) {
    return r || fetch(e.request).then(function (resp) { var copy = resp.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return resp; }).catch(function () { return caches.match('./index.html'); });
  }));
});
