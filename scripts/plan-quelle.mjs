// Woher kommt der Plan fuer Erinnerungen und Tagesmeldungen?
//
// Bisher nur aus den Dateien, die sync.mjs im SELBEN Lauf geschrieben hat.
// Scheiterte die Anmeldung bei WebUntis (kommt vor, am 06.11. dreimal
// hintereinander), gab es diese Dateien nicht - und Erinnerung, Tagesmeldung
// und sogar die Suche nach den angemeldeten Geraeten fielen stumm aus.
//
// Jetzt gilt: frisch, wenn vorhanden - sonst der zuletzt veroeffentlichte
// Stand vom data-Zweig (BASIS_DIR). Der ist im Normalbetrieb hoechstens
// zehn Minuten alt (der Schulserver wird alle zehn Minuten gefragt) und fuer
// "welche Stunde beginnt gleich" allemal gut genug. Die Laeufe ohne Abruf
// ("melden") arbeiten immer mit diesem Stand.
import { readFile } from 'node:fs/promises';
import { entschluesseln } from './krypto-node.mjs';

/** Zugangscode je Person - genau wie in sync.mjs. */
export const codeFuer = (kennung) =>
  (process.env[`APP_CODE_${kennung.toUpperCase()}`] ?? (kennung === 'jasper' ? process.env.APP_CODE : '') ?? '').trim();

const basisDir = () => (process.env.BASIS_DIR ?? '').trim();

async function lies(pfad) {
  try {
    return JSON.parse(await readFile(pfad, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Das verschluesselte Paket einer Person (enthaelt Salz und Rundenzahl, aus
 * denen der Schluessel fuer Sicherung und Push-Anmeldungen abgeleitet wird).
 */
export async function paketFuer(kennung) {
  const dir = basisDir();
  return (
    (await lies(`public/data/plan-${kennung}.enc.json`)) ??
    (dir ? await lies(`${dir}/plan-${kennung}.enc.json`) : null)
  );
}

/**
 * Der Plan im Klartext: { plan, quelle }.
 * quelle = 'frisch' (dieser Lauf), 'veroeffentlicht' (data-Zweig) oder 'keine'.
 */
export async function planFuer(kennung) {
  const frisch = await lies(`data/letzter-plan-${kennung}.json`);
  if (frisch) return { plan: frisch, quelle: 'frisch' };

  const code = codeFuer(kennung);
  const dir = basisDir();
  if (code && dir) {
    try {
      const paket = await lies(`${dir}/plan-${kennung}.enc.json`);
      if (paket) return { plan: entschluesseln(paket, code), quelle: 'veroeffentlicht' };
    } catch {
      /* nicht entschluesselbar - wie "kein Plan" */
    }
  }
  return { plan: null, quelle: 'keine' };
}
