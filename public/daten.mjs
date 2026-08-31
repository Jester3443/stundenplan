// Speicher fuer alles, was Jasper selbst eintraegt: Notizen, Hausaufgaben,
// Noten, Klausuren, Fehlzeiten.
//
// Warum IndexedDB statt localStorage: Auf localStorage kann der Service
// Worker NICHT zugreifen. Er muss aber abends beim Eintreffen der
// Push-Nachricht nachsehen koennen, welche Hausaufgaben offen sind.
// Alles liegt verschluesselt - derselbe Schluessel wie beim Stundenplan.
import { verschluesseln, entschluesseln } from './shared/krypto.mjs?v=16';

const DB_NAME = 'stundenplan';
const LADEN = 'werte';

// Jede Person hat ihre eigene Ablage - auch wenn beide dasselbe Geraet nutzen.
let person = 'jasper';
export const setzePerson = (name) => { person = name; };
const schluesselName = () => (person === 'jasper' ? 'schluessel' : `schluessel:${person}`);
const datenName = () => (person === 'jasper' ? 'meineDaten' : `meineDaten:${person}`);

/**
 * Verbindung zur Datenbank - mit Zeitgrenze.
 * indexedDB.open() loest weder auf noch ab, wenn die Datenbank gerade
 * blockiert ist (z. B. weil ein anderer Tab sie loescht). Ohne Zeitgrenze
 * bliebe die App dann ewig bei "Lade ..." stehen.
 */
function db() {
  return Promise.race([
    new Promise((fertig, fehler) => {
      const anfrage = indexedDB.open(DB_NAME, 1);
      anfrage.onupgradeneeded = () => {
        if (!anfrage.result.objectStoreNames.contains(LADEN)) {
          anfrage.result.createObjectStore(LADEN);
        }
      };
      anfrage.onsuccess = () => fertig(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error);
      anfrage.onblocked = () => fehler(new Error('Datenbank blockiert'));
    }),
    new Promise((_, fehler) => setTimeout(() => fehler(new Error('Datenbank antwortet nicht')), 3000)),
  ]);
}

/**
 * Liest einen Wert. Wirft bei einem Lesefehler bewusst weiter:
 * "nichts gespeichert" und "konnte nicht gelesen werden" duerfen NICHT
 * verwechselt werden - sonst wuerde die App gespeicherte Daten mit einem
 * leeren Stand ueberschreiben.
 */
async function hole(schluessel) {
  const verbindung = await db();
  return new Promise((fertig, fehler) => {
    const a = verbindung.transaction(LADEN, 'readonly').objectStore(LADEN).get(schluessel);
    a.onsuccess = () => fertig(a.result ?? null);
    a.onerror = () => fehler(a.error);
  });
}

async function lege(schluessel, wert) {
  try {
    const verbindung = await db();
    await new Promise((fertig, fehler) => {
      const t = verbindung.transaction(LADEN, 'readwrite');
      t.objectStore(LADEN).put(wert, schluessel);
      t.oncomplete = () => fertig();
      t.onerror = () => fehler(t.error);
    });
  } catch {
    /* Speichern fehlgeschlagen - die App laeuft trotzdem weiter */
  }
}

// ------------------------------------------------------------- Schluessel

const b64ein = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64aus = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function schluesselSichern(schluessel) {
  const roh = await crypto.subtle.exportKey('raw', schluessel);
  await lege(schluesselName(), b64ein(roh));
  localStorage.removeItem('schluessel'); // alter Ablageort
}

export async function schluesselLaden() {
  try {
    // Umzug von localStorage: einmalig uebernehmen, damit niemand neu entsperren muss.
    const alt = localStorage.getItem('schluessel');
    if (alt) {
      await lege(schluesselName(), alt);
      localStorage.removeItem('schluessel');
    }
    const gespeichert = await hole(schluesselName());
    if (!gespeichert) return null;
    return await crypto.subtle.importKey('raw', b64aus(gespeichert), 'AES-GCM', true, ['encrypt', 'decrypt']);
  } catch {
    return null; // fuehrt nur zur Code-Abfrage, richtet keinen Schaden an
  }
}

export async function schluesselVergessen() {
  localStorage.removeItem('schluessel');
  await lege(schluesselName(), null);
}

// ---------------------------------------------------------- Meine Daten

export const LEER = () => ({
  version: 1,
  notizen: {},   // "datum|von|kurs" -> { aufgabe, notiz, erledigt }
  noten: {},     // "DE1" -> [ { id, art, punkte, datum, titel } ]
  klausuren: [], // { id, kurs, datum, thema }
  fehlzeiten: [], // { id, datum, art, stunden, entschuldigt, grund }
  lernen: {}, // "klausurId|datum" -> true, wenn die Lernetappe erledigt ist
  // Laufende Statistik: wie viel Unterricht hat je Fach stattgefunden?
  // Der Plan reicht nur wenige Wochen zurueck, deshalb zaehlt die App mit.
  stundenSumme: {}, // "DE1" -> Anzahl stattgefundener Stunden
  gezaehlteTage: {}, // "2026-08-17" -> true, damit kein Tag doppelt zaehlt
  gewichtung: {} // "DE1" -> 40 (Prozentanteil der schriftlichen Noten)
});

/** Sorgt dafuer, dass alle Felder vorhanden sind - auch nach einem Update. */
const vervollstaendige = (daten) => ({ ...LEER(), ...(daten ?? {}) });

export async function ladeMeineDaten(schluessel) {
  const paket = await hole(datenName());

  // Erstmaliger Umzug: die alten Notizen aus localStorage uebernehmen.
  if (!paket) {
    const alt = localStorage.getItem('notizen');
    if (alt && schluessel) {
      try {
        const inhalt = JSON.parse(alt);
        const notizen = inhalt?.iv ? await entschluesseln(inhalt, schluessel) : inhalt;
        const daten = vervollstaendige({ notizen });
        await speichereMeineDaten(daten, schluessel);
        localStorage.removeItem('notizen');
        return daten;
      } catch {
        /* nicht lesbar - dann eben leer anfangen */
      }
    }
    return LEER();
  }

  // Ohne Schluessel liegt der Stand im Klartext - das gibt es nur bei der
  // lokalen Entwicklung, im Betrieb ist immer verschluesselt.
  if (!paket.iv) return vervollstaendige(paket);

  // Ab hier gilt: Es SIND Daten da. Wenn sie sich nicht oeffnen lassen,
  // muss das ein Fehler sein - niemals ein leerer Stand, der anschliessend
  // ueber die echten Daten geschrieben wird.
  if (!schluessel) throw new Error('Kein Schluessel zum Entsperren der eigenen Daten');
  return vervollstaendige(await entschluesseln(paket, schluessel));
}

export async function speichereMeineDaten(daten, schluessel) {
  // Auch ohne Schluessel speichern - sonst gingen Eintraege bei der
  // lokalen Entwicklung stillschweigend verloren.
  await lege(datenName(), schluessel ? await verschluesseln(daten, schluessel) : daten);
}

/** Kleine Kennung fuer neue Eintraege - ohne Zufallsquelle, damit es stabil bleibt. */
export const neueId = () => `${Date.now().toString(36)}${Math.floor(performance.now() * 1000).toString(36)}`;
