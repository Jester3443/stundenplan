// Verschickt Push-Nachrichten, wenn der letzte Abruf Aenderungen gefunden hat.
// Laeuft nach sync.mjs und geht alle Personen durch, fuer die eine
// Push-Anmeldung hinterlegt ist.
import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import webpush from 'web-push';
import { BENUTZER } from '../public/shared/konfiguration.mjs';
import { anmeldungenFuer } from './push-ziele.mjs';

const OEFFENTLICH = (process.env.VAPID_PUBLIC ?? '').trim();
const PRIVAT = (process.env.VAPID_PRIVATE ?? '').trim();
const KONTAKT = (process.env.VAPID_KONTAKT ?? 'https://stundenplan-jasper.web.app').trim();

if (!OEFFENTLICH || !PRIVAT) {
  console.log('Keine VAPID-Schluessel gesetzt - Push wird uebersprungen.');
  process.exit(0);
}
webpush.setVapidDetails(KONTAKT, OEFFENTLICH, PRIVAT);

const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const kurz = (a) => {
  const d = new Date(`${a.datum}T12:00:00`);
  return `${TAGE[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}. · ${a.text}`;
};

// Entfall zuerst - das ist die Meldung, auf die es ankommt.
const RANG = { entfall: 0, vertretung: 1, raum: 2, hausaufgabe: 3, zurueck: 4, neu: 5, gestrichen: 6, hinweis: 7 };

export async function sendeAn(abo, inhalt) {
  // Nimmt entweder eine fertige Liste oder den JSON-Text aus einem Secret.
  const liste = Array.isArray(abo)
    ? abo
    : (() => {
        const gelesen = JSON.parse(abo);
        return Array.isArray(gelesen) ? gelesen : [gelesen];
      })();

  let verschickt = 0;
  for (const anmeldung of liste) {
    try {
      await webpush.sendNotification(anmeldung, JSON.stringify(inhalt));
      verschickt++;
    } catch (fehler) {
      const code = fehler.statusCode ?? 0;
      console.error(
        code === 404 || code === 410
          ? 'Push-Anmeldung abgelaufen - in der App erneuern.'
          : `Push fehlgeschlagen (${code}): ${String(fehler.body ?? fehler.message).slice(0, 120)}`
      );
    }
  }
  return verschickt;
}

let gesamt = 0;

for (const kennung of Object.keys(BENUTZER)) {
  const abo = await anmeldungenFuer(kennung);
  if (!abo.length) {
    console.log(`${kennung}: keine Push-Anmeldung hinterlegt.`);
    continue;
  }

  let plan;
  try {
    plan = JSON.parse(await readFile(`data/letzter-plan-${kennung}.json`, 'utf8'));
  } catch {
    continue; // fuer diese Person gibt es (noch) keinen Stand
  }

  const aenderungen = plan.aenderungen ?? [];
  if (!aenderungen.length) continue;

  const sortiert = [...aenderungen].sort((a, b) => (RANG[a.art] ?? 9) - (RANG[b.art] ?? 9));
  const entfaelle = sortiert.filter((a) => a.art === 'entfall');

  const titel = entfaelle.length
    ? entfaelle.length === 1
      ? 'Eine Stunde fällt aus'
      : `${entfaelle.length} Stunden fallen aus`
    : aenderungen.length === 1
      ? 'Änderung im Stundenplan'
      : `${aenderungen.length} Änderungen im Stundenplan`;

  const anzahl = await sendeAn(abo, {
    titel,
    koerper: sortiert.slice(0, 4).map(kurz).join('\n'),
    marke: 'stundenplan',
    datum: sortiert[0]?.datum ?? null,
  });

  gesamt += anzahl;
  console.log(
    process.env.KNAPP
      ? `${kennung}: ${anzahl} Nachricht(en) verschickt.`
      : `${kennung}: ${anzahl} Nachricht(en) - "${titel}"`
  );
}

if (!gesamt) console.log('Keine Aenderungen - keine Nachricht.');
