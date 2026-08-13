// Prueft, ob die Schule Hausaufgaben, Lehrertexte und Mitteilungen herausgibt.
import { UntisRest, isoDatum, montagVon } from './untis-rest.mjs';

const untis = new UntisRest();
await untis.anmelden();
const client = untis.client;

const von = montagVon(new Date());
const bis = new Date(von);
bis.setDate(bis.getDate() + 27);

const zeig = (label, wert) => {
  const text = JSON.stringify(wert);
  console.log(`\n--- ${label} ---`);
  console.log(text ? text.slice(0, 900) : '(leer)');
};

const versuch = async (label, fn) => {
  try {
    const r = await fn();
    const anzahl = Array.isArray(r) ? r.length : r && typeof r === 'object' ? Object.keys(r).length : 0;
    console.log(`  ✓ ${label}  (${anzahl} Eintraege)`);
    return r;
  } catch (e) {
    console.log(`  ✗ ${label}  -- ${e.message.slice(0, 90)}`);
    return null;
  }
};

console.log('\nAlte Schnittstelle:');
const ha1 = await versuch('getHomeWorksFor', () => client.getHomeWorksFor(von, bis));
const ha2 = await versuch('getHomeWorkAndLessons', () => client.getHomeWorkAndLessons(von, bis));

console.log('\nNeue REST-Schnittstelle:');
const pfade = [
  ['Hausaufgaben (student)', `/WebUntis/api/homeworks/lessons?startDate=${isoDatum(von).replace(/-/g, '')}&endDate=${isoDatum(bis).replace(/-/g, '')}`],
  ['Hausaufgaben rest v1', `/WebUntis/api/rest/view/v1/homeworks?start=${isoDatum(von)}&end=${isoDatum(bis)}`],
  ['Mitteilungen', `/WebUntis/api/rest/view/v1/messages/status`],
  ['Tagesnachrichten', `/WebUntis/api/public/news/newsWidgetData?date=${isoDatum(new Date()).replace(/-/g, '')}`],
];
const rest = {};
for (const [label, pfad] of pfade) {
  rest[label] = await versuch(label, () => untis.rest(pfad));
}

zeig('getHomeWorksFor', ha1);
zeig('getHomeWorkAndLessons', ha2);
for (const [label, wert] of Object.entries(rest)) if (wert) zeig(label, wert);

// Gibt es in den Stunden selbst Lehrertexte?
console.log('\n--- Lehrertexte in den Stunden ---');
const tage = await untis.meinPlan(isoDatum(von), isoDatum(new Date(von.getTime() + 13 * 864e5)));
let gefunden = 0;
for (const tag of tage) {
  for (const s of tag.stunden) {
    if (s.text) {
      console.log(`  ${tag.datum} ${s.von} ${s.fach || '(Termin)'}: ${s.text}`);
      gefunden++;
    }
  }
}
if (!gefunden) console.log('  (aktuell keine Texte hinterlegt)');

await untis.abmelden();
