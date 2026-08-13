// Prueft, ob die Zugangsdaten in der .env funktionieren, und zeigt,
// welche Daten WebUntis fuer diesen Account tatsaechlich herausgibt.
import { createClient, untisDateToText, untisTimeToText } from './untis.mjs';

const ok = (t) => console.log(`  ✓ ${t}`);
const fail = (t) => console.log(`  ✗ ${t}`);

let session;
try {
  session = createClient();
} catch (error) {
  console.error(`\nAbbruch: ${error.message}\n`);
  process.exit(1);
}

const { mode, client } = session;
console.log(`\nVerbinde mit WebUntis (${mode}) ...`);

try {
  await client.login();
  ok('Login erfolgreich');
} catch (error) {
  fail(`Login fehlgeschlagen: ${error.message}`);
  console.error('\nPruefe Benutzername und Schluessel/Passwort in der .env.\n');
  process.exit(1);
}

const probe = async (label, fn) => {
  try {
    const result = await fn();
    ok(label);
    return result;
  } catch (error) {
    fail(`${label} -- nicht verfuegbar (${error.message})`);
    return null;
  }
};

console.log('\nWelche Endpunkte gibt deine Schule frei?');
const year = await probe('Schuljahr', () => client.getCurrentSchoolyear());
const grid = await probe('Stundenraster (Zeiten der 1.-8. Stunde)', () => client.getTimegrid());
const subjects = await probe('Faecherliste', () => client.getSubjects());
const holidays = await probe('Ferien', () => client.getHolidays());
await probe('Klausurtermine', () => {
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 864e5);
  return client.getExamsForRange(now, end);
});
await probe('Nachrichten / Tagesmeldungen', () => client.getNewsWidget(new Date()));

// Die Wochenansicht ist die wichtigste Quelle: nur sie liefert den
// Status je Stunde (Entfall, Vertretung, Raumwechsel).
const week = await probe('Wochenplan MIT Vertretungsinfo', () =>
  client.getOwnTimetableForWeek(new Date())
);

if (year) {
  console.log(
    `\nSchuljahr: ${year.name} (${untisDateToText(year.startDate)} bis ${untisDateToText(year.endDate)})`
  );
}

if (Array.isArray(grid) && grid.length) {
  console.log('\nStundenzeiten:');
  for (const unit of grid[0].timeUnits ?? []) {
    console.log(
      `  ${String(unit.name).padStart(2)}. Stunde   ${untisTimeToText(unit.startTime)} - ${untisTimeToText(unit.endTime)}`
    );
  }
}

if (Array.isArray(week) && week.length) {
  console.log(`\nAktuelle Woche: ${week.length} Eintraege gefunden.`);
  const codes = new Set();
  for (const entry of week) {
    if (entry.cellState) codes.add(entry.cellState);
  }
  console.log(`Vorkommende Stunden-Zustaende: ${[...codes].join(', ') || 'keine'}`);
  console.log('\nBeispiel-Eintrag (Rohdaten, damit ich das Format kenne):');
  console.log(JSON.stringify(week[0], null, 2));
}

if (Array.isArray(subjects)) {
  console.log(`\n${subjects.length} Faecher im System.`);
}
if (Array.isArray(holidays)) {
  const next = holidays.find((h) => h.endDate >= Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')));
  if (next) {
    console.log(`Naechste Ferien: ${next.longName} ab ${untisDateToText(next.startDate)}`);
  }
}

await client.logout();
console.log('\nFertig. Abgemeldet.\n');
