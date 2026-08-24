// Speicher fuer alles, was Jasper selbst eintraegt: Notizen, Hausaufgaben,
// Noten, Klausuren, Fehlzeiten.
//
// Warum IndexedDB statt localStorage: Auf localStorage kann der Service
// Worker NICHT zugreifen. Er muss aber abends beim Eintreffen der
// Push-Nachricht nachsehen koennen, welche Hausaufgaben offen sind.
// Alles liegt verschluesselt - derselbe Schluessel wie beim Stundenplan.
import { verschluesseln, entschluesseln } from './shared/krypto.mjs?v=10';

const DB_NAME = 'stundenplan';
const LADEN = 'werte';

function db() {
  return new Promise((fertig, fehler) => {
    const anfrage = indexedDB.open(DB_NAME, 1);
    anfrage.onupgradeneeded = () => {
      if (!anfrage.result.objectStoreNames.contains(LADEN)) {
        anfrage.result.createObjectStore(LADEN);
      }
    };
    anfrage.onsuccess = () => fertig(anfrage.result);
    anfrage.onerror = () => fehler(anfrage.error);
  });
}

async function hole(schluessel) {
  const verbindung = await db();
  return new Promise((fertig, fehler) => {
    const a = verbindung.transaction(LADEN, 'readonly').objectStore(LADEN).get(schluessel);
    a.onsuccess = () => fertig(a.result ?? null);
    a.onerror = () => fehler(a.error);
  });
}

async function lege(schluessel, wert) {
  const verbindung = await db();
  return new Promise((fertig, fehler) => {
    const t = verbindung.transaction(LADEN, 'readwrite');
    t.objectStore(LADEN).put(wert, schluessel);
    t.oncomplete = () => fertig();
    t.onerror = () => fehler(t.error);
  });
}

// ------------------------------------------------------------- Schluessel

const b64ein = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64aus = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function schluesselSichern(schluessel) {
  const roh = await crypto.subtle.exportKey('raw', schluessel);
  await lege('schluessel', b64ein(roh));
  localStorage.removeItem('schluessel'); // alter Ablageort
}

export async function schluesselLaden() {
  // Umzug von localStorage: einmalig uebernehmen, damit niemand neu entsperren muss.
  const alt = localStorage.getItem('schluessel');
  if (alt) {
    await lege('schluessel', alt);
    localStorage.removeItem('schluessel');
  }
  const gespeichert = await hole('schluessel');
  if (!gespeichert) return null;
  try {
    return await crypto.subtle.importKey('raw', b64aus(gespeichert), 'AES-GCM', true, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

export async function schluesselVergessen() {
  localStorage.removeItem('schluessel');
  await lege('schluessel', null);
}

// ---------------------------------------------------------- Meine Daten

export const LEER = () => ({
  version: 1,
  notizen: {},   // "datum|von|kurs" -> { aufgabe, notiz, erledigt }
  noten: {},     // "DE1" -> [ { id, art, punkte, datum, titel } ]
  klausuren: [], // { id, kurs, datum, thema }
  fehlzeiten: [] // { id, datum, art, stunden, entschuldigt, grund }
});

/** Sorgt dafuer, dass alle Felder vorhanden sind - auch nach einem Update. */
const vervollstaendige = (daten) => ({ ...LEER(), ...(daten ?? {}) });

export async function ladeMeineDaten(schluessel) {
  const paket = await hole('meineDaten');

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
  if (!schluessel) return LEER();
  try {
    return vervollstaendige(await entschluesseln(paket, schluessel));
  } catch {
    return LEER();
  }
}

export async function speichereMeineDaten(daten, schluessel) {
  // Auch ohne Schluessel speichern - sonst gingen Eintraege bei der
  // lokalen Entwicklung stillschweigend verloren.
  await lege('meineDaten', schluessel ? await verschluesseln(daten, schluessel) : daten);
}

/** Kleine Kennung fuer neue Eintraege - ohne Zufallsquelle, damit es stabil bleibt. */
export const neueId = () => `${Date.now().toString(36)}${Math.floor(performance.now() * 1000).toString(36)}`;
