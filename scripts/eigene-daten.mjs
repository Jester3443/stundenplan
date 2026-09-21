// Liest die eigenen Daten einer Person (Noten, Fehlzeiten, Aufgaben) aus der
// verschluesselten Cloud-Sicherung - dieselbe, die die App fuer den
// Geraete-Abgleich benutzt.
//
// Gebraucht fuer Erinnerungen, die der Server verschicken soll, obwohl er
// die Daten eigentlich nicht kennt: "Du hast dich bei Frau Gross noch nicht
// entschuldigt, gleich ist Biologie." Der Schluessel wird aus dem Zugangscode
// abgeleitet, genau wie in der App. Inhalte NIE ins Protokoll schreiben -
// das Repo ist oeffentlich.
import { readFile } from 'node:fs/promises';
import { schluesselAus, ablageId, entschluesselnMitSchluessel } from './krypto-node.mjs';

const FIRESTORE =
  'https://firestore.googleapis.com/v1/projects/stundenplan-jasper/databases/(default)/documents';

const codeFuer = (kennung) =>
  (process.env[`APP_CODE_${kennung.toUpperCase()}`] ?? (kennung === 'jasper' ? process.env.APP_CODE : '') ?? '').trim();

/** Die eigenen Daten einer Person - oder null, wenn es keine Sicherung gibt. */
export async function eigeneDatenFuer(kennung) {
  const code = codeFuer(kennung);
  if (!code) return null;
  try {
    const plan = JSON.parse(await readFile(`public/data/plan-${kennung}.enc.json`, 'utf8'));
    const schluessel = schluesselAus(code, plan.salz, plan.runden);
    const antwort = await fetch(`${FIRESTORE}/sicherung/${ablageId(schluessel, '')}`, { cache: 'no-store' });
    if (!antwort.ok) return null;
    const dok = await antwort.json();
    return entschluesselnMitSchluessel(
      { iv: dok.fields.iv.stringValue, daten: dok.fields.daten.stringValue },
      schluessel
    );
  } catch (fehler) {
    console.error(`${kennung}: eigene Daten nicht lesbar (${String(fehler.message).slice(0, 80)})`);
    return null;
  }
}

/** Entschuldigung je Fach - gleiche Regel wie in public/bereiche.mjs. */
export function istEntschuldigt(f, kurs) {
  if (f.entschuldigt === 'ja' && !f.entschuldigtBei) return true;
  return !!f.entschuldigtBei?.[kurs];
}

/** Faecher, bei denen irgendeine Entschuldigung noch aussteht. */
export function offeneEntschuldigungen(daten) {
  const offen = new Set();
  for (const f of daten?.fehlzeiten ?? []) {
    for (const st of f.stunden ?? []) {
      if (st.kurs && !istEntschuldigt(f, st.kurs)) offen.add(st.kurs);
    }
  }
  return offen;
}

/**
 * Die Stunden eines Tages, vor denen eine Erinnerung faellig ist:
 * Unterricht in einem Fach, bei dem noch eine Entschuldigung offen ist.
 * Entfallene Stunden zaehlen nicht - da ist niemand, dem man sie geben koennte.
 */
export function erinnerungenFuer(plan, daten, datum) {
  const offen = offeneEntschuldigungen(daten);
  if (!offen.size) return [];
  const tag = (plan?.wochen ?? []).flatMap((w) => w.tage).find((t) => t.datum === datum);
  if (!tag) return [];
  const gesehen = new Set();
  const raus = [];
  for (const s of tag.stunden) {
    if (!s.kurs || !offen.has(s.kurs) || s.status === 'CANCELLED') continue;
    if (gesehen.has(s.kurs)) continue; // je Fach nur einmal am Tag
    gesehen.add(s.kurs);
    raus.push({
      datum,
      von: s.von,
      kurs: s.kurs,
      fach: s.fachName ?? s.kurs,
      block: s.block ?? '',
      lehrer: s.lehrerLang || s.lehrer || '',
    });
  }
  return raus;
}
