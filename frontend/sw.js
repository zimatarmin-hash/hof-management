const CACHE_NAME = 'hof-management-v6';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './api.js',
  './config.js',
  './manifest.json',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nur eigene App-Shell-Dateien betreffen diesen Handler. API-Aufrufe (Apps Script,
  // Geoserver, Google-Login) und alles andere gehen immer direkt ins Netz.
  if (url.origin !== self.location.origin) {
    return; // nicht abfangen, Standard-Netzwerkverhalten
  }

  // NETZWERK-ZUERST (nicht Cache-zuerst!): Solange die App aktiv weiterentwickelt wird,
  // soll ein Reload IMMER die aktuellste Version laden. Der Cache dient nur noch als
  // Rückfallebene für den Offline-Fall - kein "auf ewig veraltete Dateien"-Risiko mehr.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && event.request.method === 'GET') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
