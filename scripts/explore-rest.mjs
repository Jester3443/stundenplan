// Sucht die moderne REST-Schnittstelle, die die neue WebUntis-Oberflaeche
// unter /timetable/my-student benutzt - die liefert NUR die eigenen Kurse.
// Wichtig: WebUntis braucht ZWEI Cookies (JSESSIONID + schoolname als base64).
import { writeFile, mkdir } from 'node:fs/promises';
import { createClient } from './untis.mjs';
import 'dotenv/config';

const SCHULE = process.env.UNTIS_SCHOOL.trim();
const HOST = process.env.UNTIS_HOST.trim();

const { client } = createClient();
await client.login();

const info = client.sessionInformation ?? {};
console.log(`\nAngemeldet als personId ${info.personId}, personType ${info.personType}, klasseId ${info.klasseId}`);

const schoolBase64 = Buffer.from(`_${SCHULE}`).toString('base64');
const cookies = `JSESSIONID=${info.sessionId}; schoolname="${schoolBase64}"`;

let bearer = null;

const hole = async (label, pfad) => {
  const url = `https://${HOST}${pfad}`;
  const headers = { Cookie: cookies, Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  try {
    const antwort = await fetch(url, { headers, redirect: 'manual' });
    const text = await antwort.text();
    let daten = text;
    try {
      daten = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    console.log(`\n[${antwort.status}] ${label}`);
    console.log(`  ${pfad}`);
    console.log(`  ${(typeof daten === 'string' ? daten : JSON.stringify(daten)).slice(0, 400)}`);
    return antwort.ok ? daten : null;
  } catch (error) {
    console.log(`\n[ERR] ${label}: ${error.message}`);
    return null;
  }
};

console.log('\n\n=== 1. Bearer-Token ===');
const token = await hole('Token', '/WebUntis/api/token/new');
if (typeof token === 'string' && token.length > 20) {
  bearer = token.trim();
  console.log(`  -> Token erhalten (${bearer.length} Zeichen)`);
}

console.log('\n\n=== 2. Eigene Stammdaten ===');
const ergebnisse = {};
ergebnisse.appdata = await hole('App-Daten', '/WebUntis/api/rest/view/v1/app/data');

console.log('\n\n=== 3. Persoenlicher Stundenplan ===');
const montag = '2026-08-17';
const freitag = '2026-08-21';

const kandidaten = [
  ['REST view v1 entries (MY_TIMETABLE)',
    `/WebUntis/api/rest/view/v1/timetable/entries?start=${montag}&end=${freitag}&format=1&resourceType=STUDENT&resources=${info.personId}&periodTypes=&timetableType=MY_TIMETABLE`],
  ['REST view v1 entries (STANDARD)',
    `/WebUntis/api/rest/view/v1/timetable/entries?start=${montag}&end=${freitag}&format=1&resourceType=STUDENT&resources=${info.personId}&periodTypes=&timetableType=STANDARD`],
  ['weekly/data elementType=5 (Schueler)',
    `/WebUntis/api/public/timetable/weekly/data?elementType=5&elementId=${info.personId}&date=${montag}&formatId=2`],
  ['weekly/pageconfig',
    `/WebUntis/api/public/timetable/weekly/pageconfig?type=5&date=${montag}`],
  ['Mein Unterricht (Kursliste)',
    `/WebUntis/api/rest/view/v1/timetable/filter?resourceType=STUDENT&timetableType=MY_TIMETABLE`],
  ['Schuelerdaten', `/WebUntis/api/rest/view/v1/students/${info.personId}`],
];

for (const [label, pfad] of kandidaten) {
  ergebnisse[label] = await hole(label, pfad);
}

await mkdir('data', { recursive: true });
await writeFile('data/rest-probe.json', JSON.stringify({ info: { ...info, sessionId: '***' }, ergebnisse }, null, 2), 'utf8');
console.log('\n\nVollstaendige Antworten in data/rest-probe.json\n');

await client.logout();
