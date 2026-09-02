// Prueft die Zuordnung des Klausurplans zu den Kursen der Nutzer.
// Heikel, weil sich Kurse nur durch Gross-/Kleinschreibung oder die
// Lehrkraft unterscheiden: GE1-MEIR und ge1-han sind zwei verschiedene Kurse.
import { KLAUSURPLAN, klausurenFuer } from '../public/shared/klausurplan.mjs';
import { BENUTZER } from '../public/shared/konfiguration.mjs';

let fehler = 0;
const pruefe = (name, ok, zusatz = '') => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${name}${zusatz ? ' - ' + zusatz : ''}`);
  if (!ok) fehler++;
};

const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

console.log('--- Der abgetippte Plan selbst ---');
{
  const schlecht = KLAUSURPLAN.filter((t) => !/^\d{4}-\d{2}-\d{2}$/.test(t.datum));
  pruefe('Alle Daten im Format JJJJ-MM-TT', schlecht.length === 0, schlecht.map((t) => t.datum).join(', '));

  // Klausuren liegen an Schultagen. Faengt Tippfehler beim Abschreiben ab.
  const wochenende = KLAUSURPLAN.filter((t) => {
    const wt = new Date(`${t.datum}T12:00:00`).getDay();
    return wt === 0 || wt === 6;
  });
  pruefe('Kein Termin faellt auf ein Wochenende', wochenende.length === 0,
    wochenende.map((t) => `${t.datum} = ${TAGE[new Date(`${t.datum}T12:00:00`).getDay()]}`).join(', '));

  const doppelt = KLAUSURPLAN.map((t) => t.datum).filter((d, i, a) => a.indexOf(d) !== i);
  pruefe('Kein Datum doppelt angelegt', doppelt.length === 0, doppelt.join(', '));

  const sortiert = [...KLAUSURPLAN].sort((a, b) => a.datum.localeCompare(b.datum));
  pruefe('Termine stehen in zeitlicher Reihenfolge',
    sortiert.map((t) => t.datum).join() === KLAUSURPLAN.map((t) => t.datum).join());

  const leer = KLAUSURPLAN.filter((t) => !t.kurse.length);
  pruefe('Kein Termin ohne Kurse', leer.length === 0);
}

console.log('\n--- Zuordnung zu den Kursen ---');
{
  const jasper = klausurenFuer(BENUTZER.jasper.kurse);
  const catalina = klausurenFuer(BENUTZER.catalina.kurse);

  pruefe('Jasper bekommt Klausuren', jasper.length > 0, `${jasper.length} Termine`);
  pruefe('Catalina bekommt Klausuren', catalina.length > 0, `${catalina.length} Termine`);

  // Jeder Kurs ausser dem Seminarfach schreibt Klausuren.
  for (const [kennung, person] of Object.entries(BENUTZER)) {
    const treffer = klausurenFuer(person.kurse);
    const ohne = person.kurse.filter((k) => !treffer.some((t) => t.kurs === k.kuerzel));
    pruefe(`${person.name}: nur das Seminarfach ohne Klausur`,
      ohne.length === 1 && ohne[0].kuerzel === 'sf3',
      ohne.map((k) => k.kuerzel).join(', ') || 'keiner');

    const doppelt = treffer.filter((t, i, a) => a.findIndex((x) => x.kurs === t.kurs && x.datum === t.datum) !== i);
    pruefe(`${person.name}: kein Termin doppelt`, doppelt.length === 0,
      doppelt.map((t) => `${t.kurs} ${t.datum}`).join(', '));
  }
}

console.log('\n--- Verwechslungen, die NICHT passieren duerfen ---');
{
  const nur = (kuerzel, lehrer, fach = 'Test') => [{ kuerzel, lehrer, fach }];

  // ge1-han ist ein anderer Geschichtskurs als GE1-MEIR.
  pruefe('ge1-han wird nicht als GE1-MEIR gezaehlt',
    !klausurenFuer(nur('GE1', 'MEIR')).some((t) => t.datum === '2026-11-16'));
  pruefe('GE1-MEIR wird gefunden',
    klausurenFuer(nur('GE1', 'MEIR')).some((t) => t.datum === '2026-11-02'));

  // PH1-mey ist ein anderer Physikkurs als ph1-sim.
  pruefe('PH1-mey wird nicht als ph1-sim gezaehlt',
    !klausurenFuer(nur('ph1', 'sim')).some((t) => t.datum === '2026-11-02'));
  pruefe('ph1-sim wird gefunden',
    klausurenFuer(nur('ph1', 'sim')).some((t) => t.datum === '2026-11-05'));

  // bi1 und bi2 sind verschiedene Kurse bei DERSELBEN Lehrkraft.
  pruefe('bi1-gro wird nicht als bi2-gro gezaehlt',
    !klausurenFuer(nur('bi2', 'gro')).some((t) => t.datum === '2026-11-20'));
  pruefe('bi2-gro wird gefunden',
    klausurenFuer(nur('bi2', 'gro')).some((t) => t.datum === '2026-11-16'));

  // en1-mar und en2-mar: gleiche Lehrkraft, verschiedene Kurse.
  pruefe('en2-mar wird nicht als en1-mar gezaehlt',
    !klausurenFuer(nur('en1', 'mar')).some((t) => t.datum === '2026-11-05'));

  // Die Schule schreibt Spanisch mal snN1, mal snn1 - dieselbe Lehrkraft.
  pruefe('snn1-rio wird als snN1-rio erkannt',
    klausurenFuer(nur('snN1', 'rio')).length === 4,
    `${klausurenFuer(nur('snN1', 'rio')).length} Termine`);

  // Ohne passende Lehrkraft darf die Schreibweise allein nicht reichen.
  pruefe('snn1 mit fremder Lehrkraft wird nicht zugeordnet',
    klausurenFuer(nur('snN1', 'xyz')).length === 0);

  // Eintraege ohne Lehrkraft im Plan (z. B. "KU1-") nur bei exakter Schreibweise.
  pruefe('KU1- wird bei exakter Schreibweise gefunden',
    klausurenFuer(nur('KU1', '')).length > 0);
  pruefe('ku1 (klein) wird NICHT als KU1 gezaehlt',
    !klausurenFuer(nur('KU1', '')).some((t) => t.datum === '2026-11-24'));
}

console.log(fehler === 0 ? '\nAlle Pruefungen bestanden.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
