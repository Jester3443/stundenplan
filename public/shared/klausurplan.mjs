// Der Klausurplan des Jahrgangs 12, Schuljahr 2026/2027.
// Abgetippt aus den beiden PDFs der Schule (Abi28_Klausurplan_12-1 und 12-2)
// und gegen die gerenderten Seiten geprueft.
//
// Die Eintraege stehen genau so da, wie die Schule sie schreibt:
// "kuerzel-lehrer". Das ist wichtig, weil es Kurse gibt, die sich nur durch
// Gross-/Kleinschreibung oder die Lehrkraft unterscheiden - GE1-MEIR und
// ge1-han sind zwei verschiedene Kurse, ebenso PH1-mey und ph1-sim.
//
// Wenn die Schule einen neuen Plan herausgibt: einfach hier ergaenzen.
// Die App traegt daraus automatisch die Klausuren ein, die zu den eigenen
// Kursen gehoeren.

export const KLAUSURPLAN = [
  { datum: '2026-10-01', kurse: ['ma2-seg', 'spp1-dam'] },
  { datum: '2026-10-02', kurse: ['frf1-', 'frn1-shd', 'snf1-', 'snn1-rio'] },
  { datum: '2026-11-02', kurse: ['BI1-myr', 'EN1-eib', 'GE1-MEIR', 'PH1-mey', 'PO2-'] },
  { datum: '2026-11-04', kurse: ['de1-plp', 'en1-mar'] },
  { datum: '2026-11-05', kurse: ['ch1-mtf', 'en2-mar', 'ph1-sim'] },
  { datum: '2026-11-12', kurse: ['CH1-mie', 'EK1-lep', 'KU1-', 'PO1-klü'] },
  { datum: '2026-11-16', kurse: ['bi2-gro', 'de2-LB', 'ge1-han', 'ma1-lok'] },
  { datum: '2026-11-18', kurse: ['DE1-wil', 'EN2-shd', 'MA1-sei'] },
  { datum: '2026-11-20', kurse: ['bi1-gro', 'po1-amr', 're1-hen', 'wn1-BUE'] },
  { datum: '2026-11-24', kurse: ['ds1-kön', 'ku1-srt', 'mu1-fra'] },
  { datum: '2026-11-25', kurse: ['frn1-shd', 'snn1-rio'] },
  { datum: '2027-01-21', kurse: ['ma2-seg', 'spp1-dam'] },
  { datum: '2027-01-22', kurse: ['frf1-', 'frn1-shd', 'snf1-', 'snn1-rio'] },
  { datum: '2027-01-28', kurse: ['CH1-mie', 'EK1-lep', 'KU1-', 'PO1-klü'] },
  { datum: '2027-02-05', kurse: ['DE1-wil', 'EN2-shd', 'MA1-sei'] },
  { datum: '2027-02-10', kurse: ['BI1-myr', 'EN1-eib', 'GE1-MEIR', 'PH1-eik', 'PO2-'] },
  { datum: '2027-02-11', kurse: ['ds1-kön', 'ku1-srt', 'mu1-fra'] },
  { datum: '2027-02-23', kurse: ['bi1-gro', 'po1-amr', 're1-hen', 'wn1-BUE'] },
  { datum: '2027-03-01', kurse: ['bi2-gro', 'de2-LB', 'ge1-han', 'ma1-lok'] },
  { datum: '2027-03-04', kurse: ['ch1-mtf', 'en2-mar', 'ph1-sim'] },
  { datum: '2027-03-05', kurse: ['de1-plp', 'en1-mar'] },
  { datum: '2027-04-14', kurse: ['BI1-myr', 'EN1-eib', 'GE1-MEIR', 'PH1-eik', 'PO2-'] },
  { datum: '2027-04-19', kurse: ['CH1-mie', 'EK1-lep', 'KU1-', 'PO1-klü'] },
  { datum: '2027-04-28', kurse: ['DE1-wil', 'EN2-shd', 'MA1-sei'] },
  { datum: '2027-04-29', kurse: ['ma2-seg', 'spp1-dam'] },
  { datum: '2027-05-05', kurse: ['frf1-', 'frn1-shd', 'snf1-', 'snn1-rio'] },
  { datum: '2027-05-12', kurse: ['bi2-gro', 'de2-LB', 'ge1-han', 'ma1-lok'] },
  { datum: '2027-05-14', kurse: ['bi1-gro', 'po1-amr', 're1-hen', 'wn1-BUE'] },
  { datum: '2027-05-19', kurse: ['de1-plp', 'en1-mar'] },
  { datum: '2027-05-20', kurse: ['ch1-mtf', 'en2-mar', 'ph1-sim'] },
];

/** Zerlegt "GE1-MEIR" in Kuerzel und Lehrkraft. */
function zerlege(eintrag) {
  const strich = eintrag.lastIndexOf('-');
  if (strich < 0) return { kuerzel: eintrag, lehrer: '' };
  return { kuerzel: eintrag.slice(0, strich), lehrer: eintrag.slice(strich + 1) };
}

/**
 * Gehoert ein Eintrag aus dem Klausurplan zu diesem Kurs?
 *
 * Zuerst wird zeichengenau verglichen. Nur wenn das nicht passt, wird die
 * Gross-/Kleinschreibung ignoriert - und dann MUSS die Lehrkraft stimmen.
 * Sonst wuerde ge1-han (ein anderer Geschichtskurs) faelschlich als GE1-MEIR
 * durchgehen. Die Schule schreibt Spanisch mal snN1 und mal snn1, deshalb
 * braucht es diesen zweiten Weg ueberhaupt.
 */
function passt(eintrag, kurs) {
  const { kuerzel, lehrer } = zerlege(eintrag);
  if (kuerzel === kurs.kuerzel) return true;
  if (kuerzel.toLowerCase() !== kurs.kuerzel.toLowerCase()) return false;
  return !!lehrer && lehrer.toLowerCase() === (kurs.lehrer ?? '').toLowerCase();
}

/**
 * Alle Klausuren, die zu den uebergebenen Kursen gehoeren.
 * Rueckgabe: [{ datum, kurs, fach }] - aufsteigend nach Datum.
 */
export function klausurenFuer(kurse) {
  const treffer = [];
  for (const termin of KLAUSURPLAN) {
    for (const eintrag of termin.kurse) {
      const kurs = kurse.find((k) => passt(eintrag, k));
      if (kurs) treffer.push({ datum: termin.datum, kurs: kurs.kuerzel, fach: kurs.fach });
    }
  }
  return treffer.sort((a, b) => a.datum.localeCompare(b.datum) || a.kurs.localeCompare(b.kurs));
}
