// Holt den Plan, filtert auf Jaspers Kurse, erkennt Aenderungen gegenueber
// dem letzten Abruf und schreibt einen fertigen Datenstand fuers Frontend.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import 'dotenv/config';
import { UntisRest, isoDatum, montagVon } from './untis-rest.mjs';
import { findeKurs, stundenBezeichnung, wochentyp, terminBetrifftMich, KURSE } from '../public/shared/konfiguration.mjs';
import { verschluesseln, entschluesseln } from './krypto-node.mjs';

// Der Klartext-Stand bleibt IMMER lokal - er dient nur als Vergleichsbasis.
const BASIS = 'data/letzter-plan.json';
const ZIEL_KLAR = 'public/data/plan.json';
const ZIEL_KRYPT = 'public/data/plan.enc.json';
const CODE = (process.env.APP_CODE ?? '').trim();
const WOCHEN_VORAUS = Number(process.argv[2] ?? 4);
const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** Termine ohne Fach (Vollversammlung, Ausflug ...) betreffen den ganzen Jahrgang - die bleiben drin. */
const istTermin = (s) => !s.fach && (s.typ === 'EVENT' || s.name || s.text);

/** Behaelt nur, was Jasper wirklich betrifft. */
function filtere(stunden) {
  const behalten = [];
  for (const s of stunden) {
    // Lehrer gestrichen, KEIN Ersatz eingetragen -> "eigenverantwortliches
    // Arbeiten". In der Oberstufe wird nichts vertreten, das ist faktisch
    // Entfall - und genau so soll es die App zeigen (Jaspers Vorgabe).
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

/** Kurzbeschreibung des Zustands, um Unterschiede zu erkennen. */
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
          aenderungen.push({
            art: 'hausaufgabe',
            datum: tag.datum,
            block: s.block,
            kurs: s.kurs ?? s.fachName,
            text: `${s.fachName}: neue Hausaufgabe`,
          });
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
    if (datum < isoDatum(new Date())) continue; // Vergangenes ignorieren
    // Verschwundene Termine sind meist Datenrauschen (oder unser eigener
    // Filter) - ein abgesagter Termin kaeme als CANCELLED, nicht als Luecke.
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

// Ferien einmal holen - die App braucht sie, um die Soll-Stunden je Fach
// hochzurechnen (Grundlage der Fehlquote).
const ferien = await untis.ferien();
console.log(`  ${ferien.length} Ferienzeitraum/-raeume gefunden.`);

const wochen = [];
// Zwei Wochen rueckwaerts mitnehmen: Die App zaehlt daraus mit, wie viele
// Stunden je Fach tatsaechlich stattgefunden haben (Grundlage der Fehlquote).
// Ohne Rueckblick gingen Tage verloren, wenn die App mal ein paar Tage
// nicht geoeffnet wird.
const WOCHEN_RUECKBLICK = 2;
const start = montagVon(new Date());
start.setDate(start.getDate() - WOCHEN_RUECKBLICK * 7);

// Hausaufgaben der Lehrer fuer den gesamten Zeitraum in einem Rutsch holen.
const ende = new Date(start);
ende.setDate(ende.getDate() + (WOCHEN_VORAUS + WOCHEN_RUECKBLICK) * 7);
let hausaufgaben = [];
try {
  hausaufgaben = await untis.hausaufgaben(isoDatum(start), isoDatum(ende));
  console.log(`  ${hausaufgaben.length} Hausaufgabe(n) von Lehrern gefunden.`);
} catch (error) {
  console.log(`  Hausaufgaben nicht abrufbar: ${error.message.slice(0, 80)}`);
}

/** Sucht die Lehrer-Hausaufgaben, die zu dieser Stunde faellig sind. */
const aufgabenFuer = (datum, fach) =>
  hausaufgaben
    .filter((h) => h.faellig === datum && h.fach === fach)
    .map((h) => ({ text: h.text, anmerkung: h.anmerkung, lehrer: h.lehrer, erledigt: h.erledigt }));

for (let i = 0; i < WOCHEN_VORAUS + WOCHEN_RUECKBLICK; i++) {
  const montag = new Date(start);
  montag.setDate(montag.getDate() + i * 7);
  const freitag = new Date(montag);
  freitag.setDate(freitag.getDate() + 4);

  let tage = [];
  let fehler = null;
  try {
    tage = await untis.meinPlan(isoDatum(montag), isoDatum(freitag));
  } catch (error) {
    fehler = error.message.slice(0, 160);
  }

  const texte = tage.length ? await untis.terminTexte(isoDatum(montag)) : new Map();

  const gefiltert = tage.map((tag) => ({
    datum: tag.datum,
    wochentag: TAGE[new Date(`${tag.datum}T12:00:00`).getDay()],
    status: tag.status,
    hinweise: tag.hinweise,
    stunden: filtere(tag.stunden).map((s) => {
      const aufgaben = s.kurs ? aufgabenFuer(tag.datum, s.kurs) : [];
      if (s.kurs) return aufgaben.length ? { ...s, aufgaben } : s;
      const nachgereicht = texte.get(`${tag.datum}|${s.von}`);
      return nachgereicht ? { ...s, fachName: nachgereicht, text: s.text || nachgereicht } : s;
    }),
  }));

  const anzahl = gefiltert.reduce((n, t) => n + t.stunden.length, 0);
  wochen.push({
    montag: isoDatum(montag),
    typ: wochentyp(montag),
    veroeffentlicht: anzahl > 0,
    fehler,
    tage: gefiltert,
  });
  console.log(`  Woche ab ${isoDatum(montag)} (${wochentyp(montag)}-Woche): ${anzahl} Stunden${fehler ? ` -- ${fehler}` : ''}${anzahl ? '' : '  [noch nicht veroeffentlicht]'}`);
}

await untis.abmelden();

const neu = {
  aktualisiert: new Date().toISOString(),
  schuljahr,
  ferien,
  kurse: KURSE,
  wochen,
};

// Vergleichsbasis bestimmen. Auf dem Server (GitHub Actions) gibt es keine
// lokalen Dateien - dort wird der zuletzt veroeffentlichte Stand von der
// eigenen Seite geholt und entschluesselt.
let alt = null;
let bisherigesSalz = null; // Salz der letzten Veroeffentlichung wiederverwenden!
const BASIS_URL = (process.env.BASIS_URL ?? '').trim();

if (BASIS_URL && CODE) {
  try {
    const antwort = await fetch(`${BASIS_URL.replace(/\/$/, '')}/data/plan.enc.json`, { cache: 'no-store' });
    if (antwort.ok) {
      const paket = await antwort.json();
      bisherigesSalz = paket.salz ?? null;
      alt = entschluesseln(paket, CODE);
      console.log('Vergleichsbasis: zuletzt veroeffentlichter Stand.');
    } else {
      console.log(`Vergleichsbasis: nicht abrufbar (HTTP ${antwort.status}) - dieser Lauf meldet keine Aenderungen.`);
    }
  } catch (error) {
    console.log(`Vergleichsbasis: Fehler beim Laden (${error.message.slice(0, 80)}).`);
  }
}

if (!alt) {
  for (const quelle of [BASIS, ZIEL_KLAR]) {
    try {
      alt = JSON.parse(await readFile(quelle, 'utf8'));
      break;
    } catch {
      /* naechste Quelle versuchen */
    }
  }
}
bisherigesSalz ??= alt?._salz ?? null;

neu.aenderungen = findeAenderungen(alt, neu);
const frisch = neu.aenderungen.map((a) => ({ ...a, erkannt: neu.aktualisiert }));
neu.verlauf = [...(alt?.verlauf ?? []).slice(-50), ...frisch];

await mkdir('public/data', { recursive: true });
await mkdir('data', { recursive: true });
await writeFile(BASIS, JSON.stringify(neu, null, 2), 'utf8');

if (CODE) {
  // Verschluesselt veroeffentlichen. Der Klartext darf public/ nie erreichen.
  const paket = verschluesseln(neu, CODE, bisherigesSalz);
  neu._salz = paket.salz; // fuers naechste Mal merken (lokaler Lauf ohne BASIS_URL)
  await writeFile(BASIS, JSON.stringify(neu, null, 2), 'utf8');
  await writeFile(ZIEL_KRYPT, JSON.stringify(paket), 'utf8');
  await rm(ZIEL_KLAR, { force: true });
  console.log(`\nVerschluesselt geschrieben: ${ZIEL_KRYPT} (Salz ${bisherigesSalz ? 'wiederverwendet' : 'NEU'})`);
} else {
  await writeFile(ZIEL_KLAR, JSON.stringify(neu, null, 2), 'utf8');
  await rm(ZIEL_KRYPT, { force: true });
  console.log(`\nGeschrieben (unverschluesselt, nur lokal): ${ZIEL_KLAR}`);
  console.log('Hinweis: Fuer die Veroeffentlichung APP_CODE setzen, dann wird verschluesselt.');
}

console.log(`\n${neu.aenderungen.length} Aenderung(en) seit dem letzten Abruf.`);
// In der Cloud ist das Protokoll oeffentlich einsehbar - dort keine Details ausgeben.
if (!process.env.KNAPP) {
  for (const a of neu.aenderungen) console.log(`  - ${a.datum} ${a.block} ${a.text}`);
}
console.log('');
