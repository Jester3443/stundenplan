// Speicher fuer alles, was selbst eingetragen wird: Notizen, Hausaufgaben,
// Noten, Klausuren, Fehlzeiten.
//
// Warum IndexedDB statt localStorage: Auf localStorage kann der Service
// Worker NICHT zugreifen. Er muss aber abends beim Eintreffen der
// Push-Nachricht nachsehen koennen, welche Hausaufgaben offen sind.
// Alles liegt verschluesselt - derselbe Schluessel wie beim Stundenplan.
//
// Zusaetzlich haelt diese Datei den Abgleich zwischen mehreren Geraeten:
// jedes Geraet arbeitet auf seinem eigenen Stand und schiebt ihn
// verschluesselt in die Cloud; beim Laden werden beide Staende verschmolzen.
import { verschluesseln, entschluesseln } from './shared/krypto.mjs?v=20';

const DB_NAME = 'stundenplan';
const LADEN = 'werte';

// Jede Person hat ihre eigene Ablage - auch wenn beide dasselbe Geraet nutzen.
let person = 'jasper';
export const setzePerson = (name) => {
  person = name;
  letzterStand = null; // Ablage gewechselt - alter Vergleichsstand gilt nicht mehr
  // Auch in der Datenbank vermerken - der Hintergrunddienst braucht es,
  // um bei Push-Nachrichten die richtigen Daten zu entschluesseln.
  lege('benutzer', name).catch(() => {});
};
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
      if (!globalThis.indexedDB) return fehler(new Error('Keine Datenbank verfuegbar'));
      const anfrage = indexedDB.open(DB_NAME, 1);
      anfrage.onupgradeneeded = () => {
        if (!anfrage.result.objectStoreNames.contains(LADEN)) {
          anfrage.result.createObjectStore(LADEN);
        }
      };
      anfrage.onsuccess = () => fertig(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error ?? new Error('Datenbank nicht lesbar'));
      anfrage.onblocked = () => fehler(new Error('Datenbank blockiert'));
    }),
    new Promise((_, fehler) => setTimeout(() => fehler(new Error('Datenbank antwortet nicht')), 8000)),
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
  try {
    return await new Promise((fertig, fehler) => {
      const a = verbindung.transaction(LADEN, 'readonly').objectStore(LADEN).get(schluessel);
      a.onsuccess = () => fertig(a.result ?? null);
      a.onerror = () => fehler(a.error);
    });
  } finally {
    // Verbindung wieder schliessen: Safari haelt sonst jede offene Verbindung
    // fest, bis irgendwann kein open() mehr antwortet.
    verbindung.close();
  }
}

async function lege(schluessel, wert) {
  try {
    const verbindung = await db();
    try {
      await new Promise((fertig, fehler) => {
        const t = verbindung.transaction(LADEN, 'readwrite');
        t.objectStore(LADEN).put(wert, schluessel);
        t.oncomplete = () => fertig();
        t.onerror = () => fehler(t.error);
        t.onabort = () => fehler(t.error ?? new Error('Abgebrochen'));
      });
    } finally {
      verbindung.close();
    }
    return true;
  } catch {
    return false; // Speichern fehlgeschlagen - die App laeuft trotzdem weiter
  }
}

// ------------------------------------------------------- Cloud-Sicherung
// Verschluesselte Kopie der eigenen Daten bei Firestore. Zwei Aufgaben:
// 1. "fuer immer" - iOS darf den App-Speicher unter Platzdruck raeumen.
// 2. Abgleich zwischen Handy und iPad.
// Der Ablageort wird aus dem Schluessel abgeleitet und ist ohne den
// Zugangscode nicht einmal auffindbar.

const SICHERUNG_BASIS =
  'https://firestore.googleapis.com/v1/projects/stundenplan-jasper/databases/(default)/documents/sicherung';

/**
 * Unauffindbarer, aber deterministischer Ablagename je Person und Zweck.
 * Der Zweck geht in den Hash ein, damit sich zwei Ablagen derselben Person
 * (Sicherung, Push-Anmeldung) von aussen nicht einander zuordnen lassen.
 */
async function ablageId(schluessel, zweck = '') {
  const roh = new Uint8Array(await crypto.subtle.exportKey('raw', schluessel));
  const anhang = new TextEncoder().encode(zweck);
  const zusammen = new Uint8Array(roh.length + anhang.length);
  zusammen.set(roh);
  zusammen.set(anhang, roh.length);
  const hash = await crypto.subtle.digest('SHA-256', zusammen);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sicherungsId = (schluessel) => ablageId(schluessel, '');

let letzteSicherung = ''; // nicht zweimal denselben Inhalt hochladen

/** Laedt das verschluesselte Paket in die Cloud. Gibt zurueck, ob es geklappt hat. */
export async function sicherungHochladen(paket, schluessel, kennung = '') {
  try {
    if (kennung && kennung === letzteSicherung) return true;
    const id = await sicherungsId(schluessel);
    const antwort = await fetch(`${SICHERUNG_BASIS}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          iv: { stringValue: paket.iv },
          daten: { stringValue: paket.daten },
          stand: { stringValue: new Date().toISOString().slice(0, 16) },
        },
      }),
    });
    if (antwort.ok && kennung) letzteSicherung = kennung;
    return antwort.ok;
  } catch {
    return false; // offline - naechster Versuch beim naechsten Speichern
  }
}

/**
 * Holt die Cloud-Sicherung.
 * Rueckgabe: { paket } | { leer: true } (es gibt keine) | { fehler: true }.
 * Der Unterschied ist wichtig: "es gibt nichts" ist harmlos, "nicht
 * erreichbar" darf niemals als "nichts vorhanden" gedeutet werden.
 */
export async function sicherungHolen(schluessel) {
  let antwort;
  try {
    const id = await sicherungsId(schluessel);
    antwort = await fetch(`${SICHERUNG_BASIS}/${id}`, { cache: 'no-store' });
  } catch {
    return { fehler: true };
  }
  if (antwort.status === 404) return { leer: true };
  if (!antwort.ok) return { fehler: true };
  try {
    const dok = await antwort.json();
    const iv = dok.fields?.iv?.stringValue;
    const daten = dok.fields?.daten?.stringValue;
    if (!iv || !daten) return { leer: true };
    return { paket: { iv, daten } };
  } catch {
    return { fehler: true };
  }
}

// --------------------------------------------------------- Push-Anmeldung
// Frueher musste die Anmeldung von Hand aus der App kopiert und als Secret
// hinterlegt werden - bei jedem Neuinstallieren erneut, und bis dahin kamen
// keine Mitteilungen mehr an. Jetzt hinterlegt die App sie selbst,
// verschluesselt und unter einem aus dem Schluessel abgeleiteten Namen.

const PUSH_BASIS =
  'https://firestore.googleapis.com/v1/projects/stundenplan-jasper/databases/(default)/documents/push';

let letztePushAnmeldung = '';

/**
 * Traegt die Push-Anmeldung dieses Geraets ein - ohne die der anderen
 * Geraete zu verdraengen (Handy UND iPad sollen Mitteilungen bekommen).
 */
export async function pushAnmeldungHinterlegen(anmeldung, schluessel) {
  if (!anmeldung?.endpoint || !schluessel) return false;
  try {
    const text = JSON.stringify(anmeldung);
    if (text === letztePushAnmeldung) return true;

    const id = await ablageId(schluessel, 'push');

    // Erst ansehen, was schon hinterlegt ist.
    let liste = [];
    const vorhanden = await fetch(`${PUSH_BASIS}/${id}`, { cache: 'no-store' }).catch(() => null);
    if (vorhanden?.ok) {
      try {
        const dok = await vorhanden.json();
        const alt = await entschluesseln(
          { iv: dok.fields.iv.stringValue, daten: dok.fields.daten.stringValue },
          schluessel
        );
        liste = (Array.isArray(alt) ? alt : alt?.geraete ?? []).filter((g) => g?.anmeldung?.endpoint);
      } catch {
        liste = []; // unlesbar - neu anfangen ist besser als gar keine Mitteilungen
      }
    }

    const heute = new Date().toISOString().slice(0, 10);
    liste = liste.filter((g) => g.anmeldung.endpoint !== anmeldung.endpoint);
    liste.push({ anmeldung, geraet: navigator.userAgent.slice(0, 80), seit: heute });

    const paket = await verschluesseln({ geraete: liste }, schluessel);
    const antwort = await fetch(`${PUSH_BASIS}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          iv: { stringValue: paket.iv },
          daten: { stringValue: paket.daten },
          stand: { stringValue: new Date().toISOString().slice(0, 16) },
        },
      }),
    });
    if (antwort.ok) letztePushAnmeldung = text;
    return antwort.ok;
  } catch {
    return false;
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
  version: 2,
  notizen: {},   // "datum|von|kurs" -> { aufgabe, notiz, erledigt }
  noten: {},     // "DE1" -> [ { id, art, punkte, datum, titel } ]
  klausuren: [], // { id, kurs, datum, thema }
  // Frei eingetragene Hausaufgaben - unabhaengig von einer konkreten Stunde,
  // damit man sie auch fuer Tage anlegen kann, an denen das Fach nicht liegt.
  aufgaben: [], // { id, kurs, faellig, text, erledigt }
  fehlzeiten: [], // { id, datum, art, stunden, entschuldigt, grund }
  lernen: {}, // "klausurId|datum" -> true, wenn die Lernetappe erledigt ist
  // Laufende Statistik: wie viel Unterricht hat je Fach stattgefunden?
  // Der Plan reicht nur wenige Wochen zurueck, deshalb zaehlt die App mit.
  stundenSumme: {}, // "DE1" -> Anzahl (Altbestand vor der Geraete-Sync)
  tagesStunden: {}, // "2026-08-17" -> { "DE1": 2 } - je Tag, damit sich zwei
  //                    Geraete sauber zusammenfuehren lassen
  gezaehlteTage: {}, // "2026-08-17" -> true, damit kein Tag doppelt zaehlt
  gewichtung: {}, // "DE1" -> 40 (Prozentanteil der schriftlichen Noten)
  // Fuer den Abgleich zwischen Geraeten: wann wurde welcher Eintrag zuletzt
  // geaendert bzw. geloescht. Ohne die Loeschvermerke kaeme ein geloeschter
  // Eintrag vom anderen Geraet immer wieder zurueck.
  stand: {},
  geloescht: {},
});

/** Sorgt dafuer, dass alle Felder vorhanden sind - auch nach einem Update. */
const vervollstaendige = (daten) => ({ ...LEER(), ...(daten ?? {}) });

// ------------------------------------------------- Abgleich zweier Staende

/** Trennzeichen fuer Pfade. Bewusst ein Steuerzeichen: kommt in keinem Kuerzel vor. */
const T = '\u0001';

/**
 * Zerlegt einen Datensatz in einzeln vergleichbare Eintraege.
 * Nur diese Teile werden zwischen Geraeten abgeglichen - Zaehlwerte
 * (stundenSumme, tagesStunden, gezaehlteTage) haben ihre eigene Regel.
 */
function eintraege(daten) {
  const raus = new Map();
  for (const [id, wert] of Object.entries(daten.notizen ?? {})) raus.set(`notizen${T}${id}`, wert);
  for (const [kurs, liste] of Object.entries(daten.noten ?? {})) {
    for (const n of liste ?? []) raus.set(`noten${T}${kurs}${T}${n.id}`, n);
  }
  for (const feld of ['klausuren', 'aufgaben', 'fehlzeiten']) {
    for (const e of daten[feld] ?? []) raus.set(`${feld}${T}${e.id}`, e);
  }
  for (const [k, v] of Object.entries(daten.lernen ?? {})) raus.set(`lernen${T}${k}`, v);
  for (const [k, v] of Object.entries(daten.gewichtung ?? {})) raus.set(`gewichtung${T}${k}`, v);
  return raus;
}

/** Setzt einen zerlegten Eintrag wieder an seinen Platz. */
function einsetzen(ziel, pfad, wert) {
  const teile = pfad.split(T);
  const kopf = teile[0];
  const rest = teile.slice(1).join(T);
  if (kopf === 'notizen') ziel.notizen[rest] = wert;
  else if (kopf === 'noten') (ziel.noten[teile[1]] ??= []).push(wert);
  else if (kopf === 'klausuren' || kopf === 'aufgaben' || kopf === 'fehlzeiten') ziel[kopf].push(wert);
  else if (kopf === 'lernen') ziel.lernen[rest] = wert;
  else if (kopf === 'gewichtung') ziel.gewichtung[rest] = wert;
}

/** Bringt Listen wieder in die Reihenfolge, die die Anzeige erwartet. */
function sortiere(daten) {
  daten.klausuren.sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''));
  daten.aufgaben.sort((a, b) => (a.faellig ?? '').localeCompare(b.faellig ?? ''));
  daten.fehlzeiten.sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));
  for (const liste of Object.values(daten.noten)) {
    liste.sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));
  }
  return daten;
}

/** Vergleichsstand des zuletzt geladenen/gespeicherten Datensatzes. */
let letzterStand = null;

/**
 * Vermerkt, was sich seit dem letzten Speichern geaendert hat.
 * Das passiert zentral beim Speichern - so muss keine einzelne
 * Eingabemaske daran denken, einen Zeitstempel zu setzen.
 */
export function stempeln(daten) {
  const jetzt = new Date().toISOString();
  const aktuell = eintraege(daten);
  daten.stand ??= {};
  daten.geloescht ??= {};

  if (letzterStand) {
    for (const [pfad, wert] of aktuell) {
      const alt = letzterStand.get(pfad);
      if (alt === undefined || JSON.stringify(alt) !== JSON.stringify(wert)) {
        daten.stand[pfad] = jetzt;
        delete daten.geloescht[pfad];
      }
    }
    for (const pfad of letzterStand.keys()) {
      if (!aktuell.has(pfad)) {
        daten.geloescht[pfad] = jetzt;
        delete daten.stand[pfad];
      }
    }
  } else {
    // Erster Speichervorgang nach dem Laden ohne Vergleichsstand: alles,
    // was noch keinen Zeitstempel hat, bekommt jetzt einen.
    for (const pfad of aktuell.keys()) daten.stand[pfad] ??= jetzt;
  }

  letzterStand = aktuell;
  return daten;
}

/**
 * Fuehrt zwei Staende zusammen. `meins` gewinnt bei Gleichstand.
 * Grundregel: Wer einen Eintrag zuletzt angefasst hat, bestimmt ihn -
 * auch wenn "anfassen" hiess: loeschen.
 */
export function verschmelze(meins, fremd) {
  const a = vervollstaendige(meins);
  const b = vervollstaendige(fremd);
  const ergebnis = LEER();

  const eintragA = eintraege(a);
  const eintragB = eintraege(b);
  const standA = a.stand ?? {};
  const standB = b.stand ?? {};
  const wegA = a.geloescht ?? {};
  const wegB = b.geloescht ?? {};

  const pfade = new Set([
    ...eintragA.keys(), ...eintragB.keys(),
    ...Object.keys(wegA), ...Object.keys(wegB),
  ]);

  for (const pfad of pfade) {
    const zeitA = wegA[pfad] ?? standA[pfad] ?? '';
    const zeitB = wegB[pfad] ?? standB[pfad] ?? '';
    // Ohne Zeitstempel auf beiden Seiten (Altbestand): behalten statt loeschen.
    const nimmA = zeitA === zeitB ? eintragA.has(pfad) || !eintragB.has(pfad) : zeitA > zeitB;

    const quelle = nimmA ? eintragA : eintragB;
    const weg = nimmA ? wegA : wegB;
    const stand = nimmA ? standA : standB;

    if (!quelle.has(pfad)) {
      // Auf der gewinnenden Seite ist der Eintrag weg - Loeschvermerk behalten,
      // damit er nicht beim naechsten Abgleich wieder auftaucht.
      if (weg[pfad]) ergebnis.geloescht[pfad] = weg[pfad];
      continue;
    }
    einsetzen(ergebnis, pfad, quelle.get(pfad));
    if (stand[pfad]) ergebnis.stand[pfad] = stand[pfad];
  }

  // Zaehlwerte: Tage vereinigen. Jeder Tag zaehlt genau einmal, egal welches
  // Geraet ihn erfasst hat.
  ergebnis.gezaehlteTage = { ...b.gezaehlteTage, ...a.gezaehlteTage };
  ergebnis.tagesStunden = { ...b.tagesStunden, ...a.tagesStunden };
  // Altbestand (vor der Umstellung auf Tageswerte): das hoehere Ergebnis
  // gewinnt, weil dort mehr Schultage eingeflossen sind.
  for (const kurs of new Set([...Object.keys(a.stundenSumme ?? {}), ...Object.keys(b.stundenSumme ?? {})])) {
    ergebnis.stundenSumme[kurs] = Math.max(a.stundenSumme?.[kurs] ?? 0, b.stundenSumme?.[kurs] ?? 0);
  }

  // Abgeleitete Kurzfassungen fuer den Hintergrunddienst - werden beim
  // naechsten Speichern ohnehin neu berechnet.
  ergebnis.lernVorschau = a.lernVorschau ?? b.lernVorschau;
  ergebnis.aufgabenVorschau = a.aufgabenVorschau ?? b.aufgabenVorschau;

  return sortiere(ergebnis);
}

/**
 * Kurzer Fingerabdruck eines Datensatzes - erkennt, ob sich etwas geaendert hat.
 * Schluessel werden sortiert, damit zwei inhaltsgleiche Staende auch dann
 * denselben Abdruck haben, wenn sie in anderer Reihenfolge entstanden sind.
 */
const stabil = (wert) => {
  if (Array.isArray(wert)) return wert.map(stabil);
  if (wert && typeof wert === 'object') {
    return Object.keys(wert).sort().map((k) => [k, stabil(wert[k])]);
  }
  return wert;
};

export function fingerabdruck(daten) {
  const text = JSON.stringify([
    [...eintraege(daten).entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([p, w]) => [p, stabil(w)]),
    stabil(daten.stand), stabil(daten.geloescht),
    stabil(daten.tagesStunden), stabil(daten.gezaehlteTage), stabil(daten.stundenSumme),
  ]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${h.toString(36)}`;
}

// ------------------------------------------------------------ Laden

/** Entschluesselt ein Paket. Wirft, wenn es da ist, sich aber nicht oeffnen laesst. */
async function auspacken(paket, schluessel) {
  if (!paket) return null;
  if (!paket.iv) return vervollstaendige(paket); // Klartext (nur lokale Entwicklung)
  if (!schluessel) throw new Error('Kein Schluessel zum Entsperren der eigenen Daten');
  return vervollstaendige(await entschluesseln(paket, schluessel));
}

/**
 * Laedt die eigenen Daten und gleicht sie mit der Cloud ab.
 *
 * Wirft NUR, wenn nachweislich Daten existieren, die sich nicht oeffnen
 * lassen. Sonst startet die App normal - denn wo nichts ist, kann auch
 * nichts ueberschrieben werden. (Genau das war der Fehler auf dem iPad:
 * Ohne funktionierende Datenbank war die App komplett gesperrt.)
 */
export async function ladeMeineDaten(schluessel) {
  let lokal = null;
  let lokalKaputt = false;
  try {
    lokal = await auspacken(await hole(datenName()), schluessel);
  } catch (fehler) {
    lokalKaputt = true;
    console.warn('Eigene Daten lokal nicht lesbar:', fehler.message);
  }

  // Erstmaliger Umzug: die alten Notizen aus localStorage uebernehmen.
  if (!lokal && !lokalKaputt) {
    const alt = localStorage.getItem('notizen');
    if (alt && schluessel) {
      try {
        const inhalt = JSON.parse(alt);
        const notizen = inhalt?.iv ? await entschluesseln(inhalt, schluessel) : inhalt;
        lokal = vervollstaendige({ notizen });
        localStorage.removeItem('notizen');
      } catch {
        /* nicht lesbar - dann eben leer anfangen */
      }
    }
  }

  // Cloud dazuholen: sowohl als Rettung als auch fuer den Geraete-Abgleich.
  let fremd = null;
  let cloudFehler = false;
  if (schluessel) {
    const antwort = await sicherungHolen(schluessel);
    if (antwort.fehler) cloudFehler = true;
    else if (antwort.paket) {
      try {
        fremd = await auspacken(antwort.paket, schluessel);
      } catch (fehler) {
        console.warn('Cloud-Sicherung nicht lesbar:', fehler.message);
        cloudFehler = true;
      }
    }
  }

  // Lokal nicht lesbar UND aus der Cloud kam keine verlaessliche Antwort:
  // Jetzt - und nur jetzt - koennten echte Daten verdeckt sein, die ein
  // leerer Stand ueberschreiben wuerde.
  if (lokalKaputt && cloudFehler) throw new Error('Eigene Daten sind gerade nicht lesbar');

  const daten = fremd ? verschmelze(lokal ?? LEER(), fremd) : (lokal ?? LEER());
  letzterStand = eintraege(daten);

  // Der Abgleich hat etwas ergeben, das lokal noch nicht stand? Sofort ablegen.
  if (fremd && fingerabdruck(daten) !== fingerabdruck(lokal ?? LEER())) {
    await ablegen(daten, schluessel);
  }

  return daten;
}

/** Legt einen Datensatz lokal ab (verschluesselt, wenn ein Schluessel da ist). */
async function ablegen(daten, schluessel) {
  const paket = schluessel ? await verschluesseln(daten, schluessel) : daten;
  await lege(datenName(), paket);
  return paket;
}

// ------------------------------------------------------------ Speichern

/** Wird gerufen, wenn der Cloud-Abgleich Aenderungen von einem anderen Geraet bringt. */
let beiFremdaenderung = null;
export const setzeFremdaenderung = (fn) => { beiFremdaenderung = fn; };

let laeuft = null; // laufender Cloud-Abgleich, damit sich zwei nicht ueberholen

export async function speichereMeineDaten(daten, schluessel) {
  stempeln(daten);
  await ablegen(daten, schluessel);
  if (!schluessel) return;

  // Cloud im Hintergrund - darf das Speichern nie ausbremsen. Vorher wird
  // geholt, was dort steht, damit ein Geraet nichts vom anderen ueberschreibt.
  laeuft = (laeuft ?? Promise.resolve())
    .then(() => abgleichen(daten, schluessel))
    .catch(() => {});
}

/**
 * Holt den Cloud-Stand, verschmilzt ihn mit dem eigenen und laedt das
 * Ergebnis wieder hoch. Gibt den zusammengefuehrten Stand zurueck, wenn
 * er sich vom uebergebenen unterscheidet.
 */
export async function abgleichen(daten, schluessel) {
  const antwort = await sicherungHolen(schluessel);
  if (antwort.fehler) return null; // offline - beim naechsten Mal wieder

  let zusammen = daten;
  if (antwort.paket) {
    try {
      const fremd = await auspacken(antwort.paket, schluessel);
      zusammen = verschmelze(daten, fremd);
    } catch {
      return null; // fremdes Paket unlesbar - lieber nichts ueberschreiben
    }
  }

  const abdruck = fingerabdruck(zusammen);
  const anders = abdruck !== fingerabdruck(daten);
  if (anders) {
    letzterStand = eintraege(zusammen);
    await ablegen(zusammen, schluessel);
  }

  // Steht dieser Stand schon oben, ist nichts zu tun - der Abgleich laeuft
  // bei jedem Öffnen der App, und Verschluesseln kostet spuerbar Zeit.
  if (anders || abdruck !== letzteSicherung) {
    const paket = await verschluesseln(zusammen, schluessel);
    await sicherungHochladen(paket, schluessel, abdruck);
  }

  if (anders && beiFremdaenderung) beiFremdaenderung(zusammen);
  return anders ? zusammen : null;
}

/** Kleine Kennung fuer neue Eintraege - ohne Zufallsquelle, damit es stabil bleibt. */
export const neueId = () => `${Date.now().toString(36)}${Math.floor(performance.now() * 1000).toString(36)}`;
