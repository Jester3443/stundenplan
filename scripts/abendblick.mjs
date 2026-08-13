// Abendvorschau: Prueft am Vorabend, ob MORGEN etwas vom Normalplan abweicht
// (Entfall, spaeterer Start, frueherer Schluss) und schickt genau dann eine
// Push-Nachricht. Weicht nichts ab, bleibt das Handy still.
import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import webpush from 'web-push';

const OEFFENTLICH = (process.env.VAPID_PUBLIC ?? '').trim();
const PRIVAT = (process.env.VAPID_PRIVATE ?? '').trim();
const EMPFAENGER = (process.env.PUSH_SUBSCRIPTION ?? '').trim();
const KONTAKT = (process.env.VAPID_KONTAKT ?? 'https://stundenplan-jasper.web.app').trim();

if (!OEFFENTLICH || !PRIVAT || !EMPFAENGER) {
  console.log('Push nicht konfiguriert - Abendvorschau uebersprungen.');
  process.exit(0);
}

/** Morgiges Datum in deutscher Zeit (der Server rechnet in UTC). */
const morgenBerlin = () => {
  const inBerlin = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return inBerlin.format(new Date(Date.now() + 24 * 3600 * 1000)); // en-CA => YYYY-MM-DD
};

const plan = JSON.parse(await readFile('data/letzter-plan.json', 'utf8'));
const morgen = morgenBerlin();

let tag = null;
for (const woche of plan.wochen ?? []) {
  tag = woche.tage.find((t) => t.datum === morgen) ?? tag;
}

if (!tag || !tag.stunden.length) {
  console.log(`Morgen (${morgen}): keine Stunden im Plan - nichts zu melden.`);
  process.exit(0);
}

const stunden = [...tag.stunden].filter((s) => s.kurs).sort((a, b) => a.von.localeCompare(b.von));
const entfallen = stunden.filter((s) => s.status === 'CANCELLED');
const gueltig = stunden.filter((s) => s.status !== 'CANCELLED');

if (!entfallen.length) {
  console.log(`Morgen (${morgen}): alles nach Plan - keine Nachricht.`);
  process.exit(0);
}

const zeilen = entfallen.map((s) => `${s.block} ${s.fachName} entfällt`);

let titel;
if (!gueltig.length) {
  titel = 'Morgen fällt alles aus – schulfrei! 🎉';
} else {
  const geplantStart = stunden[0];
  const geplantEnde = stunden[stunden.length - 1];
  const echtStart = gueltig[0];
  const echtEnde = gueltig[gueltig.length - 1];

  const spaeterHin = echtStart.von > geplantStart.von;
  const frueherWeg = echtEnde.bis < geplantEnde.bis;

  if (spaeterHin && frueherWeg) {
    titel = `Morgen: erst ${echtStart.von}, Schluss ${echtEnde.bis} 🎉`;
  } else if (spaeterHin) {
    titel = `Morgen ausschlafen: Start erst ${echtStart.von} ⏰`;
    zeilen.push(`Start ${echtStart.von} statt ${geplantStart.von}`);
  } else if (frueherWeg) {
    titel = `Morgen früher Schluss: ${echtEnde.bis} 🎉`;
    zeilen.push(`Schluss ${echtEnde.bis} statt ${geplantEnde.bis}`);
  } else {
    titel = `Morgen: ${entfallen.length === 1 ? 'eine Stunde entfällt' : entfallen.length + ' Stunden entfallen'}`;
  }
}

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
      JSON.stringify({ titel, koerper: zeilen.join('\n'), marke: 'abendblick', datum: morgen })
    );
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

console.log(
  process.env.KNAPP
    ? `Abendvorschau: ${verschickt} Nachricht(en) verschickt.`
    : `Abendvorschau: ${verschickt} Nachricht(en) verschickt - "${titel}"`
);
