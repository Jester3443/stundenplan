// Prueft die Notenrechnung - vor allem Catalinas Sorge:
// Eine Stunde ohne eingetragene Note darf NIEMALS als null Punkte zaehlen.
import { initBereiche, mittelwerte, kursSchnitt, gesamtSchnitt, stundenImHalbjahr } from '../public/bereiche.mjs';
import { HALBJAHRE, aktuellesHalbjahr, halbjahrZu } from '../public/shared/klausurplan.mjs';

let fehler = 0;
const pruefe = (name, ok, zusatz = '') => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${name}${zusatz ? ' - ' + zusatz : ''}`);
  if (!ok) fehler++;
};

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Baut eine Testumgebung mit den uebergebenen Noten. */
function umgebung(noten, gewichtung = {}) {
  const zustand = {
    plan: { wochen: [], ferien: [], schuljahr: { von: '2026-08-01', bis: '2027-07-31' } },
    meineDaten: { noten, klausuren: [], gewichtung, notizen: {}, aufgaben: [], fehlzeiten: [], lernen: {} },
    datenGeladen: true,
  };
  initBereiche({ zustand, iso, minuten: () => 0, alleTage: () => [], zeichnen: () => {}, speichern: async () => {} });
  return zustand;
}

const HJ1 = HALBJAHRE[0];
const note = (punkte, art, datum) => ({ id: `${art}${punkte}${datum}`, punkte, art, datum });

console.log('--- Keine Note ist keine Null ---');
{
  // Nur muendliche Noten, keine einzige Klausur.
  umgebung({ DE1: [note(12, 'sonstige', '2026-09-08'), note(10, 'sonstige', '2026-09-15')] });
  const w = mittelwerte('DE1', HJ1);
  pruefe('Ohne Klausur zaehlt allein der muendliche Schnitt', w.gesamt === 11, `${w.gesamt}`);
  pruefe('Schriftlich bleibt leer statt null', w.schriftlich === null);
  pruefe('Der Schnitt wird NICHT durch 0,4 x 0 gedrueckt', w.gesamt > 6.6, `${w.gesamt}`);
}
{
  // Nur eine Klausur, noch keine muendliche Note.
  umgebung({ DE1: [note(9, 'klausur', '2026-09-08')] });
  const w = mittelwerte('DE1', HJ1);
  pruefe('Ohne muendliche Note zaehlt allein die Klausur', w.gesamt === 9, `${w.gesamt}`);
  pruefe('Muendlich bleibt leer statt null', w.muendlich === null);
}
{
  umgebung({ DE1: [] });
  pruefe('Fach ohne Noten ergibt null, nicht 0', kursSchnitt('DE1', HJ1) === null);
  pruefe('Gesamtschnitt ohne Noten ergibt null', gesamtSchnitt(HJ1) === null);
}

console.log('\n--- Gewichtung ---');
{
  umgebung({ DE1: [note(15, 'klausur', '2026-09-08'), note(5, 'sonstige', '2026-09-09')] }, { DE1: 40 });
  pruefe('40 % schriftlich: 15 und 5 ergeben 9', kursSchnitt('DE1', HJ1) === 9, `${kursSchnitt('DE1', HJ1)}`);

  umgebung({ DE1: [note(15, 'klausur', '2026-09-08'), note(5, 'sonstige', '2026-09-09')] }, { DE1: 50 });
  pruefe('50 % schriftlich: 15 und 5 ergeben 10', kursSchnitt('DE1', HJ1) === 10, `${kursSchnitt('DE1', HJ1)}`);

  // Mehrere muendliche Noten werden erst gemittelt, dann gewichtet.
  umgebung({ DE1: [note(15, 'klausur', '2026-09-08'), note(4, 'sonstige', '2026-09-09'), note(6, 'sonstige', '2026-09-10')] }, { DE1: 40 });
  pruefe('Mehrere muendliche Noten werden zuerst gemittelt', kursSchnitt('DE1', HJ1) === 9,
    `${kursSchnitt('DE1', HJ1)}`);
}

console.log('\n--- Noten gelten je Halbjahr ---');
{
  umgebung({
    DE1: [
      note(15, 'sonstige', '2026-09-08'), // 1. Halbjahr
      note(3, 'sonstige', '2027-03-01'),  // 2. Halbjahr
    ],
  });
  pruefe('1. Halbjahr sieht nur seine eigene Note', mittelwerte('DE1', HALBJAHRE[0]).gesamt === 15);
  pruefe('2. Halbjahr sieht nur seine eigene Note', mittelwerte('DE1', HALBJAHRE[1]).gesamt === 3);
  pruefe('Je Halbjahr genau eine Note gezaehlt',
    mittelwerte('DE1', HALBJAHRE[0]).anzahlMuendlich === 1 && mittelwerte('DE1', HALBJAHRE[1]).anzahlMuendlich === 1);
}

console.log('\n--- Halbjahre und Notenschluss ---');
{
  for (const hj of HALBJAHRE) {
    pruefe(`${hj.name}: Notenschluss liegt im Halbjahr`,
      hj.notenschluss >= hj.von && hj.notenschluss <= hj.ende, hj.notenschluss);
    const wt = new Date(`${hj.notenschluss}T12:00:00`).getDay();
    pruefe(`${hj.name}: Notenschluss ist ein Wochentag`, wt >= 1 && wt <= 5);
  }
  pruefe('Die Halbjahre ueberlappen nicht', HALBJAHRE[0].ende < HALBJAHRE[1].von);
  pruefe('Heute liegt im 1. Halbjahr', aktuellesHalbjahr('2026-09-08') === HALBJAHRE[0]);
  pruefe('Ein Tag nach dem Notenschluss gehoert noch zum Halbjahr',
    halbjahrZu('2026-12-11') === HALBJAHRE[0]);
  pruefe('Vor dem Schuljahr wird das 1. Halbjahr genommen',
    aktuellesHalbjahr('2026-05-01') === HALBJAHRE[0]);
}

console.log('\n--- Stundenhochrechnung ---');
{
  // Ohne veroeffentlichten Plan gibt es keinen Rhythmus - dann eben nichts,
  // aber ohne Absturz.
  umgebung({});
  const ohnePlan = stundenImHalbjahr(HJ1);
  pruefe('Ohne Plandaten keine erfundenen Stunden', Object.keys(ohnePlan).length === 0);

  // Mit einem Rhythmus von zwei Deutschstunden je Montag.
  const zustand = umgebung({});
  zustand.plan.wochen = [
    {
      montag: '2026-08-17',
      typ: 'A',
      veroeffentlicht: true,
      tage: [{ datum: '2026-08-17', stunden: [{ kurs: 'DE1' }, { kurs: 'DE1' }] }],
    },
    {
      montag: '2026-08-24',
      typ: 'B',
      veroeffentlicht: true,
      tage: [{ datum: '2026-08-24', stunden: [{ kurs: 'DE1' }, { kurs: 'DE1' }] }],
    },
  ];
  const gerechnet = stundenImHalbjahr(HJ1);
  pruefe('Deutsch wird hochgerechnet', (gerechnet.DE1?.gesamt ?? 0) > 0, `${gerechnet.DE1?.gesamt} Stunden`);
  pruefe('Schon vorbei ist nie mehr als insgesamt',
    gerechnet.DE1.bisher <= gerechnet.DE1.gesamt, `${gerechnet.DE1.bisher} von ${gerechnet.DE1.gesamt}`);
  // 2 Stunden je Montag, rund 18 Montage bis zum 10.12. -> plausibel zwischen 20 und 40
  pruefe('Ergebnis liegt in einer plausiblen Groesse',
    gerechnet.DE1.gesamt >= 20 && gerechnet.DE1.gesamt <= 40, `${gerechnet.DE1.gesamt}`);
}

console.log(fehler === 0 ? '\nAlle Pruefungen bestanden.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
