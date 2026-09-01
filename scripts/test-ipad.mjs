// Prueft den Fall, der Jaspers iPad lahmgelegt hat: Die Datenbank des
// Browsers antwortet nicht. Dann darf die App NICHT komplett sperren,
// solange die Cloud-Sicherung erreichbar ist - und sie MUSS sperren,
// wenn beides ausfaellt, damit nichts ueberschrieben wird.

// --- Browser-Umgebung nachbauen -------------------------------------------
const speicher = new Map();
globalThis.localStorage = {
  getItem: (k) => speicher.get(k) ?? null,
  setItem: (k, v) => speicher.set(k, String(v)),
  removeItem: (k) => speicher.delete(k),
};
// navigator gibt es in Node schon - nur ergaenzen, was die App liest.

// Datenbank, die auf jede Anfrage mit einem Fehler antwortet (wie auf dem iPad).
let datenbankKaputt = true;
globalThis.indexedDB = {
  open() {
    const anfrage = {};
    setTimeout(() => {
      if (datenbankKaputt) anfrage.onerror?.();
      else anfrage.onerror?.();
    }, 0);
    return anfrage;
  },
};

let cloudAntwort = null; // wird je Fall gesetzt
globalThis.fetch = async () => cloudAntwort();

const { ladeMeineDaten, LEER } = await import('../public/daten.mjs');
const { verschluesseln, schluesselAusCode } = await import('../public/shared/krypto.mjs');

let fehler = 0;
const pruefe = (name, ok, zusatz = '') => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${name}${zusatz ? ' - ' + zusatz : ''}`);
  if (!ok) fehler++;
};

const schluessel = await schluesselAusCode('TestCode1234', new Uint8Array(16).fill(7));

// --- Fall 1: Datenbank kaputt, aber die Cloud hat die Daten ---------------
const echt = LEER();
echt.fehlzeiten.push({ id: 'f1', datum: '2026-08-28', grund: 'krank', stunden: [] });
echt.noten.DE1 = [{ id: 'n1', punkte: 13, datum: '2026-08-20' }];
const paket = await verschluesseln(echt, schluessel);

cloudAntwort = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    fields: { iv: { stringValue: paket.iv }, daten: { stringValue: paket.daten }, stand: { stringValue: '2026-09-01T06:00' } },
  }),
});

let ergebnis = null;
let geworfen = null;
try {
  ergebnis = await ladeMeineDaten(schluessel);
} catch (e) {
  geworfen = e;
}
pruefe('Kaputte Datenbank sperrt die App nicht, wenn die Cloud da ist', !geworfen,
  geworfen ? geworfen.message : '');
pruefe('Die Daten kommen vollstaendig aus der Cloud',
  ergebnis?.fehlzeiten?.length === 1 && (ergebnis?.noten?.DE1 ?? []).length === 1);

// --- Fall 2: Datenbank kaputt UND Cloud nicht erreichbar ------------------
cloudAntwort = () => { throw new Error('offline'); };
geworfen = null;
try {
  await ladeMeineDaten(schluessel);
} catch (e) {
  geworfen = e;
}
pruefe('Beides ausgefallen: App sperrt das Eintragen', !!geworfen, geworfen?.message);

// --- Fall 3: Datenbank kaputt, Cloud sagt "es gibt nichts" ----------------
cloudAntwort = () => ({ ok: false, status: 404, json: async () => ({}) });
geworfen = null;
ergebnis = null;
try {
  ergebnis = await ladeMeineDaten(schluessel);
} catch (e) {
  geworfen = e;
}
pruefe('Neues Geraet ohne Sicherung startet normal (leer)', !geworfen && !!ergebnis,
  geworfen?.message);

// --- Fall 4: Cloud antwortet mit Serverfehler -> wie "nicht erreichbar" ---
cloudAntwort = () => ({ ok: false, status: 500, json: async () => ({}) });
geworfen = null;
try {
  await ladeMeineDaten(schluessel);
} catch (e) {
  geworfen = e;
}
pruefe('Serverfehler wird nicht als "keine Daten" missverstanden', !!geworfen, geworfen?.message);

console.log(fehler === 0 ? '\nAlle Pruefungen bestanden.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
