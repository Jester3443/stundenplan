// Tagesmeldungen per Push:
//   morgen    -> Blick auf HEUTE   (6:30 Uhr)
//   aufgaben  -> Hausaufgaben fuer MORGEN (15:40 Uhr, den Text baut die App)
//   abend     -> Blick auf MORGEN  (21:00 Uhr)
//
// Aufruf:
//   node scripts/vorschau.mjs auto     - bei JEDEM Lauf: verschickt, was laut
//                                        Uhrzeit gerade an der Reihe ist
//   node scripts/vorschau.mjs abend    - genau diese Meldung, sofort (von Hand)
//
// WARUM "auto": Frueher entschied der ausloesende Zeitplan-Eintrag, welche
// Meldung lief - ohne Blick auf die Uhr. GitHub lieferte diese Eintraege 4 bis
// 9 Stunden zu spaet: Der Morgenueberblick kam um 13:52 Uhr, die Abendvorschau
// um 2:21 Uhr nachts (und dann fuer den falschen Tag). Jetzt entscheidet
// allein die deutsche Uhrzeit. Ausserhalb ihres Zeitfensters geht eine Meldung
// nie raus - egal wer oder was den Lauf gestartet hat.
//
// Abends wird nur gemeldet, wenn etwas vom Normalplan abweicht oder
// Hausaufgaben anstehen. Morgens kommt immer ein kurzer Ueberblick,
// solange Unterricht ist.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import 'dotenv/config';
import webpush from 'web-push';
import { BENUTZER } from '../public/shared/konfiguration.mjs';
import { anmeldungenFuer, herkunftVon } from './push-ziele.mjs';
import { eigeneDatenFuer, erinnerungenFuer } from './eigene-daten.mjs';
import { planFuer } from './plan-quelle.mjs';
import { jetztBerlin, plusTage, istProbe } from './zeit.mjs';

/**
 * Zeitfenster in deutscher Zeit (Minuten seit Mitternacht) und der Tag, auf
 * den die Meldung blickt (0 = heute, 1 = morgen). Der Beginn ist der
 * gewuenschte Zeitpunkt; das Fenster dahinter faengt Ausfaelle auf (ein
 * gescheiterter Lauf, eine Stoerung bei GitHub). Welcher Wochentag ist, muss
 * hier niemand pruefen: Ohne Unterricht am Zieltag gibt es nichts zu melden.
 */
const ARTEN = {
  morgen: { von: 6 * 60 + 30, bis: 8 * 60 + 30, ziel: 0 },
  aufgaben: { von: 15 * 60 + 40, bis: 19 * 60, ziel: 1 },
  abend: { von: 21 * 60, bis: 22 * 60 + 30, ziel: 1 },
};

const OEFFENTLICH = (process.env.VAPID_PUBLIC ?? '').trim();
const PRIVAT = (process.env.VAPID_PRIVATE ?? '').trim();
const KONTAKT = (process.env.VAPID_KONTAKT ?? 'https://stundenplan-jasper.web.app').trim();

if (!OEFFENTLICH || !PRIVAT) {
  console.log('Push nicht konfiguriert - uebersprungen.');
  process.exit(0);
}
webpush.setVapidDetails(KONTAKT, OEFFENTLICH, PRIVAT);

const { datum: heute, minuten: jetzt } = jetztBerlin();
if (istProbe) console.log('PROBE: Es wird nichts verschickt und nichts vermerkt.');

// Von Hand verlangt (Argument oder Eingabe "aufgabe" beim Handstart)?
// Dann gilt das Zeitfenster nicht.
const argument = process.argv[2] ?? 'auto';
const erzwungen = [argument, (process.env.ERZWINGEN ?? '').trim()].filter((a) => a in ARTEN);
const dran = Object.keys(ARTEN).filter(
  (art) => erzwungen.includes(art) || (argument === 'auto' && jetzt >= ARTEN[art].von && jetzt <= ARTEN[art].bis)
);
if (!dran.length) {
  console.log('Tagesmeldungen: gerade keine an der Reihe.');
  process.exit(0);
}

// Jede Tagesmeldung hoechstens EINMAL - je Person und je Zieltag. Der Vermerk
// wandert mit auf den data-Zweig; der naechste Lauf liest ihn von dort. Weil
// immer nur ein Abruf gleichzeitig laeuft (Concurrency-Gruppe in sync.yml),
// kann auch ein zweiter Ausloeser (Wache, Handstart) nichts doppelt senden.
const basisDir = (process.env.BASIS_DIR ?? '').trim();
let meldungen = {};
for (const pfad of [basisDir && `${basisDir}/meldungen.json`, 'public/data/meldungen.json'].filter(Boolean)) {
  try {
    meldungen = JSON.parse(await readFile(pfad, 'utf8'));
    break;
  } catch {
    /* noch nichts vermerkt */
  }
}

/** Baut die Nachricht fuer eine Person - oder null, wenn es nichts zu melden gibt. */
async function nachrichtFuer(art, kennung, plan, zieldatum) {
  let tag = null;
  for (const woche of plan.wochen ?? []) {
    const treffer = woche.tage.find((t) => t.datum === zieldatum);
    if (treffer) tag = treffer;
  }
  if (!tag || !tag.stunden.length) return null;

  // Aufgaben-Erinnerung: Der Server kennt die Aufgaben nicht (sie liegen
  // verschluesselt auf dem Geraet). Er stoesst nur an - den Text baut die
  // App selbst. Gesendet wird nur, wenn morgen ueberhaupt Unterricht ist.
  // Der Text hier ist der Ersatz, falls die App ihre Daten nicht lesen kann.
  if (art === 'aufgaben') {
    if (!tag.stunden.some((s) => s.kurs && s.status !== 'CANCELLED')) return null;
    return { titel: 'Hausaufgaben', koerper: 'Schau kurz in die App, was für morgen ansteht.', marke: 'aufgaben', datum: zieldatum };
  }

  const stunden = [...tag.stunden].filter((s) => s.kurs).sort((a, b) => a.von.localeCompare(b.von));
  const entfallen = stunden.filter((s) => s.status === 'CANCELLED');
  const gueltig = stunden.filter((s) => s.status !== 'CANCELLED');

  const hausaufgaben = stunden
    .flatMap((s) => (s.aufgaben ?? []).map((a) => ({ fach: s.fachName, text: a.text || a.anmerkung })))
    .filter((h) => h.text);

  const zeilen = [];
  let titel = null;

  if (!gueltig.length) {
    titel = art === 'morgen' ? 'Heute schulfrei 🎉' : 'Morgen fällt alles aus 🎉';
  } else {
    const geplantStart = stunden[0];
    const geplantEnde = stunden[stunden.length - 1];
    const echtStart = gueltig[0];
    const echtEnde = gueltig[gueltig.length - 1];
    const spaeterHin = echtStart.von > geplantStart.von;
    const frueherWeg = echtEnde.bis < geplantEnde.bis;

    if (art === 'morgen') {
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

  // Morgens dazu: bei wem heute noch eine Entschuldigung abzugeben ist.
  if (art === 'morgen') {
    const daten = await eigeneDatenFuer(kennung);
    const offen = erinnerungenFuer(plan, daten, zieldatum);
    if (offen.length) {
      zeilen.push(`Noch entschuldigen: ${offen.map((e) => `${e.fach}${e.block ? ` (${e.block})` : ''}`).join(', ')}`);
      titel ??= offen.length === 1 ? 'Heute eine Entschuldigung abgeben' : `Heute ${offen.length} Entschuldigungen abgeben`;
    }
  }

  // Abends nur melden, wenn es wirklich etwas zu sagen gibt.
  if (!titel && !hausaufgaben.length) return null;
  titel ??= hausaufgaben.length === 1 ? 'Eine Hausaufgabe für morgen' : `${hausaufgaben.length} Hausaufgaben für morgen`;

  // marke + datum braucht die App, um die eigenen Aufgaben anzuhaengen.
  return { titel, koerper: zeilen.join('\n'), marke: art === 'morgen' ? 'morgen' : 'abendblick', datum: zieldatum };
}

for (const art of dran) {
  const zieldatum = plusTage(heute, ARTEN[art].ziel);
  const zwang = erzwungen.includes(art);

  // Vermerk aus der Zeit vor dieser Fassung: { abend: '<Sendetag>' }.
  if (!zwang && meldungen[art] === heute) {
    console.log(`${art}: heute schon verschickt - kein zweites Mal.`);
    continue;
  }

  for (const kennung of Object.keys(BENUTZER)) {
    const marke = `${art}|${kennung}`;
    if (!zwang && meldungen[marke] === zieldatum) {
      console.log(`${art} (${kennung}): schon verschickt - kein zweites Mal.`);
      continue;
    }

    const anmeldungen = await anmeldungenFuer(kennung);
    if (!anmeldungen.length) {
      console.log(`${art} (${kennung}): kein Geraet angemeldet.`);
      continue;
    }
    const { plan, quelle } = await planFuer(kennung);
    if (!plan) {
      console.log(`${art} (${kennung}): kein Plan lesbar.`);
      continue;
    }

    const inhalt = await nachrichtFuer(art, kennung, plan, zieldatum);
    if (!inhalt) {
      console.log(`${art} (${kennung}): nichts zu melden (Plan ${quelle}).`);
      continue;
    }
    if (istProbe) {
      console.log(`${art} (${kennung}): PROBE - wuerde jetzt an ${anmeldungen.length} Geraet(e) gehen (Plan ${quelle}).`);
      continue;
    }

    // Nach drei Stunden ist die Meldung ueberholt - dann lieber gar nicht mehr
    // zustellen. Zeitgrenze, damit ein stummer Push-Dienst das Skript nicht
    // bis zum Limit aufhaelt (dann ginge der Vermerk verloren).
    const optionen = { TTL: 3 * 3600, urgency: 'high', timeout: 10_000 };
    let angenommen = 0;
    for (const [nr, anmeldung] of anmeldungen.entries()) {
      try {
        await webpush.sendNotification(anmeldung, JSON.stringify(inhalt), optionen);
        angenommen++;
      } catch (fehler) {
        console.error(
          `${art} (${kennung}) [Geraet ${nr + 1}/${anmeldungen.length}, ${herkunftVon(anmeldung)}]: abgelehnt ` +
            `(${fehler.statusCode ?? String(fehler.message).slice(0, 60)}).`
        );
      }
    }

    // Vermerkt wird nur, was mindestens ein Geraet angenommen hat - sonst
    // versucht es der naechste Lauf im Zeitfenster noch einmal. Der Vermerk
    // wird sofort geschrieben, nicht erst am Ende des Skripts.
    if (angenommen) {
      meldungen[marke] = zieldatum;
      await mkdir('public/data', { recursive: true });
      await writeFile('public/data/meldungen.json', JSON.stringify(meldungen), 'utf8');
    }
    console.log(`${art} (${kennung}): ${angenommen} von ${anmeldungen.length} Geraet(en) angenommen.`);
  }
}
