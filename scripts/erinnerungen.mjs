// Erinnerung kurz vor der Stunde: "Du hast dich bei Frau Gross noch nicht
// entschuldigt - gleich ist Biologie."
//
// Laeuft bei jedem Abruf (alle fuenf Minuten). Verschickt wird, wenn eine
// betroffene Stunde in den naechsten 20 Minuten beginnt und noch keine
// Erinnerung dazu rausging. Was schon rausging, steht in
// public/data/erinnerungen.json und wandert mit auf den data-Zweig - nur
// als Hash, das Repo ist oeffentlich.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import 'dotenv/config';
import webpush from 'web-push';
import { BENUTZER } from '../public/shared/konfiguration.mjs';
import { anmeldungenFuer } from './push-ziele.mjs';
import { eigeneDatenFuer, erinnerungenFuer } from './eigene-daten.mjs';

const OEFFENTLICH = (process.env.VAPID_PUBLIC ?? '').trim();
const PRIVAT = (process.env.VAPID_PRIVATE ?? '').trim();
const KONTAKT = (process.env.VAPID_KONTAKT ?? 'https://stundenplan-jasper.web.app').trim();
if (!OEFFENTLICH || !PRIVAT) {
  console.log('Push nicht konfiguriert - Erinnerungen uebersprungen.');
  process.exit(0);
}
webpush.setVapidDetails(KONTAKT, OEFFENTLICH, PRIVAT);

/** So viele Minuten vor Stundenbeginn darf die Erinnerung fruehestens kommen. */
const VORLAUF_MINUTEN = 20;

/** Datum und Uhrzeit in deutscher Zeit - der Server rechnet in UTC. */
function jetztInBerlin() {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((t) => [t.type, t.value])
  );
  return { datum: `${teile.year}-${teile.month}-${teile.day}`, minuten: Number(teile.hour) * 60 + Number(teile.minute) };
}
const minutenVon = (uhr) => Number(uhr.slice(0, 2)) * 60 + Number(uhr.slice(3, 5));

// Gesendet-Liste: zuerst der Stand vom data-Zweig, sonst die lokale Datei.
const basisDir = (process.env.BASIS_DIR ?? '').trim();
let gesendet = {};
for (const pfad of [basisDir && `${basisDir}/erinnerungen.json`, 'public/data/erinnerungen.json'].filter(Boolean)) {
  try {
    gesendet = JSON.parse(await readFile(pfad, 'utf8'));
    break;
  } catch {
    /* noch nichts gesendet */
  }
}
const kennungVon = (kennung, e) =>
  createHash('sha256').update(`${kennung}|${e.datum}|${e.von}|${e.kurs}`).digest('hex').slice(0, 16);

const { datum: heute, minuten: jetzt } = jetztInBerlin();
let verschickt = 0;

for (const kennung of Object.keys(BENUTZER)) {
  const anmeldungen = await anmeldungenFuer(kennung);
  if (!anmeldungen.length) continue;

  let plan;
  try {
    plan = JSON.parse(await readFile(`data/letzter-plan-${kennung}.json`, 'utf8'));
  } catch {
    continue;
  }

  const daten = await eigeneDatenFuer(kennung);
  if (!daten) continue;

  for (const e of erinnerungenFuer(plan, daten, heute)) {
    const beginn = minutenVon(e.von);
    const abstand = beginn - jetzt;
    if (abstand < 0 || abstand > VORLAUF_MINUTEN) continue;
    const schluessel = kennungVon(kennung, e);
    if (gesendet[schluessel]) continue;

    const wann = abstand <= 1 ? 'gleich' : `in ${abstand} Minuten`;
    const inhalt = {
      titel: `Entschuldigung nicht vergessen`,
      koerper: `${e.fach} ${wann}${e.lehrer ? ` bei ${e.lehrer}` : ''}${e.block ? ` · ${e.block} Stunde` : ''} – die Entschuldigung ist noch offen.`,
      marke: 'entschuldigung',
      datum: heute,
    };
    for (const anmeldung of anmeldungen) {
      try {
        await webpush.sendNotification(anmeldung, JSON.stringify(inhalt));
        verschickt++;
      } catch (fehler) {
        console.error(`Erinnerung (${kennung}) fehlgeschlagen: ${fehler.statusCode ?? fehler.message}`);
      }
    }
    gesendet[schluessel] = new Date().toISOString();
    console.log(`${kennung}: Erinnerung verschickt (${e.kurs}, ${e.von}).`);
  }
}

// Alte Eintraege loswerden - zwei Tage reichen, damit nichts doppelt kommt.
const grenze = new Date(Date.now() - 2 * 86400000).toISOString();
for (const [k, wann] of Object.entries(gesendet)) if (wann < grenze) delete gesendet[k];
await mkdir('public/data', { recursive: true });
await writeFile('public/data/erinnerungen.json', JSON.stringify(gesendet), 'utf8');

if (!verschickt) console.log('Keine Erinnerung faellig.');
