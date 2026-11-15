// Erinnerung kurz vor der Stunde: "Du hast dich bei Frau Gross noch nicht
// entschuldigt - gleich ist Biologie."
//
// Laeuft bei jedem Lauf von sync.yml (alle fuenf Minuten, angestossen vom
// Taktgeber) - auch bei denen ohne Abruf beim Schulserver ("melden").
// Verschickt wird, sobald eine betroffene Stunde in hoechstens 15 Minuten
// beginnt und noch keine Erinnerung dazu angekommen ist. Der Taktgeber legt
// seine Laeufe auf :02, :07, :12 ... - bei den Anfangszeiten 8:00, 9:50,
// 11:30, 14:05 und 15:45 trifft damit immer ein Lauf 13 Minuten vorher ein.
// Faellt genau dieser Lauf aus, holen die naechsten es nach - notfalls bis
// zehn Minuten nach Stundenbeginn.
//
// Was schon rausging, steht in public/data/erinnerungen.json und wandert mit
// auf den data-Zweig. Das Repo ist oeffentlich - deshalb steht dort keine
// lesbare Angabe, sondern eine Kennung, die sich nur mit dem Schluessel der
// Person berechnen laesst (HMAC). Ein einfacher Hash ueber Person, Datum,
// Uhrzeit und Kurs liesse sich in Sekunden zurueckrechnen: Alle Zutaten
// stehen im oeffentlichen Repo. Aus demselben Grund nennt das Protokoll im
// Regelbetrieb weder Fach noch Uhrzeit noch, ob Fehlzeiten offen sind.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import 'dotenv/config';
import webpush from 'web-push';
import { BENUTZER } from '../public/shared/konfiguration.mjs';
import { anmeldungenFuer, herkunftVon } from './push-ziele.mjs';
import { eigeneDatenFuer, erinnerungenFuer, offeneEntschuldigungen } from './eigene-daten.mjs';
import { planFuer, paketFuer, codeFuer } from './plan-quelle.mjs';
import { schluesselAus } from './krypto-node.mjs';
import { jetztBerlin, minutenVon, istProbe } from './zeit.mjs';

const OEFFENTLICH = (process.env.VAPID_PUBLIC ?? '').trim();
const PRIVAT = (process.env.VAPID_PRIVATE ?? '').trim();
const KONTAKT = (process.env.VAPID_KONTAKT ?? 'https://stundenplan-jasper.web.app').trim();
if (!OEFFENTLICH || !PRIVAT) {
  console.log('Push nicht konfiguriert - Erinnerungen uebersprungen.');
  process.exit(0);
}
webpush.setVapidDetails(KONTAKT, OEFFENTLICH, PRIVAT);

/** So viele Minuten vor Stundenbeginn darf die Erinnerung fruehestens kommen. */
const VORLAUF_MINUTEN = 15;
/** So lange nach Stundenbeginn wird eine verpasste Erinnerung noch nachgeholt. */
const NACHLAUF_MINUTEN = 10;

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
/**
 * Kennung einer Erinnerung fuer die Gesendet-Liste. "geheim" ist der aus dem
 * Zugangscode abgeleitete Schluessel der Person (PBKDF2) - nicht der Code
 * selbst, sonst liesse sich der Code an der oeffentlichen Liste durchprobieren.
 */
const kennungVon = (geheim, kennung, e) =>
  createHmac('sha256', geheim).update(`erinnerung|${kennung}|${e.datum}|${e.von}|${e.kurs}`).digest('hex').slice(0, 16);

/** Schreibt die Gesendet-Liste - sofort nach jedem Versand, nicht erst am Ende. */
async function vermerken() {
  await mkdir('public/data', { recursive: true });
  await writeFile('public/data/erinnerungen.json', JSON.stringify(gesendet), 'utf8');
}

const { datum: heute, minuten: jetzt } = jetztBerlin();
if (istProbe) console.log('PROBE: Es wird nichts verschickt und nichts vermerkt.');

let faellig = 0;
let ungeprueft = 0;

for (const kennung of Object.keys(BENUTZER)) {
  // Jeder Grund, aus dem eine Person NICHT geprueft werden kann, steht jetzt
  // im Protokoll. Vorher endeten alle diese Wege stumm in "Keine Erinnerung
  // faellig." - nicht zu unterscheiden von "es stand wirklich nichts an".
  const anmeldungen = await anmeldungenFuer(kennung);
  if (!anmeldungen.length) {
    console.log(`${kennung}: kein Geraet angemeldet - nicht geprueft.`);
    ungeprueft++;
    continue;
  }

  const { plan, quelle } = await planFuer(kennung);
  if (!plan) {
    console.log(`${kennung}: kein Plan lesbar - nicht geprueft.`);
    ungeprueft++;
    continue;
  }

  const daten = await eigeneDatenFuer(kennung);
  if (!daten) {
    console.log(`${kennung}: Sicherung nicht lesbar - nicht geprueft.`);
    ungeprueft++;
    continue;
  }

  // Schluessel fuer die Kennungen in der Gesendet-Liste. Die Sicherung war
  // eben lesbar - Code und Paket gibt es also.
  const paket = await paketFuer(kennung);
  const geheim = paket ? schluesselAus(codeFuer(kennung), paket.salz, paket.runden) : null;
  if (!geheim) {
    console.log(`${kennung}: kein Schluessel ableitbar - nicht geprueft.`);
    ungeprueft++;
    continue;
  }

  const heutige = erinnerungenFuer(plan, daten, heute);
  if (istProbe) {
    // Einzelheiten nur im Probe-Lauf (den startet jemand bewusst von Hand).
    const bevor = heutige.map((e) => minutenVon(e.von) - jetzt).filter((abstand) => abstand >= 0);
    console.log(
      `${kennung}: ${anmeldungen.length} Geraet(e), Plan ${quelle}, offene Entschuldigungen: ` +
        `${offeneEntschuldigungen(daten).size ? 'ja' : 'nein'}, heute ${heutige.length} betroffene Stunde(n)` +
        (bevor.length ? `, naechste in ${Math.min(...bevor)} min.` : '.')
    );
  } else {
    // Regelbetrieb: 158-mal am Tag, oeffentlich lesbar - nur, DASS und womit
    // geprueft wurde, nichts ueber Fehlzeiten oder Uhrzeiten.
    console.log(`${kennung}: geprueft (${anmeldungen.length} Geraet(e), Plan ${quelle}, Sicherung lesbar).`);
  }

  for (const e of heutige) {
    const abstand = minutenVon(e.von) - jetzt;
    if (abstand > VORLAUF_MINUTEN || abstand < -NACHLAUF_MINUTEN) continue;
    const schluessel = kennungVon(geheim, kennung, e);
    if (gesendet[schluessel]) continue;
    faellig++;

    if (istProbe) {
      console.log(`${kennung}: PROBE - eine Erinnerung waere jetzt faellig (Abstand ${abstand} min).`);
      continue;
    }

    const wann = abstand < 0 ? 'läuft gerade' : abstand <= 1 ? 'gleich' : `in ${abstand} Minuten`;
    const inhalt = {
      titel: `Entschuldigung nicht vergessen`,
      koerper: `${e.fach} ${wann}${e.lehrer ? ` bei ${e.lehrer}` : ''}${e.block ? ` · ${e.block} Stunde` : ''} – die Entschuldigung ist noch offen.`,
      marke: 'entschuldigung',
      // Eigener Stapel je Stunde: Zwei Erinnerungen am selben Tag sollen
      // einander nicht ersetzen (ab App-Version 27 ausgewertet).
      stapel: `entschuldigung-${e.von}`,
      datum: heute,
    };
    // Verfallszeit: Ist das Handy gerade aus, soll "in 13 Minuten" nicht
    // Stunden spaeter nachkommen. Dringlichkeit hoch = sofort zustellen.
    // Zeitgrenze: Antwortet ein Push-Dienst nicht, haengt sonst das ganze
    // Skript bis zum Limit - und der Vermerk fuer schon zugestellte Geraete
    // ginge verloren (naechster Lauf: dieselbe Erinnerung noch einmal).
    const optionen = { TTL: Math.max(300, (abstand + 15) * 60), urgency: 'high', timeout: 10_000 };

    let angenommen = 0;
    for (const [nr, anmeldung] of anmeldungen.entries()) {
      try {
        await webpush.sendNotification(anmeldung, JSON.stringify(inhalt), optionen);
        angenommen++;
      } catch (fehler) {
        console.error(
          `${kennung} [Geraet ${nr + 1}/${anmeldungen.length}, ${herkunftVon(anmeldung)}]: abgelehnt ` +
            `(${fehler.statusCode ?? String(fehler.message).slice(0, 60)}).`
        );
      }
    }

    // Als gesendet gilt die Erinnerung nur, wenn mindestens ein Geraet sie
    // angenommen hat. Sonst bleibt sie offen, und der naechste Lauf versucht
    // es noch einmal - vorher war sie nach einem Fehlschlag fuer immer weg.
    if (angenommen) {
      gesendet[schluessel] = new Date().toISOString();
      await vermerken();
    }
    console.log(
      `${kennung}: 1 Erinnerung, ${angenommen} von ${anmeldungen.length} Geraet(en) angenommen` +
        (angenommen ? '.' : ' - bleibt offen, der naechste Lauf versucht es erneut.')
    );
  }
}

if (!istProbe) {
  // Alte Eintraege loswerden - zwei Tage reichen, damit nichts doppelt kommt.
  const grenze = new Date(Date.now() - 2 * 86400000).toISOString();
  for (const [k, wann] of Object.entries(gesendet)) if (wann < grenze) delete gesendet[k];
  await vermerken();
}

if (!faellig) {
  console.log(
    ungeprueft
      ? 'Keine Erinnerung verschickt - mindestens eine Person konnte nicht geprueft werden (siehe oben).'
      : 'Keine Erinnerung faellig.'
  );
}
