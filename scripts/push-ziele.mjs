// Wohin gehen die Push-Nachrichten einer Person?
//
// Normalfall: Die App traegt jedes Geraet selbst ein - verschluesselt, unter
// einem aus dem Zugangscode abgeleiteten Namen. Damit kommen Mitteilungen
// auch nach einer Neuinstallation weiter an, ohne dass jemand eine
// Anmeldung von Hand kopieren muss.
//
// Rueckfallebene bleiben die Secrets (PUSH_SUBSCRIPTION...), damit ein
// Geraet, das die App noch nicht neu geoeffnet hat, nichts verpasst.
import { readFile } from 'node:fs/promises';
import { schluesselAus, ablageId, entschluesselnMitSchluessel } from './krypto-node.mjs';

const FIRESTORE =
  'https://firestore.googleapis.com/v1/projects/stundenplan-jasper/databases/(default)/documents';

/** Zugangscode je Person - genau wie in sync.mjs. */
const codeFuer = (kennung) =>
  (process.env[`APP_CODE_${kennung.toUpperCase()}`] ?? (kennung === 'jasper' ? process.env.APP_CODE : '') ?? '').trim();

/** Anmeldungen aus den Secrets. */
const ausUmgebung = (kennung) =>
  (
    process.env[`PUSH_SUBSCRIPTION_${kennung.toUpperCase()}`] ??
    (kennung === 'jasper' ? process.env.PUSH_SUBSCRIPTION : '') ??
    ''
  ).trim();

/** Anmeldungen, die die App selbst hinterlegt hat. */
async function ausCloud(kennung) {
  const code = codeFuer(kennung);
  if (!code) return [];
  try {
    const plan = JSON.parse(await readFile(`public/data/plan-${kennung}.enc.json`, 'utf8'));
    const schluessel = schluesselAus(code, plan.salz, plan.runden);
    const antwort = await fetch(`${FIRESTORE}/push/${ablageId(schluessel, 'push')}`, { cache: 'no-store' });
    if (!antwort.ok) return [];
    const dok = await antwort.json();
    const inhalt = entschluesselnMitSchluessel(
      { iv: dok.fields.iv.stringValue, daten: dok.fields.daten.stringValue },
      schluessel
    );
    return (inhalt?.geraete ?? []).map((g) => g.anmeldung).filter((a) => a?.endpoint);
  } catch (fehler) {
    console.error(`${kennung}: hinterlegte Push-Anmeldung nicht lesbar (${String(fehler.message).slice(0, 80)})`);
    return [];
  }
}

/** Alle Geraete einer Person, ohne Doppelte. */
export async function anmeldungenFuer(kennung) {
  const liste = await ausCloud(kennung);
  const secret = ausUmgebung(kennung);
  if (secret) {
    try {
      const gelesen = JSON.parse(secret);
      for (const a of Array.isArray(gelesen) ? gelesen : [gelesen]) {
        if (a?.endpoint && !liste.some((x) => x.endpoint === a.endpoint)) liste.push(a);
      }
    } catch {
      console.error(`${kennung}: PUSH_SUBSCRIPTION ist kein gueltiges JSON.`);
    }
  }
  return liste;
}
