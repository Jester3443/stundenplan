// Verschickt eine Push-Nachricht, wenn der letzte Abruf Aenderungen gefunden hat.
// Laeuft nach sync.mjs - liest dessen Ergebnis aus data/letzter-plan.json.
import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import webpush from 'web-push';

const OEFFENTLICH = (process.env.VAPID_PUBLIC ?? '').trim();
const PRIVAT = (process.env.VAPID_PRIVATE ?? '').trim();
const EMPFAENGER = (process.env.PUSH_SUBSCRIPTION ?? '').trim();
// Der "Kontakt" ist nur ein technischer Hinweis an Apple/Google, wohin sie sich
// bei Problemen wenden koennen - eine URL genuegt, keine E-Mail noetig.
const KONTAKT = (process.env.VAPID_KONTAKT ?? 'https://stundenplan-jasper.web.app').trim();

if (!OEFFENTLICH || !PRIVAT) {
  console.log('Keine VAPID-Schluessel gesetzt - Push wird uebersprungen.');
  process.exit(0);
}
if (!EMPFAENGER) {
  console.log('Keine Push-Anmeldung hinterlegt - Push wird uebersprungen.');
  process.exit(0);
}

const plan = JSON.parse(await readFile('data/letzter-plan.json', 'utf8'));
const aenderungen = plan.aenderungen ?? [];

if (!aenderungen.length) {
  console.log('Keine Aenderungen - keine Nachricht.');
  process.exit(0);
}

const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const kurz = (a) => {
  const d = new Date(`${a.datum}T12:00:00`);
  return `${TAGE[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}. · ${a.text}`;
};

// Entfall zuerst - das ist die Meldung, auf die es ankommt.
const rang = { entfall: 0, vertretung: 1, raum: 2, zurueck: 3, neu: 4, gestrichen: 5, hinweis: 6 };
const sortiert = [...aenderungen].sort((a, b) => (rang[a.art] ?? 9) - (rang[b.art] ?? 9));

const entfaelle = sortiert.filter((a) => a.art === 'entfall');
const titel = entfaelle.length
  ? entfaelle.length === 1
    ? 'Eine Stunde fällt aus'
    : `${entfaelle.length} Stunden fallen aus`
  : aenderungen.length === 1
    ? 'Änderung im Stundenplan'
    : `${aenderungen.length} Änderungen im Stundenplan`;

const koerper = sortiert.slice(0, 4).map(kurz).join('\n');

webpush.setVapidDetails(KONTAKT, OEFFENTLICH, PRIVAT);

let anmeldungen;
try {
  const gelesen = JSON.parse(EMPFAENGER);
  anmeldungen = Array.isArray(gelesen) ? gelesen : [gelesen];
} catch {
  console.error('PUSH_SUBSCRIPTION ist kein gueltiges JSON.');
  process.exit(1);
}

let verschickt = 0;
for (const anmeldung of anmeldungen) {
  try {
    await webpush.sendNotification(
      anmeldung,
      JSON.stringify({
        titel,
        koerper,
        marke: 'stundenplan',
        datum: sortiert[0]?.datum ?? null,
      })
    );
    verschickt++;
  } catch (fehler) {
    // 404/410 heisst: Diese Anmeldung gilt nicht mehr (App geloescht, Schluessel gewechselt).
    const code = fehler.statusCode ?? 0;
    console.error(
      code === 404 || code === 410
        ? 'Eine Push-Anmeldung ist abgelaufen und muss in der App erneuert werden.'
        : `Push fehlgeschlagen (${code}): ${String(fehler.body ?? fehler.message).slice(0, 120)}`
    );
  }
}

// Im oeffentlichen Cloud-Protokoll nur die Anzahl nennen, nicht den Inhalt.
console.log(process.env.KNAPP ? `${verschickt} Nachricht(en) verschickt.` : `${verschickt} Nachricht(en) verschickt: ${titel}`);
