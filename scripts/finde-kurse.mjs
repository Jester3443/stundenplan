// Hilfsskript: Welche Untis-Kurse passen zu einem handschriftlichen Plan?
// Der Abruf liefert ohnehin den ganzen Jahrgang - hier gleichen wir Slot
// fuer Slot ab, welche Kurse zu einer gesuchten Stundenplan-Vorlage passen.
import { UntisRest, isoDatum, montagVon } from './untis-rest.mjs';
import { wochentyp } from '../public/shared/konfiguration.mjs';

const BLOCK = { '1./2.': '08:00', '3./4.': '09:50', '5./6.': '11:30', '7./8.': '14:05' };
const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];

/** Der Plan der Freundin, aus den Fotos abgetippt. */
const GESUCHT = {
  A: {
    Montag:     { '1./2.': 'Deutsch', '3./4.': 'Geschichte', '5./6.': 'Biologie', '7./8.': 'Mathe' },
    Dienstag:   { '3./4.': 'Politik', '5./6.': 'Seminarfach', '7./8.': 'Chemie' },
    Mittwoch:   { '1./2.': 'Biologie', '3./4.': 'Geschichte', '5./6.': 'Deutsch', '7./8.': 'Spanisch' },
    Donnerstag: { '1./2.': 'Chemie', '3./4.': 'Politik', '5./6.': 'Mathe' },
    Freitag:    { '1./2.': 'Spanisch', '3./4.': 'Deutsch', '5./6.': 'Werte und Normen' },
  },
  B: {
    Montag:     { '1./2.': 'Politik', '3./4.': 'Geschichte', '5./6.': 'Biologie' },
    Dienstag:   { '1./2.': 'Werte und Normen', '3./4.': 'Politik', '5./6.': 'Seminarfach', '7./8.': 'Spanisch' },
    Mittwoch:   { '3./4.': 'Geschichte', '5./6.': 'Deutsch', '7./8.': 'Spanisch' },
    Donnerstag: { '1./2.': 'Chemie', '3./4.': 'Politik', '5./6.': 'Mathe' },
    Freitag:    { '1./2.': 'Geschichte', '3./4.': 'Deutsch', '5./6.': 'Werte und Normen' },
  },
};

/** Welche Kuerzel-Anfaenge gehoeren zu welchem Fach? */
const KUERZEL = {
  Deutsch: ['de'],
  Geschichte: ['ge'],
  Biologie: ['bi'],
  Mathe: ['ma'],
  Politik: ['po'],
  Seminarfach: ['sf'],
  Chemie: ['ch'],
  Spanisch: ['sn'],
  'Werte und Normen': ['wn'],
};

const passtZuFach = (kuerzel, fach) =>
  (KUERZEL[fach] ?? []).some((anfang) => kuerzel.toLowerCase().startsWith(anfang));

const untis = new UntisRest();
await untis.anmelden();

// Eine A- und eine B-Woche holen (ungefiltert, also der ganze Jahrgang).
const wochen = {};
const start = montagVon(new Date());
for (let i = 0; i < 6 && Object.keys(wochen).length < 2; i++) {
  const montag = new Date(start);
  montag.setDate(montag.getDate() + i * 7);
  const typ = wochentyp(isoDatum(montag));
  if (wochen[typ]) continue;

  const freitag = new Date(montag);
  freitag.setDate(freitag.getDate() + 4);
  const tage = await untis.klassenPlan(isoDatum(montag), isoDatum(freitag));
  const stunden = tage.flatMap((t) => t.stunden);
  // Studienwochen und aehnliches ueberspringen - da faellt alles aus.
  if (stunden.filter((s) => s.fach && s.status !== 'CANCELLED').length < 20) continue;
  wochen[typ] = { montag: isoDatum(montag), tage };
  console.log(`  ${typ}-Woche: ${isoDatum(montag)} (${stunden.length} Eintraege)`);
}
await untis.abmelden();

console.log('\n================ Abgleich mit dem Papierplan ================\n');

const gefunden = new Map(); // Fach -> Set von "kuerzel (lehrer)"

for (const typ of ['A', 'B']) {
  if (!wochen[typ]) {
    console.log(`${typ}-Woche: keine brauchbaren Daten gefunden.`);
    continue;
  }
  console.log(`--- ${typ}-Woche ---`);

  for (const [tagIndex, tagName] of TAGE.entries()) {
    const soll = GESUCHT[typ][tagName];
    if (!soll) continue;
    const tag = wochen[typ].tage[tagIndex];
    if (!tag) continue;

    for (const [block, fach] of Object.entries(soll)) {
      const zeit = BLOCK[block];
      const kandidaten = tag.stunden.filter(
        (s) => s.von === zeit && s.fach && passtZuFach(s.fach, fach)
      );

      const liste = kandidaten.map((s) => `${s.fach} (${s.lehrer || '—'}, ${s.raum || '—'})`);
      console.log(`  ${tagName.padEnd(11)} ${block}  gesucht: ${fach.padEnd(18)} -> ${liste.join('  |  ') || 'NICHTS'}`);

      for (const s of kandidaten) {
        if (!gefunden.has(fach)) gefunden.set(fach, new Map());
        const eintrag = `${s.fach}|${s.lehrer}`;
        gefunden.get(fach).set(eintrag, (gefunden.get(fach).get(eintrag) ?? 0) + 1);
      }
    }
  }
  console.log('');
}

console.log('================ Zusammenfassung je Fach ================\n');
for (const [fach, treffer] of gefunden) {
  const sortiert = [...treffer.entries()].sort((a, b) => b[1] - a[1]);
  const eindeutig = sortiert.length === 1;
  console.log(`${fach.padEnd(20)} ${eindeutig ? 'EINDEUTIG' : 'MEHRDEUTIG'}`);
  for (const [eintrag, anzahl] of sortiert) {
    const [kuerzel, lehrer] = eintrag.split('|');
    console.log(`   ${kuerzel.padEnd(8)} ${(lehrer || '—').padEnd(8)} in ${anzahl} der gesuchten Slots`);
  }
}
