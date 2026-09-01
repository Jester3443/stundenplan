// Vergleich zweier Planstaende und das Zusammenfuehren von Wochen.
//
// Bewusst eine eigene Datei: Hier wird entschieden, welche Push-Mitteilungen
// rausgehen. Das muss sich ohne Netzzugriff testen lassen
// (siehe scripts/test-vergleich.mjs).
import { isoDatum } from './untis-rest.mjs';

/**
 * Vergleichsschluessel einer Stunde. Bewusst NUR Datum + Startzeit + Kurs:
 * Der Anzeigename eines Termins kann sich aendern, ohne dass sich inhaltlich
 * etwas geaendert hat - dann darf keine falsche Meldung entstehen.
 */
const schluessel = (datum, s) => `${datum}|${s.von}|${s.kurs ?? 'TERMIN'}`;

const zustand = (s) =>
  `${s.status}|${s.lehrer}|${s.raum}|${s.text}|${(s.aufgaben ?? []).map((a) => a.text).join('~')}`;

const aufgabenText = (s) => (s.aufgaben ?? []).map((a) => a.text).join('~');

/**
 * Ordnet alle Stunden ihrem Vergleichsschluessel zu - als LISTE, nicht als
 * Einzelwert. Zu einem Schluessel koennen naemlich mehrere Eintraege
 * gehoeren: Eine Studienwoche steht z. B. dreimal zur selben Zeit im Plan,
 * je einmal pro Raum. Wurde vorher nur der letzte behalten, meldete jeder
 * Lauf aufs Neue einen "Raumwechsel", den es nie gegeben hat.
 *
 * Innerhalb einer Gruppe wird stabil nach Raum sortiert, damit die
 * Zuordnung nicht davon abhaengt, in welcher Reihenfolge der Server liefert.
 */
function nachSchluessel(plan) {
  const gruppen = new Map();
  for (const woche of plan?.wochen ?? []) {
    for (const tag of woche.tage) {
      for (const s of tag.stunden) {
        const key = schluessel(tag.datum, s);
        if (!gruppen.has(key)) gruppen.set(key, []);
        gruppen.get(key).push({ datum: tag.datum, montag: woche.montag, s });
      }
    }
  }
  return gruppen;
}

export function findeAenderungen(alt, neu) {
  const alteGruppen = nachSchluessel(alt);
  if (!alteGruppen.size) return []; // erster Lauf: nichts zu melden
  const neueGruppen = nachSchluessel(neu);

  // Welche Wochen standen im alten Stand ueberhaupt drin? Nur dort kann
  // etwas "neu" sein. Sonst meldete jeder Montag, an dem das Zeitfenster
  // eine Woche weiterrueckt, den kompletten Inhalt dieser Woche als neu.
  const alteWochen = new Set((alt?.wochen ?? []).map((w) => w.montag));

  const aenderungen = [];
  const uebrigAlt = new Map(); // Schluessel -> alte Eintraege ohne Gegenstueck

  for (const [key, neueListe] of neueGruppen) {
    // Erst alles herausnehmen, was unveraendert geblieben ist. Erst danach
    // wird der Rest der Reihe nach verglichen - sonst erzeugt eine einzige
    // echte Aenderung in einer mehrfach belegten Zeit mehrere Meldungen,
    // nur weil sich die Reihenfolge verschoben hat.
    const rest = [...(alteGruppen.get(key) ?? [])];
    const offen = [];
    for (const eintrag of neueListe) {
      const treffer = rest.findIndex((a) => zustand(a.s) === zustand(eintrag.s));
      if (treffer >= 0) rest.splice(treffer, 1);
      else offen.push(eintrag);
    }

    for (let i = 0; i < offen.length; i++) {
      const { datum, montag, s } = offen[i];
      const vorher = rest[i]?.s;

      if (!vorher) {
        if (!alteWochen.has(montag)) continue; // Woche war vorher gar nicht dabei
        aenderungen.push({ art: 'neu', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} neu im Plan` });
        continue;
      }

      if (aufgabenText(vorher) !== aufgabenText(s) && (s.aufgaben ?? []).length) {
        aenderungen.push({ art: 'hausaufgabe', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: neue Hausaufgabe` });
      } else if (vorher.status !== 'CANCELLED' && s.status === 'CANCELLED') {
        aenderungen.push({ art: 'entfall', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} faellt aus` });
      } else if (vorher.status === 'CANCELLED' && s.status !== 'CANCELLED') {
        aenderungen.push({ art: 'zurueck', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} findet doch statt` });
      } else if (vorher.raum !== s.raum) {
        aenderungen.push({ art: 'raum', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: Raum ${vorher.raum || '?'} → ${s.raum || '?'}` });
      } else if (vorher.lehrer !== s.lehrer) {
        aenderungen.push({ art: 'vertretung', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: ${vorher.lehrer || '?'} → ${s.lehrer || 'keine Vertretung'}` });
      } else {
        aenderungen.push({ art: 'hinweis', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName}: ${s.text || 'Änderung im Plan'}` });
      }
    }

    // Was jetzt noch uebrig ist, hat kein Gegenstueck mehr.
    if (rest.length > offen.length) uebrigAlt.set(key, rest.slice(offen.length));
  }

  // Schluessel, die im neuen Stand ueberhaupt nicht mehr vorkommen.
  for (const [key, alteListe] of alteGruppen) {
    if (!neueGruppen.has(key)) uebrigAlt.set(key, alteListe);
  }

  const heute = isoDatum(new Date());
  const neueWochen = new Set((neu?.wochen ?? []).map((w) => w.montag));
  for (const [key, liste] of uebrigAlt) {
    if (key.endsWith('|TERMIN')) continue; // Termine nicht als Wegfall melden
    for (const { datum, montag, s } of liste) {
      if (datum < heute) continue;
      // Was der neue Stand gar nicht abdeckt, kann auch nicht gestrichen sein.
      if (!neueWochen.has(montag)) continue;
      aenderungen.push({ art: 'gestrichen', datum, block: s.block, kurs: s.kurs ?? s.fachName, text: `${s.fachName} steht nicht mehr im Plan` });
    }
  }

  return aenderungen;
}

export const stundenZahl = (woche) => (woche?.tage ?? []).reduce((n, t) => n + t.stunden.length, 0);

/**
 * Termine (Vollversammlung, Studienwoche, Ausflug) bekommen ihren Text nur
 * aus der alten Wochen-Schnittstelle - zwei zusaetzliche Anfragen je Woche.
 * Der Schnell-Lauf holt sie nicht, deshalb wird der Text hier aus dem
 * letzten Stand uebernommen.
 *
 * Ohne das verloere jeder Termin beim Schnell-Lauf seinen Text, und weil
 * der Text in den Zustandsvergleich eingeht, meldete JEDER Wechsel zwischen
 * schnellem und vollem Lauf eine Aenderung, die es nie gab.
 */
export function termintexteUebernehmen(alteWochen, neueWochen) {
  const bekannt = new Map();
  for (const w of alteWochen ?? []) {
    for (const t of w.tage) {
      for (const s of t.stunden) {
        if (s.kurs) continue;
        bekannt.set(`${t.datum}|${s.von}`, { fachName: s.fachName, text: s.text });
      }
    }
  }
  if (!bekannt.size) return neueWochen;

  for (const w of neueWochen) {
    for (const t of w.tage) {
      for (const s of t.stunden) {
        if (s.kurs || s.text) continue;
        const frueher = bekannt.get(`${t.datum}|${s.von}`);
        if (!frueher) continue;
        if (frueher.text) s.text = frueher.text;
        if (frueher.fachName) s.fachName = frueher.fachName;
      }
    }
  }
  return neueWochen;
}

/**
 * Uebernimmt die Lehrer-Hausaufgaben aus dem letzten Stand.
 * Wird gebraucht, wenn der Hausaufgaben-Abruf misslungen ist: Ohne das
 * verloeren alle Stunden ihre Aufgaben, jede einzelne wuerde als Aenderung
 * gemeldet - und beim naechsten geglueckten Lauf noch einmal als "neue
 * Hausaufgabe", obwohl die Aufgabe schon Tage alt ist.
 */
export function aufgabenUebernehmen(alteWochen, neueWochen) {
  const bekannt = new Map();
  for (const w of alteWochen ?? []) {
    for (const t of w.tage) {
      for (const s of t.stunden) {
        if (s.kurs && s.aufgaben?.length) bekannt.set(`${t.datum}|${s.von}|${s.kurs}`, s.aufgaben);
      }
    }
  }
  if (!bekannt.size) return neueWochen;

  for (const w of neueWochen) {
    for (const t of w.tage) {
      for (const s of t.stunden) {
        if (!s.kurs || s.aufgaben?.length) continue;
        const frueher = bekannt.get(`${t.datum}|${s.von}|${s.kurs}`);
        if (frueher) s.aufgaben = frueher;
      }
    }
  }
  return neueWochen;
}

/** Liegt die Schulwoche (Montag bis Freitag) vollstaendig in den Ferien? */
export function ganzInFerien(montag, ferienListe) {
  const freitag = new Date(`${montag}T12:00:00`);
  freitag.setDate(freitag.getDate() + 4);
  const bis = isoDatum(freitag);
  return (ferienListe ?? []).some((f) => f.von <= montag && f.bis >= bis);
}

/**
 * Fuehrt frisch abgerufene Wochen mit dem zuletzt veroeffentlichten Stand
 * zusammen. Das ist aus drei Gruenden noetig:
 *
 *  - Der Schnell-Lauf holt nur zwei Wochen. Ohne Zusammenfuehren wuerde der
 *    veroeffentlichte Plan auf zwei Wochen schrumpfen.
 *  - Der Vergleich fuer die Aenderungsmeldungen liefe dann gegen einen
 *    kuenstlich leeren Plan und meldete fuer JEDE nicht abgerufene Stunde
 *    "steht nicht mehr im Plan" - eine Lawine falscher Mitteilungen.
 *  - Ein einzelner fehlgeschlagener Abruf haette denselben Effekt. Das
 *    konnte auch vorher schon passieren; hier wird es mit erledigt.
 */
export function wochenZusammenfuehren(alteWochen, neueWochen, { ferien = [], von, bis }) {
  const karte = new Map((alteWochen ?? []).map((w) => [w.montag, w]));

  for (const neu of neueWochen) {
    const alt = karte.get(neu.montag);

    // Abruf fehlgeschlagen -> alten Stand behalten.
    if (neu.fehler && alt) {
      console.log(`  Woche ${neu.montag}: Abruf fehlgeschlagen, alter Stand bleibt stehen.`);
      continue;
    }
    // Ploetzlich leer, obwohl vorher Unterricht drinstand, und keine Ferien:
    // das ist fast immer eine Stoerung, kein echter Wegfall.
    if (!neu.fehler && stundenZahl(neu) === 0 && stundenZahl(alt) > 0 && !ganzInFerien(neu.montag, ferien)) {
      console.log(`  Woche ${neu.montag}: unerwartet leer, alter Stand bleibt stehen.`);
      continue;
    }
    karte.set(neu.montag, neu);
  }

  // Aeltere und weiter entfernte Wochen fallen aus dem Fenster - sonst
  // wuechse der Plan mit jedem Lauf.
  return [...karte.values()]
    .filter((w) => w.montag >= von && w.montag <= bis)
    .sort((a, b) => a.montag.localeCompare(b.montag));
}

