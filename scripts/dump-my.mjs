// Holt den persoenlichen Plan ueber mehrere Wochen, zeigt ihn lesbar an
// und prueft, ob die A/B-Wochen-Logik zum Papierplan passt.
import { writeFile, mkdir } from 'node:fs/promises';
import { UntisRest, isoDatum, montagVon } from './untis-rest.mjs';

const ANKER_A = new Date(2026, 7, 17); // 17.08.2026 ist laut Jasper eine A-Woche
const WOCHEN = Number(process.argv[2] ?? 6);

const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const wochentyp = (montag) => {
  const diff = Math.round((montag - montagVon(ANKER_A)) / (7 * 864e5));
  return ((diff % 2) + 2) % 2 === 0 ? 'A' : 'B';
};

const untis = new UntisRest();
console.log(`\nMelde an (${untis.anmeldeart}) ...`);
const session = await untis.anmelden();
console.log(`Angemeldet als personId ${session.personId}.`);

const wochen = [];
for (let i = 0; i < WOCHEN; i++) {
  const montag = new Date(montagVon(ANKER_A));
  montag.setDate(montag.getDate() + i * 7);
  const freitag = new Date(montag);
  freitag.setDate(freitag.getDate() + 4);

  const typ = wochentyp(montag);
  try {
    const tage = await untis.meinPlan(isoDatum(montag), isoDatum(freitag));
    wochen.push({ montag: isoDatum(montag), typ, tage });
    const anzahl = tage.reduce((n, t) => n + t.stunden.length, 0);
    console.log(`  Woche ab ${isoDatum(montag)} (${typ}): ${anzahl} Stunden`);
  } catch (error) {
    console.log(`  Woche ab ${isoDatum(montag)} (${typ}): FEHLER - ${error.message.slice(0, 120)}`);
  }
}

await untis.abmelden();

for (const woche of wochen) {
  console.log(`\n\n=== Woche ab ${woche.montag} -- ${woche.typ}-Woche ===`);
  for (const tag of woche.tage) {
    const d = new Date(`${tag.datum}T12:00:00`);
    console.log(`\n  ${TAGE[d.getDay()]}, ${tag.datum}${tag.status !== 'REGULAR' ? `  [${tag.status}]` : ''}`);
    for (const h of tag.hinweise) console.log(`     Hinweis: ${h.text}`);
    if (!tag.stunden.length) console.log('     (frei)');

    for (const s of [...tag.stunden].sort((a, b) => a.von.localeCompare(b.von))) {
      const marke =
        s.status === 'CANCELLED' ? ' ENTFALL' : s.status === 'REGULAR' ? '' : ` ${s.status}`;
      const ersetzt = [
        s.fachErsetzt && `Fach statt ${s.fachErsetzt}`,
        s.lehrerErsetzt && `statt ${s.lehrerErsetzt}`,
        s.raumErsetzt && `Raum statt ${s.raumErsetzt}`,
      ]
        .filter(Boolean)
        .join(', ');
      console.log(
        `     ${s.von}-${s.bis}  ${(s.fach || s.name || s.typ).padEnd(9)} ${s.lehrer.padEnd(6)} ${(s.raum || '-').padEnd(9)}${marke}${ersetzt ? '  (' + ersetzt + ')' : ''}${s.text ? '  » ' + s.text : ''}`
      );
    }
  }
}

// --- A/B-Analyse ---
console.log('\n\n=== A/B-Analyse: kommt der Kurs nur in A-, nur in B- oder in jeder Woche vor? ===');
const slots = new Map();
for (const woche of wochen) {
  for (const tag of woche.tage) {
    const wt = TAGE[new Date(`${tag.datum}T12:00:00`).getDay()];
    for (const s of tag.stunden) {
      if (!s.fach) continue;
      const key = `${wt}|${s.von}|${s.fach}`;
      if (!slots.has(key)) slots.set(key, { A: 0, B: 0, lehrer: s.lehrer, raum: s.raum, bis: s.bis });
      slots.get(key)[woche.typ]++;
    }
  }
}
const reihen = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
for (const [key, z] of [...slots.entries()].sort((a, b) => {
  const [tA, vA] = a[0].split('|');
  const [tB, vB] = b[0].split('|');
  return reihen.indexOf(tA) - reihen.indexOf(tB) || vA.localeCompare(vB);
})) {
  const [tag, von, fach] = key.split('|');
  const typ = z.A && z.B ? 'jede Woche' : z.A ? 'nur A' : 'nur B';
  console.log(
    `  ${tag.padEnd(11)} ${von}-${z.bis}  ${fach.padEnd(8)} ${z.lehrer.padEnd(6)} ${(z.raum || '-').padEnd(9)} -> ${typ.padEnd(11)} (A:${z.A} B:${z.B})`
  );
}

await mkdir('data', { recursive: true });
await writeFile('data/mein-plan.json', JSON.stringify(wochen, null, 2), 'utf8');
console.log('\nGespeichert: data/mein-plan.json\n');
