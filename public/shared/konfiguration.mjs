// Zentrale Konfiguration. Wird sowohl vom Node-Skript als auch vom
// Browser-Frontend importiert, damit es nur EINE Wahrheit gibt.

/** Der 17.08.2026 ist eine A-Woche (von Jasper bestaetigt und in den Serverdaten belegt). */
export const ANKER_A_WOCHE = '2026-08-17';

/**
 * Oeffentlicher Schluessel fuer Push-Nachrichten.
 * Wird mit `npm run vapid` erzeugt; der private Teil gehoert ausschliesslich
 * in die GitHub-Secrets. Solange dieser Wert leer ist, bietet die App keine
 * Mitteilungen an.
 */
export const VAPID_OEFFENTLICH =
  'BO-yinY3Pxq7eJTiRVh7_hGsSgFDo7EeUs3HNUG_eWh7UWt9AZ8KY6KfOEjyNkWC9x-3hu2JFUstGXCfe4SyG94';

/**
 * Wo die App die verschluesselten Plandaten abholt.
 * Leer = von der eigenen Adresse (data/plan.enc.json).
 * Sobald die Cloud-Automatik steht, kommt hier die GitHub-Adresse rein -
 * dann braucht die Aktualisierung keinen PC und keinen Neu-Deploy mehr.
 */
export const DATEN_URL = 'https://raw.githubusercontent.com/Jester3443/stundenplan/data/plan.enc.json';

/**
 * Jaspers acht Kurse.
 * Wichtig: Untis unterscheidet Gross-/Kleinschreibung! Es gibt sowohl GE1 (MEIR)
 * als auch ge1 (han), ph1 (sim) und PH1 (mey), en1 (mar) und EN1 (eib).
 * Deshalb wird zusaetzlich der Lehrer geprueft.
 */
export const KURSE = [
  { kuerzel: 'DE1', lehrer: 'wil', fach: 'Deutsch',      niveau: 'eA', farbe: 'rot' },
  { kuerzel: 'ma2', lehrer: 'seg', fach: 'Mathematik',   niveau: 'gA', farbe: 'blau' },
  { kuerzel: 'en1', lehrer: 'mar', fach: 'Englisch',     niveau: 'eA', farbe: 'tuerkis' },
  { kuerzel: 'bi2', lehrer: 'gro', fach: 'Biologie',     niveau: 'gA', farbe: 'gruen' },
  { kuerzel: 'ph1', lehrer: 'sim', fach: 'Physik',       niveau: 'gA', farbe: 'violett' },
  { kuerzel: 'GE1', lehrer: 'MEIR', fach: 'Geschichte',  niveau: 'eA', farbe: 'orange' },
  { kuerzel: 'EK1', lehrer: 'lep', fach: 'Erdkunde',     niveau: 'eA', farbe: 'braun' },
  { kuerzel: 'sf3', lehrer: 'eik', fach: 'Seminarfach',  niveau: '',   farbe: 'grau' },
];

/** Jaspers Klasse - fuer die Frage, ob ein Termin ihn ueberhaupt betrifft. */
export const MEINE_KLASSE = '12';

/**
 * Termine, die grundsaetzlich nicht interessieren (Lehrer-Veranstaltungen).
 * Zusaetzlich fliegt jeder Termin raus, der viele Klassen auflistet,
 * aber nicht seine - siehe terminBetrifftMich().
 */
export const TERMIN_AUSBLENDEN = [/fachdienst/i, /dienstbesprechung/i, /konferenz/i];

/** Betrifft ein Termin (Name + Klassenliste) Jasper? */
export function terminBetrifftMich(name, klassenListe) {
  if (TERMIN_AUSBLENDEN.some((muster) => muster.test(name ?? ''))) return false;
  const klassen = (klassenListe ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  // Viele Klassen aufgezaehlt, die eigene fehlt -> Veranstaltung anderer Jahrgaenge.
  if (klassen.length >= 3 && !klassen.includes(MEINE_KLASSE)) return false;
  return true;
}

/** Die Doppelstunden-Bloecke, aus denen ein Schultag besteht (fuer die Wochenansicht). */
export const DOPPELBLOECKE = [
  { name: '1./2.', von: '08:00', bis: '09:25' },
  { name: '3./4.', von: '09:50', bis: '11:15' },
  { name: '5./6.', von: '11:30', bis: '12:55' },
  { name: '7./8.', von: '14:05', bis: '15:30' },
  { name: '9./10.', von: '15:45', bis: '17:10' },
];

/** Apple-Systemfarben, je ein Wert fuer hell und dunkel. */
export const FARBEN = {
  rot:      { hell: '#FF3B30', dunkel: '#FF453A' },
  blau:     { hell: '#007AFF', dunkel: '#0A84FF' },
  tuerkis:  { hell: '#00A0B4', dunkel: '#40CBE0' },
  gruen:    { hell: '#28A745', dunkel: '#30D158' },
  violett:  { hell: '#AF52DE', dunkel: '#BF5AF2' },
  orange:   { hell: '#F08000', dunkel: '#FF9F0A' },
  braun:    { hell: '#A2845E', dunkel: '#AC8E68' },
  grau:     { hell: '#8E8E93', dunkel: '#98989D' },
};

/** Das echte Stundenraster der IGS Osterholz-Scharmbeck. */
export const RASTER = [
  { name: 'oA', von: '07:30', bis: '08:00' },
  { name: '1',  von: '08:00', bis: '08:42' },
  { name: '2',  von: '08:42', bis: '09:25' },
  { name: '3',  von: '09:50', bis: '10:32' },
  { name: '4',  von: '10:32', bis: '11:15' },
  { name: '5',  von: '11:30', bis: '12:12' },
  { name: '6',  von: '12:12', bis: '12:55' },
  { name: 'M1', von: '12:55', bis: '13:30' },
  { name: 'M2', von: '13:30', bis: '14:05' },
  { name: '7',  von: '14:05', bis: '14:47' },
  { name: '8',  von: '14:47', bis: '15:30' },
  { name: '9',  von: '15:45', bis: '16:27' },
  { name: '10', von: '16:27', bis: '17:10' },
  { name: '11', von: '18:00', bis: '19:30' },
];

/** Findet den Kurs zu einem Untis-Eintrag - Kuerzel exakt, Lehrer als Absicherung. */
export function findeKurs(kuerzel, lehrer) {
  if (!kuerzel) return null;
  const exakt = KURSE.find((k) => k.kuerzel === kuerzel);
  if (!exakt) return null;
  // Bei Vertretung fehlt der Lehrer oder ist ein anderer - dann zaehlt das Kuerzel allein,
  // denn Untis vergibt Kuerzel wie "GE1" nur einmal pro Schreibweise.
  if (lehrer && lehrer !== exakt.lehrer && KURSE.some((k) => k.kuerzel.toLowerCase() === kuerzel.toLowerCase() && k !== exakt)) {
    return null;
  }
  return exakt;
}

/** "08:00"-"09:25" -> "1./2."  |  "08:00"-"10:32" -> "1.-3." */
export function stundenBezeichnung(von, bis) {
  const startIndex = RASTER.findIndex((r) => r.von === von);
  const endeIndex = RASTER.findIndex((r) => r.bis === bis);
  if (startIndex < 0 || endeIndex < 0) return '';
  const start = RASTER[startIndex];
  const ende = RASTER[endeIndex];
  if (startIndex === endeIndex) return `${start.name}.`;
  // Doppelstunde: mit Schraegstrich. Laengere Bloecke: mit Bindestrich.
  return endeIndex - startIndex === 1 ? `${start.name}./${ende.name}.` : `${start.name}.–${ende.name}.`;
}

/** A oder B fuer den Montag einer Woche. */
export function wochentyp(datum) {
  const anker = new Date(`${ANKER_A_WOCHE}T12:00:00`);
  const d = new Date(datum instanceof Date ? datum : `${datum}T12:00:00`);
  const montag = (x) => {
    const m = new Date(x);
    m.setHours(12, 0, 0, 0);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  };
  const wochen = Math.round((montag(d) - montag(anker)) / (7 * 864e5));
  return ((wochen % 2) + 2) % 2 === 0 ? 'A' : 'B';
}
