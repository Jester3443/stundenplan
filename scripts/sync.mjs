// Holt den Plan, filtert ihn je Person, erkennt Aenderungen gegenueber dem
// letzten Abruf und schreibt je Person einen fertigen, verschluesselten Stand.
//
// Es gibt nur EINEN Untis-Zugang (Jaspers). Personen ohne eigenen Zugang
// werden aus dem Jahrgangsplan gefiltert - dafuer reicht die Kursliste.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import 'dotenv/config';
import { UntisRest, isoDatum, montagVon } from './untis-rest.mjs';
import {
  BENUTZER,
  setzeBenutzer,
  KURSE,
  findeKurs,
  stundenBezeichnung,
  wochentyp,
  terminBetrifftMich,
} from '../public/shared/konfiguration.mjs';
import { verschluesseln, entschluesseln } from './krypto-node.mjs';
import {
  findeAenderungen,
  wochenZusammenfuehren,
  termintexteUebernehmen,
  aufgabenUebernehmen,
  stundenZahl,
} from './vergleich.mjs';

/**
 * Der Zeitraum, den der veroeffentlichte Plan immer abdeckt - unabhaengig
 * davon, wie viel ein einzelner Lauf frisch abgerufen hat.
 */
const VOLL_VORAUS = 4;
const VOLL_RUECKBLICK = 2;

const ARGUMENTE = process.argv.slice(2);

/**
 * Schnell-Lauf (alle paar Minuten): holt nur die laufende und die naechste
 * Woche. Genau dort passieren Vertretungen und Ausfaelle, und ein solcher
 * Lauf kostet den Schulserver nur ein Drittel der Anfragen. Alles Weitere
 * kommt aus dem zuletzt veroeffentlichten Stand - der Plan verliert also
 * trotzdem keine einzige Woche.
 */
const SCHNELL = ARGUMENTE.includes('--schnell') || (process.env.MODUS ?? '').trim() === 'schnell';
const ZAHL_ARGUMENT = ARGUMENTE.find((a) => /^\d+$/.test(a));

// 2 = laufende Woche + naechste Woche (die Zaehlung schliesst die
// laufende Woche mit ein, genau wie im vollstaendigen Lauf).
const WOCHEN_VORAUS = SCHNELL ? 2 : Number(ZAHL_ARGUMENT ?? VOLL_VORAUS);
const WOCHEN_RUECKBLICK = SCHNELL ? 0 : VOLL_RUECKBLICK;
const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** Zugangscode je Person: APP_CODE_JASPER, APP_CODE_FREUNDIN ... */
const codeFuer = (kennung) =>
  (process.env[`APP_CODE_${kennung.toUpperCase()}`] ?? (kennung === 'jasper' ? process.env.APP_CODE : '') ?? '').trim();

/** Termine ohne Fach (Vollversammlung, Ausflug ...) betreffen den ganzen Jahrgang. */
const istTermin = (s) => !s.fach && (s.typ === 'EVENT' || s.name || s.text);

/** Behaelt nur, was diese Person wirklich betrifft. */
function filtere(stunden) {
  const behalten = [];
  for (const s of stunden) {
    // Lehrer gestrichen, KEIN Ersatz eingetragen -> "eigenverantwortliches
    // Arbeiten". In der Oberstufe wird nichts vertreten, das ist faktisch
    // Entfall - und genau so soll es die App zeigen.
    const ohneLehrkraft = !!s.lehrerErsetzt && !s.lehrer;

    const kurs = findeKurs(s.fach, s.lehrer || s.lehrerErsetzt);
    if (kurs) {
      behalten.push({
        ...s,
        status: ohneLehrkraft ? 'CANCELLED' : s.status,
        eva: ohneLehrkraft || undefined,
        kurs: kurs.kuerzel,
        fachName: kurs.fach,
        niveau: kurs.niveau,
        farbe: kurs.farbe,
        block: stundenBezeichnung(s.von, s.bis),
      });
    } else if (istTermin(s) && terminBetrifftMich(s.name || s.text, s.klasse)) {
      behalten.push({
        ...s,
        kurs: null,
        fachName: s.name || s.text || 'Termin',
        niveau: '',
        farbe: 'grau',
        block: stundenBezeichnung(s.von, s.bis),
      });
    }
  }
  return behalten.sort((a, b) => a.von.localeCompare(b.von));
}

// ---------------------------------------------------------------- Ablauf

/** Der Montag, mit dem der veroeffentlichte Plan beginnt bzw. endet. */
const fensterStart = montagVon(new Date());
fensterStart.setDate(fensterStart.getDate() - VOLL_RUECKBLICK * 7);
const fensterEnde = new Date(fensterStart);
fensterEnde.setDate(fensterEnde.getDate() + (VOLL_VORAUS + VOLL_RUECKBLICK - 1) * 7);
const FENSTER_VON = isoDatum(fensterStart);
const FENSTER_BIS = isoDatum(fensterEnde);

const untis = new UntisRest();
await untis.anmelden();

// Schuljahr und Ferien aendern sich nicht im Minutentakt. Der Schnell-Lauf
// laesst sie weg (drei Anfragen weniger) und uebernimmt sie weiter unten aus
// dem zuletzt veroeffentlichten Stand.
const app = SCHNELL ? null : await untis.appDaten().catch(() => null);
const schuljahr = app?.currentSchoolYear
  ? { name: app.currentSchoolYear.name, von: app.currentSchoolYear.dateRange.start, bis: app.currentSchoolYear.dateRange.end }
  : null;

const ferien = SCHNELL ? [] : await untis.ferien();
console.log(
  SCHNELL
    ? 'Schnell-Lauf: laufende und naechste Woche\n'
    : `${ferien.length} Ferienzeitraeume, Schuljahr ${schuljahr?.name ?? '?'}\n`
);

// Zwei Wochen rueckwaerts mitnehmen, damit die Stundenstatistik keine Luecken
// bekommt, wenn die App ein paar Tage nicht geoeffnet wird.
const start = montagVon(new Date());
start.setDate(start.getDate() - WOCHEN_RUECKBLICK * 7);
const ende = new Date(start);
ende.setDate(ende.getDate() + (WOCHEN_VORAUS + WOCHEN_RUECKBLICK) * 7);

// Rohdaten EINMAL holen und fuer alle Personen wiederverwenden.
const rohPerson = [];
const rohKlasse = [];
for (let i = 0; i < WOCHEN_VORAUS + WOCHEN_RUECKBLICK; i++) {
  const montag = new Date(start);
  montag.setDate(montag.getDate() + i * 7);
  const freitag = new Date(montag);
  freitag.setDate(freitag.getDate() + 4);

  const holen = async (fn) => {
    try {
      return await fn(isoDatum(montag), isoDatum(freitag));
    } catch (fehler) {
      return { fehler: fehler.message.slice(0, 140) };
    }
  };

  rohPerson.push({ montag: isoDatum(montag), ergebnis: await holen((v, b) => untis.meinPlan(v, b)) });
  rohKlasse.push({ montag: isoDatum(montag), ergebnis: await holen((v, b) => untis.klassenPlan(v, b)) });
}

// Lehrer-Hausaufgaben gibt es nur fuer den eigenen Zugang.
// Wichtig ist der Unterschied zwischen "es gibt keine" und "Abruf misslungen":
// Im zweiten Fall werden die Aufgaben unten aus dem letzten Stand uebernommen,
// sonst gaebe es bei jeder Stoerung eine Runde Falschmeldungen.
let hausaufgaben = [];
let hausaufgabenGeholt = true;
try {
  hausaufgaben = await untis.hausaufgaben(isoDatum(start), isoDatum(ende));
} catch (fehler) {
  hausaufgabenGeholt = false;
  console.warn(`Hausaufgaben nicht abrufbar (${String(fehler.message).slice(0, 60)}) - alter Stand bleibt.`);
}

// Termintexte je Woche (die neue Schnittstelle laesst sie weg). Das kostet
// zwei zusaetzliche Anfragen je Woche - der Schnell-Lauf spart sie und
// uebernimmt die Texte stattdessen aus dem letzten Stand.
const termintexte = new Map();
for (const { montag } of SCHNELL ? [] : rohPerson) {
  for (const [key, text] of await untis.terminTexte(montag)) termintexte.set(key, text);
}

await untis.abmelden();

// ------------------------------------------------- je Person auswerten

let fehlgeschlagen = 0;

for (const [kennung, person] of Object.entries(BENUTZER)) {
  setzeBenutzer(kennung);
  const code = codeFuer(kennung);
  const roh = person.quelle === 'person' ? rohPerson : rohKlasse;

  console.log(`--- ${person.name} (${kennung}, Quelle: ${person.quelle}) ---`);
  if (!code) {
    console.log(`  Kein Zugangscode gesetzt (APP_CODE_${kennung.toUpperCase()}) - uebersprungen.\n`);
    fehlgeschlagen++;
    continue;
  }

  const wochen = [];
  for (const { montag, ergebnis } of roh) {
    const tage = Array.isArray(ergebnis) ? ergebnis : [];
    const fehler = Array.isArray(ergebnis) ? null : ergebnis.fehler;

    const gefiltert = tage.map((tag) => ({
      datum: tag.datum,
      wochentag: TAGE[new Date(`${tag.datum}T12:00:00`).getDay()],
      status: tag.status ?? 'REGULAR',
      hinweise: tag.hinweise ?? [],
      stunden: filtere(tag.stunden).map((s) => {
        if (!s.kurs) {
          const text = termintexte.get(`${tag.datum}|${s.von}`);
          return text ? { ...s, fachName: text, text: s.text || text } : s;
        }
        // Hausaufgaben stammen zwar aus Jaspers persoenlichem Zugang, gelten
        // aber fuer den KURS - wer denselben Kurs hat, bekommt sie auch.
        const aufgaben = hausaufgaben
          .filter((h) => h.faellig === tag.datum && h.fach === s.kurs)
          .map((h) => ({ text: h.text, anmerkung: h.anmerkung, lehrer: h.lehrer, erledigt: h.erledigt }));
        return aufgaben.length ? { ...s, aufgaben } : s;
      }),
    }));

    const anzahl = gefiltert.reduce((n, t) => n + t.stunden.length, 0);
    wochen.push({ montag, typ: wochentyp(montag), veroeffentlicht: anzahl > 0, fehler, tage: gefiltert });
  }

  const basis = `data/letzter-plan-${kennung}.json`;
  const ziel = `public/data/plan-${kennung}.enc.json`;

  // Vergleichsbasis: bevorzugt der zuletzt veroeffentlichte Stand.
  let alt = null;
  let bisherigesSalz = null;

  /**
   * Konnten wir den letzten Stand ZUVERLAESSIG feststellen?
   * Der Unterschied ist entscheidend: "es gab noch nie einen Stand" ist
   * harmlos, "wir konnten nicht nachsehen" ist gefaehrlich. Im zweiten Fall
   * wuerde ein Schnell-Lauf einen Zwei-Wochen-Plan veroeffentlichen und -
   * schlimmer - ein frisches Salz erzeugen, das alle Geraete aussperrt.
   */
  let basisGeklaert = false;

  // Zuerst aus dem ausgecheckten data-Zweig - der ist immer taggenau.
  // Die oeffentliche Adresse dahinter kann einige Minuten alt sein, was bei
  // haeufigen Laeufen dieselbe Meldung ein zweites Mal ausloesen wuerde.
  const basisDir = (process.env.BASIS_DIR ?? '').trim();
  if (basisDir) {
    try {
      const paket = JSON.parse(await readFile(`${basisDir}/plan-${kennung}.enc.json`, 'utf8'));
      bisherigesSalz = paket.salz ?? null;
      alt = entschluesseln(paket, code);
      basisGeklaert = true;
    } catch (fehler) {
      // Der Zweig liegt vor, nur diese Person fehlt darin: dann hat es fuer
      // sie wirklich noch nichts gegeben - das ist geklaert.
      if (fehler.code === 'ENOENT' && existsSync(basisDir)) basisGeklaert = true;
    }
  }

  const basisUrl = (process.env.BASIS_URL ?? '').trim();
  if (!alt && basisUrl) {
    try {
      const antwort = await fetch(`${basisUrl.replace(/\/$/, '')}/data/plan-${kennung}.enc.json`, { cache: 'no-store' });
      if (antwort.ok) {
        const paket = await antwort.json();
        bisherigesSalz = paket.salz ?? null;
        alt = entschluesseln(paket, code);
        basisGeklaert = true;
      } else if (antwort.status === 404) {
        basisGeklaert = true; // gab es nachweislich noch nie
      }
    } catch {
      /* nicht erreichbar - damit ist nichts geklaert */
    }
  }
  if (!alt) {
    try {
      alt = JSON.parse(await readFile(basis, 'utf8'));
      basisGeklaert = true;
    } catch (fehler) {
      // Ohne jede Fernquelle (lokaler Lauf) zaehlt auch "Datei gibt es nicht".
      if (fehler.code === 'ENOENT' && !basisDir && !basisUrl) basisGeklaert = true;
    }
  }
  bisherigesSalz ??= alt?._salz ?? null;

  // Notbremse 1: Ohne geklaerten Vorstand nichts veroeffentlichen. Sonst
  // entstuende ein neues Salz - und der auf den Geraeten gespeicherte
  // Schluessel passte nicht mehr zu den Daten UND nicht mehr zur Sicherung.
  if (!basisGeklaert) {
    console.warn('  Letzter Stand nicht feststellbar - uebersprungen, damit nichts zerstoert wird.\n');
    fehlgeschlagen++;
    continue;
  }

  // Notbremse 2: Ein Schnell-Lauf holt nur zwei Wochen. Ohne Vorstand zum
  // Zusammenfuehren wuerde er den Plan auf diese zwei Wochen eindampfen.
  if (SCHNELL && !alt?.wochen?.length) {
    console.warn('  Schnell-Lauf ohne Vergleichsstand - uebersprungen, der volle Lauf holt das nach.\n');
    fehlgeschlagen++;
    continue;
  }

  // Fehlgeschlagene Zusatzabrufe duerfen den veroeffentlichten Stand nicht
  // aermer machen als er war.
  const ferienListe = ferien.length ? ferien : (alt?.ferien ?? []);
  if (SCHNELL) termintexteUebernehmen(alt?.wochen, wochen);
  if (!hausaufgabenGeholt) aufgabenUebernehmen(alt?.wochen, wochen);
  const alleWochen = wochenZusammenfuehren(alt?.wochen, wochen, {
    ferien: ferienListe,
    von: FENSTER_VON,
    bis: FENSTER_BIS,
  });

  const frisch = wochen.reduce((n, w) => n + stundenZahl(w), 0);
  const gesamt = alleWochen.reduce((n, w) => n + stundenZahl(w), 0);
  console.log(
    `  ${KURSE.length} Kurse, ${gesamt} Stunden in ${alleWochen.length} Wochen` +
      (SCHNELL ? ` (davon ${frisch} aus ${wochen.length} frisch geholten Wochen)` : '')
  );

  const neu = {
    aktualisiert: new Date().toISOString(),
    benutzer: kennung,
    schuljahr: schuljahr ?? alt?.schuljahr ?? null,
    ferien: ferienListe,
    kurse: KURSE,
    wochen: alleWochen,
  };
  neu.aenderungen = findeAenderungen(alt, neu);
  neu.verlauf = [
    ...(alt?.verlauf ?? []).slice(-50),
    ...neu.aenderungen.map((a) => ({ ...a, erkannt: neu.aktualisiert })),
  ];

  // Salz wiederverwenden - sonst passt der auf dem Geraet gespeicherte
  // Schluessel nach jeder Veroeffentlichung nicht mehr.
  const paket = verschluesseln(neu, code, bisherigesSalz);
  neu._salz = paket.salz;

  await mkdir('data', { recursive: true });
  await mkdir('public/data', { recursive: true });
  await writeFile(basis, JSON.stringify(neu, null, 2), 'utf8');
  await writeFile(ziel, JSON.stringify(paket), 'utf8');

  // Uebergangsweise auch unter dem alten Namen, damit aeltere App-Versionen
  // auf dem Handy nicht ins Leere laufen.
  if (kennung === 'jasper') await writeFile('public/data/plan.enc.json', JSON.stringify(paket), 'utf8');

  console.log(`  ${neu.aenderungen.length} Aenderung(en), geschrieben: ${ziel}`);
  if (!process.env.KNAPP) for (const a of neu.aenderungen) console.log(`    - ${a.datum} ${a.block} ${a.text}`);
  console.log('');
}

await rm('public/data/plan.json', { force: true }); // Klartext darf nie ins Netz

const erledigt = Object.keys(BENUTZER).length - fehlgeschlagen;
if (fehlgeschlagen) {
  console.warn(`Hinweis: ${fehlgeschlagen} Person(en) uebersprungen (Grund steht oben).`);
}
// Nur abbrechen, wenn GAR NICHTS erzeugt wurde - ein fehlender zweiter
// Code darf den Lauf der ersten Person nicht mitreissen.
if (!erledigt) {
  console.error('Keine einzige Person konnte verarbeitet werden.');
  process.exit(1);
}
