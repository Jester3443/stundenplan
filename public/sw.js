// Service Worker: haelt die App offline verfuegbar, sorgt fuer Updates und
// reichert Push-Nachrichten um die eigenen Hausaufgaben an.
// WICHTIG: Bei jedem App-Update die Versionsnummer hier UND die ?v=-Anhaenge
// in index.html/app.js gemeinsam hochzaehlen.
const CACHE = 'stundenplan-v27';
const HUELLE = [
  './',
  './index.html',
  './styles.css?v=27',
  './app.js?v=27',
  './bereiche.mjs?v=27',
  './daten.mjs?v=27',
  './symbole.mjs?v=27',
  './shared/konfiguration.mjs?v=27',
  './shared/klausurplan.mjs?v=27',
  './shared/krypto.mjs?v=27',
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
  // Catalinas zusaetzliche Kurse
  ch1: 'Chemie',
  PO1: 'Politik',
  wn1: 'Werte und Normen',
  snN1: 'Spanisch',
  // Sport (seit 21.09.2026)
  'sp1-3': 'Sport',
  'sp1-1': 'Sport',
};

const b64aus = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * Ein Wert aus der Datenbank der App - mit Zeitgrenze.
 *
 * Auf einem kalt gestarteten iPhone kann indexedDB.open() haengen bleiben
 * (die App selbst hat deshalb laengst eine Zeitgrenze). Ohne Zeitgrenze hier
 * wuerde die Mitteilung nie angezeigt - und iOS entzieht einer App, die auf
 * Push-Nachrichten mehrfach nichts anzeigt, stillschweigend die Anmeldung.
 * Danach kaeme GAR NICHTS mehr an, auch keine Erinnerung.
 */
function ausDatenbank(name) {
  const lesen = new Promise((fertig) => {
    try {
      const anfrage = indexedDB.open('stundenplan', 1);
      anfrage.onerror = () => fertig(null);
      anfrage.onblocked = () => fertig(null);
      anfrage.onsuccess = () => {
        const verbindung = anfrage.result;
        const ende = (wert) => {
          try {
            verbindung.close();
          } catch {
            /* egal */
          }
          fertig(wert);
        };
        try {
          if (!verbindung.objectStoreNames.contains('werte')) return ende(null);
          const a = verbindung.transaction('werte', 'readonly').objectStore('werte').get(name);
          a.onsuccess = () => ende(a.result ?? null);
          a.onerror = () => ende(null);
        } catch {
          ende(null);
        }
      };
    } catch {
      fertig(null);
    }
  });
  return Promise.race([lesen, new Promise((fertig) => setTimeout(() => fertig(null), 2000))]);
}

/**
 * Auf diesem Geraet angemeldete Person - die App vermerkt sie in der
 * Datenbank, weil der Hintergrunddienst kein localStorage lesen kann.
 * Ohne den Vermerk laese er auf Catalinas Handy immer Jaspers (leere) Ablage.
 */
async function speicherNamen() {
  const person = (await ausDatenbank('benutzer')) ?? 'jasper';
  const anhang = person === 'jasper' ? '' : `:${person}`;
  return { schluessel: `schluessel${anhang}`, daten: `meineDaten${anhang}` };
}

/** Offene eigene Aufgaben und Lernetappen fuer ein Datum. */
async function eigeneAufgaben(datum) {
  try {
    const namen = await speicherNamen();
    const schluesselB64 = await ausDatenbank(namen.schluessel);
    const paket = await ausDatenbank(namen.daten);
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

/**
 * Nur die offenen Hausaufgaben fuer ein Datum (fuer die 15:40-Erinnerung).
 * null = die eigenen Daten waren gerade nicht lesbar. Das ist etwas anderes
 * als "nichts offen" - sonst hiesse es faelschlich "alles erledigt".
 */
async function offeneAufgabenFuer(datum) {
  try {
    const namen = await speicherNamen();
    const schluesselB64 = await ausDatenbank(namen.schluessel);
    const paket = await ausDatenbank(namen.daten);
    if (!schluesselB64 || !paket?.iv) return null;
    const schluessel = await crypto.subtle.importKey('raw', b64aus(schluesselB64), 'AES-GCM', false, ['decrypt']);
    const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64aus(paket.iv) }, schluessel, b64aus(paket.daten));
    return JSON.parse(new TextDecoder().decode(klar)).aufgabenVorschau?.[datum] ?? [];
  } catch {
    return null;
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
      let titel = inhalt.titel;
      let koerper = inhalt.koerper;

      // Das Anreichern mit eigenen Daten darf die Mitteilung nie verhindern:
      // Geht dabei irgendetwas schief, wird der Text vom Server angezeigt.
      try {
        // Die 15:40-Erinnerung kennt der Server nicht inhaltlich - er stoesst sie
        // nur an, den Text bauen wir hier aus den lokalen Aufgaben.
        if (inhalt.marke === 'aufgaben' && inhalt.datum) {
          const offen = await offeneAufgabenFuer(inhalt.datum);
          if (offen === null) {
            koerper = koerper || 'Schau kurz in die App, was für morgen ansteht.';
          } else if (offen.length) {
            titel = offen.length === 1 ? 'Eine Hausaufgabe für morgen' : `${offen.length} Hausaufgaben für morgen`;
            koerper = offen.slice(0, 4).join('\n');
          } else {
            titel = 'Nichts mehr offen ✓';
            koerper = 'Für morgen ist alles erledigt.';
          }
        }

        // Bei der Abend- und Morgenmeldung die eigenen Aufgaben anhaengen.
        if (inhalt.datum && (inhalt.marke === 'abendblick' || inhalt.marke === 'morgen')) {
          const eigene = await eigeneAufgaben(inhalt.datum);
          if (eigene.length) {
            koerper = `${koerper ? koerper + '\n' : ''}Offen: ${eigene.slice(0, 3).join(' · ')}`;
          }
        }
      } catch {
        /* dann eben ohne die eigenen Daten */
      }

      await self.registration.showNotification(titel, {
        body: koerper,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        // "stapel" schickt der Server bei Erinnerungen mit (eine je Stunde),
        // damit zwei Erinnerungen am selben Tag einander nicht ersetzen.
        tag: inhalt.stapel ?? inhalt.marke ?? 'stundenplan',
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
          // Frueher kam hier fuer .json-Pfade ein leeres "{}" mit Status 200
          // zurueck. Die App hielt das fuer ein gueltiges Datenpaket, konnte
          // es nicht entschluesseln - und verwarf daraufhin den gespeicherten
          // Schluessel. Ergebnis: Offline musste man den Code neu eingeben.
          // Ein ehrlicher Fehler ist besser als eine falsche Antwort.
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        })
      )
  );
});
