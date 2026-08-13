// Service Worker: haelt die App offline verfuegbar.
// Programmdateien kommen aus dem Cache, der Plan wird immer zuerst frisch
// versucht - damit sind Aenderungen sofort da, aber ohne Netz zeigt die App
// trotzdem den letzten Stand.
const CACHE = 'stundenplan-v1';
const HUELLE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './shared/konfiguration.mjs',
  './shared/krypto.mjs',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// ------------------------------------------------------------ Mitteilungen

self.addEventListener('push', (e) => {
  let inhalt = { titel: 'Stundenplan', koerper: 'Es hat sich etwas geändert.' };
  try {
    if (e.data) inhalt = { ...inhalt, ...e.data.json() };
  } catch {
    if (e.data) inhalt.koerper = e.data.text();
  }

  e.waitUntil(
    self.registration.showNotification(inhalt.titel, {
      body: inhalt.koerper,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: inhalt.marke ?? 'stundenplan',
      renotify: true,
      data: { datum: inhalt.datum ?? null },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) {
        if (f.url.includes(self.registration.scope)) return f.focus();
      }
      return self.clients.openWindow('./index.html');
    })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Immer erst das Netz fragen, den Cache als Rueckfallebene fuellen.
  // Cache-First waere schneller, wuerde aber nach einem Update wochenlang
  // die alte App ausliefern - das ist den Bruchteil einer Sekunde nicht wert.
  e.respondWith(
    fetch(e.request)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwort;
      })
      .catch(() =>
        caches.match(e.request).then((treffer) => {
          if (treffer) return treffer;
          if (url.pathname.endsWith('plan.json')) {
            return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
          }
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        })
      )
  );
});
