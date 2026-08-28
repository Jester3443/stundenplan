// Service Worker: haelt die App offline verfuegbar, sorgt fuer Updates und
// reichert Push-Nachrichten um die eigenen Hausaufgaben an.
// WICHTIG: Bei jedem App-Update die Versionsnummer hier UND die ?v=-Anhaenge
// in index.html/app.js gemeinsam hochzaehlen.
const CACHE = 'stundenplan-v12';
const HUELLE = [
  './',
  './index.html',
  './styles.css?v=12',
  './app.js?v=12',
  './bereiche.mjs?v=12',
  './daten.mjs?v=12',
  './symbole.mjs?v=12',
  './shared/konfiguration.mjs?v=12',
  './shared/krypto.mjs?v=12',
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

// ------------------------------------------- Eigene Daten nachschlagen
// Der Server kennt nur WebUntis. Was Jasper selbst eingetragen hat, liegt
// verschluesselt auf dem Geraet - hier lesen wir es beim Eintreffen der
// Nachricht nach und haengen es an.

// Kurzform -> Klarname. Bewusst doppelt gepflegt: ein klassischer Service
// Worker kann die Konfigurationsdatei der App nicht importieren.
const FAECHER = {
  DE1: 'Deutsch',
  ma2: 'Mathematik',
  en1: 'Englisch',
  bi2: 'Biologie',
  ph1: 'Physik',
  GE1: 'Geschichte',
  EK1: 'Erdkunde',
  sf3: 'Seminarfach',
};

const b64aus = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function ausDatenbank(name) {
  return new Promise((fertig) => {
    const anfrage = indexedDB.open('stundenplan', 1);
    anfrage.onerror = () => fertig(null);
    anfrage.onsuccess = () => {
      const verbindung = anfrage.result;
      if (!verbindung.objectStoreNames.contains('werte')) return fertig(null);
      const a = verbindung.transaction('werte', 'readonly').objectStore('werte').get(name);
      a.onsuccess = () => fertig(a.result ?? null);
      a.onerror = () => fertig(null);
    };
  });
}

/** Offene eigene Aufgaben und Lernetappen fuer ein Datum. */
async function eigeneAufgaben(datum) {
  try {
    const schluesselB64 = await ausDatenbank('schluessel');
    const paket = await ausDatenbank('meineDaten');
    if (!schluesselB64 || !paket?.iv) return [];

    const schluessel = await crypto.subtle.importKey('raw', b64aus(schluesselB64), 'AES-GCM', false, ['decrypt']);
    const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64aus(paket.iv) }, schluessel, b64aus(paket.daten));
    const daten = JSON.parse(new TextDecoder().decode(klar));

    const treffer = [];
    for (const [id, eintrag] of Object.entries(daten.notizen ?? {})) {
      const [tag, , kurs] = id.split('|');
      if (tag !== datum || !eintrag.aufgabe || eintrag.erledigt) continue;
      treffer.push(`${FAECHER[kurs] ?? kurs}: ${eintrag.aufgabe}`);
    }
    // Lernetappen zu anstehenden Klausuren - die App legt sie fertig ab.
    for (const text of daten.lernVorschau?.[datum] ?? []) treffer.push(text);
    return treffer;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ Mitteilungen

self.addEventListener('push', (e) => {
  let inhalt = { titel: 'Stundenplan', koerper: 'Es hat sich etwas geändert.' };
  try {
    if (e.data) inhalt = { ...inhalt, ...e.data.json() };
  } catch {
    if (e.data) inhalt.koerper = e.data.text();
  }

  e.waitUntil(
    (async () => {
      let koerper = inhalt.koerper;

      // Bei der Abend- und Morgenmeldung die eigenen Aufgaben anhaengen.
      if (inhalt.datum && (inhalt.marke === 'abendblick' || inhalt.marke === 'morgen')) {
        const eigene = await eigeneAufgaben(inhalt.datum);
        if (eigene.length) {
          koerper = `${koerper ? koerper + '\n' : ''}Offen: ${eigene.slice(0, 3).join(' · ')}`;
        }
      }

      await self.registration.showNotification(inhalt.titel, {
        body: koerper,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: inhalt.marke ?? 'stundenplan',
        renotify: true,
        data: { datum: inhalt.datum ?? null },
      });
    })()
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

  const eigene = url.origin === self.location.origin;
  const daten = url.hostname === 'raw.githubusercontent.com';
  if (!eigene && !daten) return;

  // Der ?t=...-Anhang dient nur dem Frischhalten - im Cache soll je Datei
  // genau EIN Eintrag liegen, sonst waechst er mit jedem Abruf.
  const ablageSchluessel = url.searchParams.has('t') ? url.origin + url.pathname : e.request;

  // Immer erst das Netz fragen, den Cache als Rueckfallebene fuellen.
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
