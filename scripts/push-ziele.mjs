// Wohin gehen die Push-Nachrichten einer Person?
//
// Normalfall: Die App traegt jedes Geraet selbst ein - verschluesselt, unter
// einem aus dem Zugangscode abgeleiteten Namen. Damit kommen Mitteilungen
// auch nach einer Neuinstallation weiter an, ohne dass jemand eine
// Anmeldung von Hand kopieren muss.
//
// Rueckfallebene bleiben die Secrets (PUSH_SUBSCRIPTION...), damit ein
// Geraet, das die App noch nicht neu geoeffnet hat, nichts verpasst.
// Beide Quellen werden bewusst weiter zusammengelegt: Das iPhone steht in
// beiden - faellt es aus der App-Liste (z. B. weil ein anderes Geraet sie
// ueberschrieben hat), erreicht es die Nachricht immer noch ueber das Secret.
import { schluesselAus, ablageId, entschluesselnMitSchluessel } from './krypto-node.mjs';
import { paketFuer, codeFuer } from './plan-quelle.mjs';

const FIRESTORE =
  'https://firestore.googleapis.com/v1/projects/stundenplan-jasper/databases/(default)/documents';

/**
 * Merkt sich je Anmeldung, woher sie stammt ('App' oder 'Secret') - nur fuer
 * das Protokoll. Dort stand bisher bloss "410", ohne dass erkennbar war,
 * dass es die veraltete Adresse aus dem Secret ist und nicht das iPhone.
 */
const HERKUNFT = new WeakMap();
export const herkunftVon = (anmeldung) => HERKUNFT.get(anmeldung) ?? '?';

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
    // Salz und Rundenzahl stehen im verschluesselten Plan - frisch aus diesem
    // Lauf oder, wenn der Abruf bei WebUntis gescheitert ist, vom data-Zweig.
    const plan = await paketFuer(kennung);
    if (!plan) return [];
    const schluessel = schluesselAus(code, plan.salz, plan.runden);
    const antwort = await fetch(`${FIRESTORE}/push/${ablageId(schluessel, 'push')}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
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
  for (const a of liste) HERKUNFT.set(a, 'App');

  const secret = ausUmgebung(kennung);
  if (secret) {
    try {
      const gelesen = JSON.parse(secret);
      for (const a of Array.isArray(gelesen) ? gelesen : [gelesen]) {
        if (a?.endpoint && !liste.some((x) => x.endpoint === a.endpoint)) {
          HERKUNFT.set(a, 'Secret');
          liste.push(a);
        }
      }
    } catch {
      console.error(`${kennung}: PUSH_SUBSCRIPTION ist kein gueltiges JSON.`);
    }
  }
  return liste;
}
