// Service Worker: haelt die App offline verfuegbar und sorgt dafuer,
// dass Updates beim naechsten Oeffnen sofort uebernommen werden.
// WICHTIG: Bei jedem App-Update die Versionsnummer hier UND die ?v=-Anhaenge
// in index.html/app.js gemeinsam hochzaehlen.
const CACHE = 'stundenplan-v8';
const HUELLE = [
  './',
  './index.html',
  './styles.css?v=8',
  './app.js?v=8',
  './shared/konfiguration.mjs?v=8',
  './shared/krypto.mjs?v=8',
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

// ---------------------------------------------------------------- Abrufe

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Die Plandaten kommen auch von GitHub - alles andere Fremde geht am
  // Cache vorbei direkt ins Netz.
  const eigene = url.origin === self.location.origin;
  const daten = url.hostname === 'raw.githubusercontent.com';
  if (!eigene && !daten) return;

  // Immer erst das Netz fragen, den Cache als Rueckfallebene fuellen.
  // Cache-First waere schneller, wuerde aber nach einem Update die alte App
  // ausliefern - das ist den Bruchteil einer Sekunde nicht wert.
  // Der ?t=...-Anhang dient nur dem Frischhalten - im Cache soll je Datei
  // genau EIN Eintrag liegen, sonst waechst er mit jedem Abruf.
  const ablageSchluessel = url.searchParams.has('t') ? url.origin + url.pathname : e.request;

  e.respondWith(
    fetch(e.request)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(ablageSchluessel, kopie));
        }
        return antwort;
      })
      .catch(() =>
        // ignoreSearch: der ?t=...-Anhang beim Aktualisieren und die
        // ?v=-Versionen sollen den Offline-Treffer nicht verhindern.
        caches.match(e.request, { ignoreSearch: true }).then((treffer) => {
          if (treffer) return treffer;
          if (url.pathname.endsWith('.json')) {
            return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
          }
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        })
      )
  );
});
