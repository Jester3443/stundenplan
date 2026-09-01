// Prueft die Logik, die entscheidet, welche Push-Mitteilungen rausgehen.
// Laeuft ohne Netz und ohne Untis-Zugang.
import {
  findeAenderungen,
  wochenZusammenfuehren,
  termintexteUebernehmen,
  ganzInFerien,
} from './vergleich.mjs';
import { isoDatum } from './untis-rest.mjs';

let fehler = 0;
const pruefe = (name, ok, zusatz = '') => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${name}${zusatz ? ' - ' + zusatz : ''}`);
  if (!ok) fehler++;
};

/** Datum relativ zu heute, damit der Test nicht mit der Zeit veraltet. */
const T = (versatz) => {
  const d = new Date();
  d.setDate(d.getDate() + versatz);
  return isoDatum(d);
};
/** Montag relativ zur laufenden Woche. */
const M = (wochenVersatz) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + wochenVersatz * 7);
  return isoDatum(d);
};

const stunde = (o = {}) => ({
  von: '08:00', bis: '09:25', block: '1./2.', status: 'REGULAR',
  lehrer: 'wil', raum: 'A101', kurs: 'DE1', fachName: 'Deutsch', text: '', ...o,
});
const tag = (datum, stunden) => ({ datum, wochentag: 'Montag', status: 'REGULAR', hinweise: [], stunden });
const woche = (montag, tage, extra = {}) => ({
  montag, typ: 'A', fehler: null,
  veroeffentlicht: tage.some((t) => t.stunden.length > 0), tage, ...extra,
});
const plan = (...wochen) => ({ wochen });

const arten = (liste) => liste.map((a) => a.art).sort().join(',');

console.log('--- Aenderungserkennung ---');

// 1. Nichts veraendert
{
  const p = () => plan(woche(M(0), [tag(T(1), [stunde()])]));
  pruefe('Unveraenderter Plan meldet nichts', findeAenderungen(p(), p()).length === 0);
}

// 2. DER KERNFEHLER: Ein Termin steht mehrfach zur selben Zeit im Plan,
//    je einmal pro Raum. Das darf keine Raumwechsel-Meldung ausloesen.
{
  const dreiRaeume = (reihenfolge) => plan(woche(M(0), [tag(T(1), reihenfolge.map((raum) =>
    stunde({ kurs: null, fachName: 'Studienwoche 12', lehrer: '', raum })))]));
  const alt = dreiRaeume(['S228', 'S230', 'S231']);
  const neu = dreiRaeume(['S228', 'S230', 'S231']);
  pruefe('Termin in drei Raeumen meldet keinen Raumwechsel',
    findeAenderungen(alt, neu).length === 0, JSON.stringify(findeAenderungen(alt, neu).map((a) => a.text)));

  // ... auch dann nicht, wenn der Server sie in anderer Reihenfolge liefert.
  const gedreht = dreiRaeume(['S231', 'S228', 'S230']);
  pruefe('Andere Reihenfolge vom Server aendert nichts',
    findeAenderungen(alt, gedreht).length === 0,
    JSON.stringify(findeAenderungen(alt, gedreht).map((a) => a.text)));
}

// 3. Echter Raumwechsel wird weiterhin gemeldet
{
  const alt = plan(woche(M(0), [tag(T(1), [stunde({ raum: 'A101' })])]));
  const neu = plan(woche(M(0), [tag(T(1), [stunde({ raum: 'B202' })])]));
  const a = findeAenderungen(alt, neu);
  pruefe('Echter Raumwechsel wird gemeldet', arten(a) === 'raum', a[0]?.text);
}

// 4./5./6./7. Die uebrigen Meldungsarten
{
  const basis = (o) => plan(woche(M(0), [tag(T(1), [stunde(o)])]));
  pruefe('Entfall wird gemeldet',
    arten(findeAenderungen(basis({}), basis({ status: 'CANCELLED' }))) === 'entfall');
  pruefe('Rueckkehr wird gemeldet',
    arten(findeAenderungen(basis({ status: 'CANCELLED' }), basis({}))) === 'zurueck');
  pruefe('Vertretung wird gemeldet',
    arten(findeAenderungen(basis({}), basis({ lehrer: 'seg' }))) === 'vertretung');
  pruefe('Neue Hausaufgabe wird gemeldet',
    arten(findeAenderungen(basis({}), basis({ aufgaben: [{ text: 'S. 42' }] }))) === 'hausaufgabe');
}

// 8./9./10. Wegfall - nur in der Zukunft und nur fuer echten Unterricht
{
  const mit = (datum) => plan(woche(M(0), [tag(datum, [stunde()])]));
  const ohne = (datum) => plan(woche(M(0), [tag(datum, [])]));
  pruefe('Wegfall in der Zukunft wird gemeldet',
    arten(findeAenderungen(mit(T(2)), ohne(T(2)))) === 'gestrichen');
  pruefe('Wegfall in der Vergangenheit wird NICHT gemeldet',
    findeAenderungen(mit(T(-3)), ohne(T(-3))).length === 0);

  const terminMit = plan(woche(M(0), [tag(T(2), [stunde({ kurs: null, fachName: 'Ausflug' })])]));
  pruefe('Wegfall eines Termins wird nicht als Ausfall gemeldet',
    findeAenderungen(terminMit, ohne(T(2))).length === 0);
}

// 11. Erster Lauf
{
  pruefe('Erster Lauf meldet nichts',
    findeAenderungen(null, plan(woche(M(0), [tag(T(1), [stunde()])]))).length === 0);
}

console.log('\n--- Wochen zusammenfuehren ---');

const fenster = { von: M(-2), bis: M(3), ferien: [] };
const vollerAltbestand = [-2, -1, 0, 1, 2, 3].map((i) => woche(M(i), [tag(T(i * 7), [stunde()])]));

// 12. Schnell-Lauf: nur zwei Wochen geholt, trotzdem sechs im Ergebnis
{
  const frisch = [0, 1].map((i) => woche(M(i), [tag(T(i * 7), [stunde({ raum: 'NEU' })])]));
  const zusammen = wochenZusammenfuehren(vollerAltbestand, frisch, fenster);
  pruefe('Schnell-Lauf behaelt alle sechs Wochen', zusammen.length === 6, `${zusammen.length} Wochen`);
  pruefe('Frisch geholte Wochen sind uebernommen',
    zusammen.find((w) => w.montag === M(0)).tage[0].stunden[0].raum === 'NEU');
  pruefe('Nicht geholte Wochen sind unveraendert',
    zusammen.find((w) => w.montag === M(2)).tage[0].stunden[0].raum === 'A101');
  pruefe('Wochen sind aufsteigend sortiert',
    zusammen.map((w) => w.montag).join() === [...zusammen.map((w) => w.montag)].sort().join());
}

// 13. DER ENTSCHEIDENDE FALL: Der Schnell-Lauf darf keine Wegfall-Lawine ausloesen.
{
  const alt = { wochen: vollerAltbestand };
  const frisch = [0, 1].map((i) => woche(M(i), [tag(T(i * 7), [stunde()])]));
  const neu = { wochen: wochenZusammenfuehren(vollerAltbestand, frisch, fenster) };
  const a = findeAenderungen(alt, neu);
  pruefe('Schnell-Lauf loest KEINE falschen Wegfall-Meldungen aus', a.length === 0,
    a.map((x) => `${x.art}:${x.text}`).join(' | '));

  // Zweite Verteidigungslinie: Selbst OHNE Zusammenfuehren duerfte es keine
  // Wegfall-Meldungen geben, weil der neue Stand diese Wochen gar nicht
  // abdeckt. Beide Schutzmechanismen wirken unabhaengig voneinander.
  const ohneZusammenfuehren = findeAenderungen(alt, { wochen: frisch });
  pruefe('Auch ohne Zusammenfuehren keine Wegfall-Meldung (Fenster-Schranke)',
    ohneZusammenfuehren.length === 0,
    ohneZusammenfuehren.map((x) => `${x.art}:${x.text}`).join(' | '));

  // Der eigentliche Schaden ohne Zusammenfuehren waere ein geschrumpfter Plan.
  pruefe('Gegenprobe: ohne Zusammenfuehren haette der Plan nur zwei Wochen',
    frisch.length === 2 && neu.wochen.length === 6);
}

// 13b. Eine echt gestrichene Stunde INNERHALB der abgerufenen Wochen wird
//      weiterhin gemeldet - die Fenster-Schranke darf nicht zu viel schlucken.
{
  const alt = { wochen: [woche(M(0), [tag(T(1), [stunde(), stunde({ von: '09:50', kurs: 'ma2', fachName: 'Mathematik' })])])] };
  const neu = { wochen: [woche(M(0), [tag(T(1), [stunde()])])] };
  const a = findeAenderungen(alt, neu);
  pruefe('Echter Wegfall in einer abgerufenen Woche wird gemeldet',
    arten(a) === 'gestrichen', a[0]?.text);
}

// 13c. Eine wirklich neue Stunde in einer bekannten Woche wird gemeldet.
{
  const alt = { wochen: [woche(M(0), [tag(T(1), [stunde()])])] };
  const neu = { wochen: [woche(M(0), [tag(T(1), [stunde(), stunde({ von: '09:50', kurs: 'ma2', fachName: 'Mathematik' })])])] };
  pruefe('Echte neue Stunde in bekannter Woche wird gemeldet',
    arten(findeAenderungen(alt, neu)) === 'neu');
}

// 13d. Rueckt das Zeitfenster eine Woche weiter, ist der Inhalt der neu
//      hinzugekommenen Woche NICHT "neu im Plan".
{
  const alt = { wochen: [-2, -1, 0, 1, 2].map((i) => woche(M(i), [tag(T(i * 7), [stunde()])])) };
  const neu = { wochen: [-1, 0, 1, 2, 3].map((i) => woche(M(i), [tag(T(i * 7), [stunde()])])) };
  const a = findeAenderungen(alt, neu);
  pruefe('Weitergerueckte Woche loest keine "neu im Plan"-Lawine aus',
    a.length === 0, a.map((x) => `${x.art}:${x.text}`).join(' | '));
}

// 13e. Mehrfach belegte Zeit: EINE echte Aenderung darf nur EINE Meldung geben.
{
  const raeume = (liste) => ({ wochen: [woche(M(0), [tag(T(1), liste.map((raum) =>
    stunde({ kurs: null, fachName: 'Studienwoche 12', lehrer: '', raum })))])] });
  const a = findeAenderungen(raeume(['S228', 'S230', 'S231']), raeume(['S228', 'S230', 'S999']));
  pruefe('Ein Raumwechsel unter dreien erzeugt genau eine Meldung',
    a.length === 1, a.map((x) => x.text).join(' | '));

  // Auch wenn der geaenderte Raum alphabetisch nach vorne rutscht.
  const b = findeAenderungen(raeume(['S228', 'S230', 'S231']), raeume(['A001', 'S230', 'S231']));
  pruefe('... auch wenn der neue Raum die Sortierung umdreht',
    b.length === 1, b.map((x) => x.text).join(' | '));
}

// 14. Fehlgeschlagener Abruf einer Woche
{
  const kaputt = [woche(M(1), [], { fehler: 'Zeitueberschreitung' })];
  const zusammen = wochenZusammenfuehren(vollerAltbestand, kaputt, fenster);
  pruefe('Fehlgeschlagener Abruf behaelt den alten Stand',
    zusammen.find((w) => w.montag === M(1)).tage[0].stunden.length === 1);
}

// 15./16. Unerwartet leere Woche
{
  const leer = [woche(M(1), [tag(T(7), [])])];
  const ohneFerien = wochenZusammenfuehren(vollerAltbestand, leer, fenster);
  pruefe('Unerwartet leere Woche behaelt den alten Stand',
    ohneFerien.find((w) => w.montag === M(1)).tage[0].stunden.length === 1);

  const mitFerien = wochenZusammenfuehren(vollerAltbestand, leer,
    { ...fenster, ferien: [{ name: 'Herbstferien', von: M(1), bis: T(20) }] });
  pruefe('In den Ferien wird die leere Woche uebernommen',
    mitFerien.find((w) => w.montag === M(1)).tage[0].stunden.length === 0);
}

// 17. Fenster
{
  const zuAlt = [woche(M(-5), [tag(T(-35), [stunde()])])];
  const zusammen = wochenZusammenfuehren([...vollerAltbestand, ...zuAlt], [], fenster);
  pruefe('Wochen ausserhalb des Fensters fallen weg',
    !zusammen.some((w) => w.montag === M(-5)) && zusammen.length === 6);
}

// 18. Ferienerkennung
{
  pruefe('Ferienwoche wird erkannt',
    ganzInFerien(M(0), [{ von: M(0), bis: T(30) }]) === true);
  pruefe('Teilweise Ferien zaehlen nicht als Ferienwoche',
    ganzInFerien(M(0), [{ von: M(0), bis: M(0) }]) === false);
}

console.log('\n--- Termintexte im Schnell-Lauf ---');

// 19. Der Schnell-Lauf holt keine Termintexte. Ohne Uebernahme aus dem
//     letzten Stand meldete jeder Wechsel schnell/voll eine Aenderung.
{
  const mitText = [woche(M(0), [tag(T(1), [
    stunde({ kurs: null, fachName: 'Studienwoche 12', lehrer: '', text: 'Projektarbeit im Kurs' }),
  ])])];
  const ohneText = [woche(M(0), [tag(T(1), [
    stunde({ kurs: null, fachName: 'Termin', lehrer: '', text: '' }),
  ])])];

  const ohneUebernahme = findeAenderungen({ wochen: mitText }, { wochen: JSON.parse(JSON.stringify(ohneText)) });
  pruefe('Gegenprobe: ohne Uebernahme gaebe es eine Falschmeldung',
    ohneUebernahme.length === 1, ohneUebernahme[0]?.text);

  const frisch = JSON.parse(JSON.stringify(ohneText));
  termintexteUebernehmen(mitText, frisch);
  pruefe('Termintext wird uebernommen',
    frisch[0].tage[0].stunden[0].text === 'Projektarbeit im Kurs'
      && frisch[0].tage[0].stunden[0].fachName === 'Studienwoche 12');
  pruefe('Nach der Uebernahme keine Falschmeldung mehr',
    findeAenderungen({ wochen: mitText }, { wochen: frisch }).length === 0);
}

// 20. Ein frischer Text darf NICHT vom alten ueberschrieben werden.
{
  const alt = [woche(M(0), [tag(T(1), [stunde({ kurs: null, fachName: 'Termin', lehrer: '', text: 'alter Text' })])])];
  const neu = [woche(M(0), [tag(T(1), [stunde({ kurs: null, fachName: 'Termin', lehrer: '', text: 'neuer Text' })])])];
  termintexteUebernehmen(alt, neu);
  pruefe('Ein frisch gelieferter Text bleibt erhalten',
    neu[0].tage[0].stunden[0].text === 'neuer Text');
}

// 21. Echter Unterricht wird von der Uebernahme nicht angefasst.
{
  const alt = [woche(M(0), [tag(T(1), [stunde({ text: 'Klausurhinweis' })])])];
  const neu = [woche(M(0), [tag(T(1), [stunde({ text: '' })])])];
  termintexteUebernehmen(alt, neu);
  pruefe('Text einer normalen Stunde wird nicht uebernommen',
    neu[0].tage[0].stunden[0].text === '');
}

// 22. Voller Lauf direkt nach einem Schnell-Lauf: keine Doppelmeldung.
{
  const stand = [-2, -1, 0, 1, 2, 3].map((i) => woche(M(i), [tag(T(i * 7), [stunde()])]));
  const nachSchnell = wochenZusammenfuehren(stand, [0, 1].map((i) => woche(M(i), [tag(T(i * 7), [stunde()])])), fenster);
  const nachVoll = wochenZusammenfuehren(nachSchnell, stand.map((w) => JSON.parse(JSON.stringify(w))), fenster);
  pruefe('Voller Lauf nach Schnell-Lauf meldet nichts',
    findeAenderungen({ wochen: nachSchnell }, { wochen: nachVoll }).length === 0,
    findeAenderungen({ wochen: nachSchnell }, { wochen: nachVoll }).map((a) => a.text).join(' | '));
}

console.log(fehler === 0 ? '\nAlle Pruefungen bestanden.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
