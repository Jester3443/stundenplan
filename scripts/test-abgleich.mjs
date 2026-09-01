// Prueft die Zusammenfuehrung zweier Geraetestaende (Handy <-> iPad).
import { LEER, verschmelze, stempeln, fingerabdruck } from '../public/daten.mjs';

let fehler = 0;
const pruefe = (name, bedingung, zusatz = '') => {
  console.log(`${bedingung ? '  ok  ' : ' FEHL '} ${name}${zusatz ? ' - ' + zusatz : ''}`);
  if (!bedingung) fehler++;
};

const mitZeit = (daten, pfade) => {
  daten.stand = { ...daten.stand, ...pfade };
  return daten;
};
const P = (...teile) => teile.join('');

// --- 1. Beide Seiten haben eigene Eintraege: nichts darf verschwinden.
const handy = LEER();
handy.fehlzeiten.push({ id: 'a1', datum: '2026-08-28', grund: 'krank', stunden: [] });
mitZeit(handy, { [P('fehlzeiten', 'a1')]: '2026-08-28T10:00:00.000Z' });

const ipad = LEER();
ipad.fehlzeiten.push({ id: 'b1', datum: '2026-08-31', grund: 'Arzt', stunden: [] });
mitZeit(ipad, { [P('fehlzeiten', 'b1')]: '2026-08-31T09:00:00.000Z' });

const zusammen = verschmelze(handy, ipad);
pruefe('Beide Fehlzeiten bleiben erhalten', zusammen.fehlzeiten.length === 2,
  zusammen.fehlzeiten.map((f) => f.id).join(','));
pruefe('Neueste zuerst sortiert', zusammen.fehlzeiten[0].id === 'b1');

// --- 2. Symmetrie: Reihenfolge der Zusammenfuehrung darf nichts aendern.
const andersherum = verschmelze(ipad, handy);
pruefe('Reihenfolge egal', fingerabdruck(zusammen) === fingerabdruck(andersherum));

// --- 3. Loeschen gewinnt gegen einen aelteren Stand ...
const geloescht = LEER();
geloescht.geloescht = { [P('fehlzeiten', 'a1')]: '2026-08-29T10:00:00.000Z' };
const nachLoeschen = verschmelze(geloescht, handy);
pruefe('Geloeschter Eintrag kommt nicht zurueck', nachLoeschen.fehlzeiten.length === 0);
pruefe('Loeschvermerk bleibt erhalten', !!nachLoeschen.geloescht[P('fehlzeiten', 'a1')]);

// --- 4. ... aber eine NEUERE Bearbeitung gewinnt gegen ein aelteres Loeschen.
const spaeterBearbeitet = LEER();
spaeterBearbeitet.fehlzeiten.push({ id: 'a1', datum: '2026-08-28', grund: 'entschuldigt', stunden: [] });
mitZeit(spaeterBearbeitet, { [P('fehlzeiten', 'a1')]: '2026-08-30T10:00:00.000Z' });
const konflikt = verschmelze(geloescht, spaeterBearbeitet);
pruefe('Neuere Bearbeitung schlaegt aelteres Loeschen', konflikt.fehlzeiten.length === 1
  && konflikt.fehlzeiten[0].grund === 'entschuldigt');

// --- 5. Altbestand ohne Zeitstempel darf nie verschwinden.
const altA = LEER();
altA.noten.DE1 = [{ id: 'n1', punkte: 12, datum: '2026-08-20' }];
const altB = LEER();
altB.noten.DE1 = [{ id: 'n2', punkte: 9, datum: '2026-08-25' }];
const alt = verschmelze(altA, altB);
pruefe('Noten ohne Zeitstempel bleiben beide', (alt.noten.DE1 ?? []).length === 2);
pruefe('Noten absteigend nach Datum', alt.noten.DE1[0].id === 'n2');

// --- 6. Zaehltage werden vereinigt, nicht ueberschrieben.
const zaehlA = LEER();
zaehlA.gezaehlteTage = { '2026-08-24': true, '2026-08-25': true };
zaehlA.tagesStunden = { '2026-08-24': { DE1: 2 }, '2026-08-25': { ma2: 2 } };
const zaehlB = LEER();
zaehlB.gezaehlteTage = { '2026-08-26': true };
zaehlB.tagesStunden = { '2026-08-26': { DE1: 2 } };
const zaehl = verschmelze(zaehlA, zaehlB);
pruefe('Alle Zaehltage vereinigt', Object.keys(zaehl.gezaehlteTage).length === 3);
const summeDE1 = Object.values(zaehl.tagesStunden).reduce((s, t) => s + (t.DE1 ?? 0), 0);
pruefe('Stunden je Fach korrekt summiert', summeDE1 === 4, `DE1 = ${summeDE1}`);

// --- 7. stempeln() erkennt Aenderung und Loeschung ohne Zutun der Eingabemaske.
const lauf = LEER();
lauf.aufgaben.push({ id: 'x1', kurs: 'DE1', faellig: '2026-09-03', text: 'Lesen', erledigt: false });
stempeln(lauf); // erster Lauf: alles bekommt einen Zeitstempel
const ersterStempel = lauf.stand[P('aufgaben', 'x1')];
pruefe('Neuer Eintrag bekommt Zeitstempel', !!ersterStempel);

lauf.aufgaben[0].erledigt = true;
stempeln(lauf);
pruefe('Aenderung aktualisiert den Zeitstempel', lauf.stand[P('aufgaben', 'x1')] >= ersterStempel);

lauf.aufgaben = [];
stempeln(lauf);
pruefe('Loeschung erzeugt Loeschvermerk', !!lauf.geloescht[P('aufgaben', 'x1')]);
pruefe('Loeschung entfernt den Aenderungsvermerk', !lauf.stand[P('aufgaben', 'x1')]);

// --- 8. Zweimal verschmelzen darf nichts veraendern (Ruhepunkt).
const einmal = verschmelze(handy, ipad);
const zweimal = verschmelze(einmal, ipad);
pruefe('Wiederholter Abgleich bleibt stabil', fingerabdruck(einmal) === fingerabdruck(zweimal));

// --- 9. Notiz-Kennungen enthalten selbst "|" - der Pfad darf nicht zerbrechen.
const notizA = LEER();
notizA.notizen['2026-09-01|08:00|DE1'] = { aufgabe: 'S. 42', erledigt: false };
const notizB = LEER();
notizB.notizen['2026-09-01|09:50|GE1'] = { aufgabe: 'Text lesen', erledigt: false };
const notizen = verschmelze(notizA, notizB);
pruefe('Beide Notizen bleiben mit korrektem Schluessel', Object.keys(notizen.notizen).length === 2
  && notizen.notizen['2026-09-01|08:00|DE1']?.aufgabe === 'S. 42');

console.log(fehler === 0 ? '\nAlle Pruefungen bestanden.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
