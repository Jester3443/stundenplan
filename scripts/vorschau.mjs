// Tagesmeldung per Push - zwei Betriebsarten:
//   node scripts/vorschau.mjs abend   -> Blick auf MORGEN (abends um 21 Uhr)
//   node scripts/vorschau.mjs morgen  -> Blick auf HEUTE  (morgens um 6:30 Uhr)
//
// Abends wird nur gemeldet, wenn etwas vom Normalplan abweicht oder
// Hausaufgaben anstehen. Morgens kommt immer ein kurzer Ueberblick,
// solange Unterricht ist.
import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import webpush from 'web-push';
import { BENUTZER } from '../public/shared/konfiguration.mjs';

const ART = process.argv[2] === 'morgen' ? 'morgen' : 'abend';

const OEFFENTLICH = (process.env.VAPID_PUBLIC ?? '').trim();
const PRIVAT = (process.env.VAPID_PRIVATE ?? '').trim();
const aboFuer = (kennung) =>
  (
    process.env[`PUSH_SUBSCRIPTION_${kennung.toUpperCase()}`] ??
    (kennung === 'jasper' ? process.env.PUSH_SUBSCRIPTION : '') ??
    ''
  ).trim();
const KONTAKT = (process.env.VAPID_KONTAKT ?? 'https://stundenplan-jasper.web.app').trim();

if (!OEFFENTLICH || !PRIVAT) {
  console.log('Push nicht konfiguriert - uebersprungen.');
  process.exit(0);
}

/** Datum in deutscher Zeit (der Server rechnet in UTC). */
function inBerlin(versatzTage = 0) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return format.format(new Date(Date.now() + versatzTage * 24 * 3600 * 1000)); // en-CA => YYYY-MM-DD
}

const zieldatum = ART === 'morgen' ? inBerlin(0) : inBerlin(1);

webpush.setVapidDetails(KONTAKT, OEFFENTLICH, PRIVAT);

let gesamtVerschickt = 0;

for (const kennung of Object.keys(BENUTZER)) {
  const empfaenger = aboFuer(kennung);
  if (!empfaenger) continue;

  let plan;
  try {
    plan = JSON.parse(await readFile(`data/letzter-plan-${kennung}.json`, 'utf8'));
  } catch {
    continue;
  }

  let tag = null;
  for (const woche of plan.wochen ?? []) {
    const treffer = woche.tage.find((t) => t.datum === zieldatum);
    if (treffer) tag = treffer;
  }
  if (!tag || !tag.stunden.length) continue;

  const stunden = [...tag.stunden].filter((s) => s.kurs).sort((a, b) => a.von.localeCompare(b.von));
  const entfallen = stunden.filter((s) => s.status === 'CANCELLED');
  const gueltig = stunden.filter((s) => s.status !== 'CANCELLED');

  const hausaufgaben = stunden
    .flatMap((s) => (s.aufgaben ?? []).map((a) => ({ fach: s.fachName, text: a.text || a.anmerkung })))
    .filter((h) => h.text);

  const zeilen = [];
  let titel = null;

  if (!gueltig.length) {
    titel = ART === 'morgen' ? 'Heute schulfrei 🎉' : 'Morgen fällt alles aus 🎉';
  } else {
    const geplantStart = stunden[0];
    const geplantEnde = stunden[stunden.length - 1];
    const echtStart = gueltig[0];
    const echtEnde = gueltig[gueltig.length - 1];
    const spaeterHin = echtStart.von > geplantStart.von;
    const frueherWeg = echtEnde.bis < geplantEnde.bis;

    if (ART === 'morgen') {
      titel = `Heute: ${echtStart.von} – ${echtEnde.bis}`;
      zeilen.push(`${gueltig.length} ${gueltig.length === 1 ? 'Block' : 'Blöcke'} · Start ${echtStart.von}, Schluss ${echtEnde.bis}`);
    } else if (spaeterHin && frueherWeg) {
      titel = `Morgen: erst ${echtStart.von}, Schluss ${echtEnde.bis} 🎉`;
    } else if (spaeterHin) {
      titel = `Morgen ausschlafen: Start erst ${echtStart.von} ⏰`;
    } else if (frueherWeg) {
      titel = `Morgen früher Schluss: ${echtEnde.bis} 🎉`;
    } else if (entfallen.length) {
      titel = `Morgen: ${entfallen.length === 1 ? 'eine Stunde entfällt' : entfallen.length + ' Stunden entfallen'}`;
    }
  }

  for (const s of entfallen) zeilen.push(`${s.block} ${s.fachName} entfällt`);
  for (const h of hausaufgaben.slice(0, 3)) zeilen.push(`Hausaufgabe ${h.fach}: ${h.text}`);

  // Abends nur melden, wenn es wirklich etwas zu sagen gibt.
  if (!titel && !hausaufgaben.length) continue;
  titel ??= hausaufgaben.length === 1 ? 'Eine Hausaufgabe für morgen' : `${hausaufgaben.length} Hausaufgaben für morgen`;

  let anmeldungen;
  try {
    const gelesen = JSON.parse(empfaenger);
    anmeldungen = Array.isArray(gelesen) ? gelesen : [gelesen];
  } catch {
    console.error(`Push-Anmeldung fuer ${kennung} ist kein gueltiges JSON.`);
    continue;
  }

  for (const anmeldung of anmeldungen) {
    try {
      await webpush.sendNotification(
        anmeldung,
        // marke + datum braucht die App, um die eigenen Aufgaben anzuhaengen.
        JSON.stringify({ titel, koerper: zeilen.join('\n'), marke: ART === 'morgen' ? 'morgen' : 'abendblick', datum: zieldatum })
      );
      gesamtVerschickt++;
    } catch (fehler) {
      const code = fehler.statusCode ?? 0;
      console.error(
        code === 404 || code === 410
          ? `Push-Anmeldung (${kennung}) abgelaufen - in der App erneuern.`
          : `Push fehlgeschlagen (${code}): ${String(fehler.body ?? fehler.message).slice(0, 120)}`
      );
    }
  }

  console.log(process.env.KNAPP ? `${kennung}: gesendet.` : `${kennung}: "${titel}"`);
}

if (!gesamtVerschickt) console.log(`${ART}: nichts zu melden.`);
