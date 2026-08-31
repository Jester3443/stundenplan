// Holt den Plan, filtert ihn je Person, erkennt Aenderungen gegenueber dem
// letzten Abruf und schreibt je Person einen fertigen, verschluesselten Stand.
//
// Es gibt nur EINEN Untis-Zugang (Jaspers). Personen ohne eigenen Zugang
// werden aus dem Jahrgangsplan gefiltert - dafuer reicht die Kursliste.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
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

const WOCHEN_VORAUS = Number(process.argv[2] ?? 4);
const WOCHEN_RUECKBLICK = 2;
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

/**
 * Vergleichsschluessel einer Stunde. Bewusst NUR Datum + Startzeit + Kurs:
 * Der Anzeigename eines Termins kann sich aendern, ohne dass sich inhaltlich
 * etwas geaendert hat - dann darf keine falsche Meldung entstehen.
 */
const schluessel = (datum, s) => `${datum}|${s.von}|${s.kurs ?? 'TERMIN'}`;

const zustand = (s) =>
  `${s.status}|${s.lehrer}|${s.raum}|${s.text}|${(s.aufgaben ?? []).map((a) => a.text).join('~')}`;

const aufgabenText = (s) => (s.aufgaben ?? []).map((a) => a.text).join('~');

function findeAenderungen(alt, neu) {
  const alteStunden = new Map();
  for (const woche of alt?.wochen ?? []) {
    for (const tag of woche.tage) {
      for (const s of tag.stunden) alteStunden.set(schluessel(tag.datum, s), s);
    }
  }
  if (!alteStunden.size) return []; // erster Lauf: nichts zu melden

  const aenderungen = [];
  const gesehen = new Set();

  for (const woche of neu.wochen) {
    for (const tag of woche.tage) {
      for (const s of tag.stunden) {
        const key = schluessel(tag.datum, s);
        gesehen.add(key);
        const vorher = alteStunden.get(key);
        if (!vorher) {
          aenderungen.push({ art: 'neu', datum: tag.datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} neu im Plan` });
          continue;
        }
        if (zustand(vorher) === zustand(s)) continue;

        if (aufgabenText(vorher) !== aufgabenText(s) && (s.aufgaben ?? []).length) {
          aenderungen.push({ art: 'hausaufgabe', datum: tag.datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: neue Hausaufgabe` });
        } else if (vorher.status !== 'CANCELLED' && s.status === 'CANCELLED') {
          aenderungen.push({ art: 'entfall', datum: tag.datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} faellt aus` });
        } else if (vorher.status === 'CANCELLED' && s.status !== 'CANCELLED') {
          aenderungen.push({ art: 'zurueck', datum: tag.datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} findet doch statt` });
        } else if (vorher.raum !== s.raum) {
          aenderungen.push({ art: 'raum', datum: tag.datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: Raum ${vorher.raum || '?'} → ${s.raum || '?'}` });
        } else if (vorher.lehrer !== s.lehrer) {
          aenderungen.push({ art: 'vertretung', datum: tag.datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: ${vorher.lehrer || '?'} → ${s.lehrer || 'keine Vertretung'}` });
        } else {
          aenderungen.push({ art: 'hinweis', datum: tag.datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: ${s.text || 'Änderung im Plan'}` });
        }
      }
    }
  }

  for (const [key, s] of alteStunden) {
    if (gesehen.has(key)) continue;
    const [datum] = key.split('|');
    if (datum < isoDatum(new Date())) continue;
    if (key.endsWith('|TERMIN')) continue;
    aenderungen.push({ art: 'gestrichen', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} steht nicht mehr im Plan` });
  }

  return aenderungen;
}

// ---------------------------------------------------------------- Ablauf

const untis = new UntisRest();
await untis.anmelden();

const app = await untis.appDaten().catch(() => null);
const schuljahr = app?.currentSchoolYear
  ? { name: app.currentSchoolYear.name, von: app.currentSchoolYear.dateRange.start, bis: app.currentSchoolYear.dateRange.end }
  : null;

const ferien = await untis.ferien();
console.log(`${ferien.length} Ferienzeitraeume, Schuljahr ${schuljahr?.name ?? '?'}\n`);

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
let hausaufgaben = [];
try {
  hausaufgaben = await untis.hausaufgaben(isoDatum(start), isoDatum(ende));
} catch {
  /* nicht verfuegbar */
}

// Termintexte je Woche (die neue Schnittstelle laesst sie weg).
const termintexte = new Map();
for (const { montag } of rohPerson) {
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
        // Hausaufgaben stammen aus dem persoenlichen Zugang - nur dort zuordnen.
        if (person.quelle !== 'person') return s;
        const aufgaben = hausaufgaben
          .filter((h) => h.faellig === tag.datum && h.fach === s.kurs)
          .map((h) => ({ text: h.text, anmerkung: h.anmerkung, lehrer: h.lehrer, erledigt: h.erledigt }));
        return aufgaben.length ? { ...s, aufgaben } : s;
      }),
    }));

    const anzahl = gefiltert.reduce((n, t) => n + t.stunden.length, 0);
    wochen.push({ montag, typ: wochentyp(montag), veroeffentlicht: anzahl > 0, fehler, tage: gefiltert });
  }

  const gesamt = wochen.reduce((n, w) => n + w.tage.reduce((m, t) => m + t.stunden.length, 0), 0);
  console.log(`  ${KURSE.length} Kurse, ${gesamt} Stunden in ${wochen.length} Wochen`);

  const basis = `data/letzter-plan-${kennung}.json`;
  const ziel = `public/data/plan-${kennung}.enc.json`;

  // Vergleichsbasis: bevorzugt der zuletzt veroeffentlichte Stand.
  let alt = null;
  let bisherigesSalz = null;
  const basisUrl = (process.env.BASIS_URL ?? '').trim();
  if (basisUrl) {
    try {
      const antwort = await fetch(`${basisUrl.replace(/\/$/, '')}/data/plan-${kennung}.enc.json`, { cache: 'no-store' });
      if (antwort.ok) {
        const paket = await antwort.json();
        bisherigesSalz = paket.salz ?? null;
        alt = entschluesseln(paket, code);
      }
    } catch {
      /* beim ersten Lauf normal */
    }
  }
  if (!alt) {
    try {
      alt = JSON.parse(await readFile(basis, 'utf8'));
    } catch {
      /* erster Lauf */
    }
  }
  bisherigesSalz ??= alt?._salz ?? null;

  const neu = { aktualisiert: new Date().toISOString(), benutzer: kennung, schuljahr, ferien, kurse: KURSE, wochen };
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
  console.warn(`Hinweis: ${fehlgeschlagen} Person(en) ohne Zugangscode uebersprungen.`);
}
// Nur abbrechen, wenn GAR NICHTS erzeugt wurde - ein fehlender zweiter
// Code darf den Lauf der ersten Person nicht mitreissen.
if (!erledigt) {
  console.error('Keine einzige Person konnte verarbeitet werden.');
  process.exit(1);
}
