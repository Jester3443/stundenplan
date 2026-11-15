// Prueft die Zeitrechnung des Taktgebers - ohne Netz, ohne GitHub.
// Hier entscheidet sich, wann der Schulserver abgefragt wird und ob die
// Erinnerung rechtzeitig vor der Stunde rausgeht.
import { berlin, aufgabeUm, naechsterTermin, nachzuholen, uhr } from './takt.mjs';

let fehler = 0;
const pruefe = (name, ok, zusatz = '') => {
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${name}${zusatz ? ' - ' + zusatz : ''}`);
  if (!ok) fehler++;
};

/** Zeitpunkt aus UTC-Angaben. */
const utc = (j, m, t, hh, mm) => Date.UTC(j, m - 1, t, hh, mm);
const um = (ms, ferien, probe) => aufgabeUm(berlin(ms), ferien, probe);

/** Alle Anstoesse eines deutschen Kalendertags: ['06:02 voll', '06:07 melden', ...]. */
function tagesliste(datum, ferien = []) {
  const liste = [];
  const [j, m, t] = datum.split('-').map(Number);
  for (let ms = utc(j, m, t, 0, 0) - 3 * 3600_000; ms < utc(j, m, t, 0, 0) + 27 * 3600_000; ms += 60_000) {
    const z = berlin(ms);
    if (z.datum !== datum) continue;
    const a = aufgabeUm(z, ferien);
    if (a) liste.push(`${String(z.hh).padStart(2, '0')}:${String(z.mm).padStart(2, '0')} ${a}`);
  }
  return liste;
}
const zahl = (liste, art) => liste.filter((a) => a.endsWith(` ${art}`)).length;
/** Kurzform "voll/schnell/melden", z. B. "4/75/79". */
const mengen = (liste) => `${zahl(liste, 'voll')}/${zahl(liste, 'schnell')}/${zahl(liste, 'melden')}`;

console.log('--- Deutsche Zeit ---');
{
  // Winterzeit: 06:47 UTC = 07:47 Uhr. Montag, 16.11.2026.
  const w = berlin(utc(2026, 11, 16, 6, 47));
  pruefe('Winterzeit: 06:47 UTC ist Montag 07:47', w.wt === 1 && w.hh === 7 && w.mm === 47 && w.datum === '2026-11-16', JSON.stringify(w));
  // Sommerzeit: 05:47 UTC = 07:47 Uhr. Montag, 29.03.2027 (Umstellung am 28.03.).
  const s = berlin(utc(2027, 3, 29, 5, 47));
  pruefe('Sommerzeit: 05:47 UTC ist Montag 07:47', s.wt === 1 && s.hh === 7 && s.mm === 47 && s.datum === '2027-03-29', JSON.stringify(s));
  // Mitternacht darf nicht als Stunde 24 erscheinen.
  const n = berlin(utc(2026, 11, 16, 23, 5));
  pruefe('00:05 Uhr ist Stunde 0 des Folgetags', n.hh === 0 && n.datum === '2026-11-17', JSON.stringify(n));
  pruefe('Protokollformat', uhr(utc(2026, 11, 16, 6, 47)) === 'Mo 16.11. 07:47', uhr(utc(2026, 11, 16, 6, 47)));
}

console.log('\n--- Was wird wann angestossen ---');
{
  pruefe('Mo 07:47 -> melden (13 Minuten vor 8:00, ohne Schulserver)', um(utc(2026, 11, 16, 6, 47)) === 'melden');
  pruefe('Mo 07:42 und 07:52 -> schnell', um(utc(2026, 11, 16, 6, 42)) === 'schnell' && um(utc(2026, 11, 16, 6, 52)) === 'schnell');
  pruefe('Mo 07:45 -> nichts (nicht im Raster)', um(utc(2026, 11, 16, 6, 45)) === null);
  pruefe('Mo 06:02 -> voll', um(utc(2026, 11, 16, 5, 2)) === 'voll');
  pruefe('Mo 10:02, 14:02, 18:02 -> voll',
    [9, 13, 17].every((h) => um(utc(2026, 11, 16, h, 2)) === 'voll'));
  pruefe('Mo 05:57 -> nichts (vor 6 Uhr)', um(utc(2026, 11, 16, 4, 57)) === null);
  pruefe('Mo 18:57 -> melden (letzter Takt)', um(utc(2026, 11, 16, 17, 57)) === 'melden');
  pruefe('Mo 18:52 -> schnell (letzter Abruf)', um(utc(2026, 11, 16, 17, 52)) === 'schnell');
  pruefe('Mo 19:02 -> nichts', um(utc(2026, 11, 16, 18, 2)) === null);
  pruefe('Mo 21:02 -> schnell, 21:07 -> melden (Abendvorschau)',
    um(utc(2026, 11, 16, 20, 2)) === 'schnell' && um(utc(2026, 11, 16, 20, 7)) === 'melden');
  pruefe('Mo 21:12 -> nichts', um(utc(2026, 11, 16, 20, 12)) === null);
  pruefe('Fr 21:02 -> nichts (Samstag ist kein Schultag)', um(utc(2026, 11, 20, 20, 2)) === null);
  pruefe('So 15:42 -> schnell, 15:47 -> melden (Hausaufgaben-Erinnerung)',
    um(utc(2026, 11, 15, 14, 42)) === 'schnell' && um(utc(2026, 11, 15, 14, 47)) === 'melden');
  pruefe('So 21:02 -> schnell (Abendvorschau)', um(utc(2026, 11, 15, 20, 2)) === 'schnell');
  pruefe('So 10:02 -> nichts', um(utc(2026, 11, 15, 9, 2)) === null);
  pruefe('Sommerzeit: Mo 07:47 -> melden', um(utc(2027, 3, 29, 5, 47)) === 'melden');
  pruefe('Sommerzeit: Mo 06:02 -> voll', um(utc(2027, 3, 29, 4, 2)) === 'voll');
  pruefe('Probe: gerade Minute -> melden (nie zum Schulserver), ungerade -> nichts',
    um(utc(2026, 11, 15, 13, 2), [], true) === 'melden' && um(utc(2026, 11, 15, 13, 3), [], true) === null);
}

console.log('\n--- Vor jeder Stunde liegt ein Lauf im Fenster 10 bis 15 Minuten ---');
{
  for (const beginn of ['08:00', '09:50', '11:30', '14:05', '15:45']) {
    const [hh, mm] = beginn.split(':').map(Number);
    const treffer = [];
    for (let vor = 15; vor >= 10; vor--) {
      const ms = utc(2026, 11, 16, hh - 1, mm) - vor * 60_000; // Winterzeit: UTC = deutsche Zeit - 1
      if (um(ms)) treffer.push(vor);
    }
    pruefe(`Stunde ${beginn}: genau ein Lauf, 13 Minuten vorher`, treffer.length === 1 && treffer[0] === 13, treffer.join(','));
  }
}

console.log('\n--- Tagesmengen (voll/schnell/melden - nur voll und schnell fragen den Schulserver) ---');
{
  const montag = tagesliste('2026-11-16');
  pruefe('Schultag Mo-Do: 158 Laeufe', montag.length === 158, String(montag.length));
  pruefe('davon 4 voll, 75 schnell, 79 melden - also 79 Abrufe beim Schulserver', mengen(montag) === '4/75/79', mengen(montag));
  pruefe('erster 06:02 voll, letzter 21:07 melden', montag[0] === '06:02 voll' && montag.at(-1) === '21:07 melden', `${montag[0]} / ${montag.at(-1)}`);
  const freitag = tagesliste('2026-11-20');
  pruefe('Freitag: 156 Laeufe (keine Abendvorschau), 4/74/78', freitag.length === 156 && mengen(freitag) === '4/74/78', `${freitag.length} ${mengen(freitag)}`);
  pruefe('Samstag: keiner', tagesliste('2026-11-21').length === 0);
  const sonntag = tagesliste('2026-11-22');
  pruefe('Sonntag: 4 Laeufe, 0/2/2', sonntag.length === 4 && mengen(sonntag) === '0/2/2', sonntag.join(' | '));

  // Tag der Zeitumstellung (Sonntag, 28.03.2027) und der Montag danach.
  pruefe('Sonntag der Zeitumstellung: 4', tagesliste('2027-03-28').length === 4, tagesliste('2027-03-28').join(' | '));
  pruefe('Montag nach der Zeitumstellung: 158, 4/75/79',
    tagesliste('2027-03-29').length === 158 && mengen(tagesliste('2027-03-29')) === '4/75/79', String(tagesliste('2027-03-29').length));
  pruefe('Sonntag der Rueckumstellung (25.10.2026): 4', tagesliste('2026-10-25').length === 4, tagesliste('2026-10-25').join(' | '));

  const ferien = [{ von: '2026-12-23', bis: '2027-01-08' }];
  const ferientag = tagesliste('2026-12-28', ferien); // Montag in den Weihnachtsferien
  pruefe('Ferientag: 30 Laeufe - 4 voll, 24 schnell (halbstuendlich + 15:42 + 21:02), 2 melden (15:47, 21:07)',
    ferientag.length === 30 && mengen(ferientag) === '4/24/2', `${ferientag.length} ${mengen(ferientag)}`);
  pruefe('Ferientag: 15:42 fuer die Hausaufgaben-Erinnerung bleibt', ferientag.includes('15:42 schnell'));
  pruefe('Erster Schultag nach den Ferien: wieder 158', tagesliste('2027-01-11', ferien).length === 158);

  // So schreibt sync.mjs die Liste: Ferien plus alles ausserhalb des Schuljahres
  // (13.08.2026 bis 07.07.2027). Die Sommerferien stehen bei WebUntis nicht drin.
  const mitSchuljahr = [...ferien, { von: '2000-01-01', bis: '2026-08-12' }, { von: '2027-07-08', bis: '2099-12-31' }];
  pruefe('Sommerferien (Mo 12.07.2027, ausserhalb des Schuljahres): 30 statt 158',
    tagesliste('2027-07-12', mitSchuljahr).length === 30, String(tagesliste('2027-07-12', mitSchuljahr).length));
  pruefe('Letzter Schultag (Mi 07.07.2027): 158', tagesliste('2027-07-07', mitSchuljahr).length === 158);
  pruefe('Normaler Schultag mit dieser Liste: 158', tagesliste('2026-11-16', mitSchuljahr).length === 158);
}

console.log('\n--- Naechster Termin ---');
{
  // Freitag 19:00 -> Sonntag 15:42
  const n = naechsterTermin(utc(2026, 11, 20, 18, 0));
  pruefe('Nach Freitag 19:00 kommt Sonntag 15:42', n && uhr(n.zeit) === 'So 22.11. 15:42' && n.aufgabe === 'schnell', n ? uhr(n.zeit) : 'null');
  // Sonntag 21:10 -> Montag 06:02 voll
  const m = naechsterTermin(utc(2026, 11, 15, 20, 10));
  pruefe('Nach Sonntag 21:10 kommt Montag 06:02 voll', m && uhr(m.zeit) === 'Mo 16.11. 06:02' && m.aufgabe === 'voll', m ? uhr(m.zeit) : 'null');
  // Genau auf dem Termin: der Termin selbst
  const g = naechsterTermin(utc(2026, 11, 16, 6, 47));
  pruefe('Genau zur Taktminute: dieser Termin', g && g.zeit === utc(2026, 11, 16, 6, 47));
  // Eine Sekunde danach: der naechste
  const d = naechsterTermin(utc(2026, 11, 16, 6, 47) + 1000);
  pruefe('Eine Sekunde spaeter: fuenf Minuten weiter', d && d.zeit === utc(2026, 11, 16, 6, 52));
  // Probebetrieb: jede gerade Minute
  const p = naechsterTermin(utc(2026, 11, 15, 13, 1) + 1, [], true);
  pruefe('Probe: naechste gerade Minute', p && p.zeit === utc(2026, 11, 15, 13, 2) && p.aufgabe === 'melden');
}

console.log('\n--- Ausgefallenen Takt nachholen ---');
{
  const T = (hh, mm, s = 0) => utc(2026, 11, 16, hh - 1, mm) + s * 1000; // Montag, 16.11., deutsche Zeit
  // Normale Uebergabe: Der Vorgaenger hat um 7:52:01 angestossen, der Nachfolger startet 7:52:20.
  pruefe('Normale Uebergabe: nichts nachzuholen', nachzuholen(T(7, 52, 20), T(7, 52, 1)) === null);
  // Der Abruf-Lauf steht mit einer Uhr im Protokoll, die 20 s nachgeht - gilt trotzdem als bedient.
  pruefe('Abruf 20 s "vor" dem Termin zaehlt als bedient', nachzuholen(T(7, 52, 20), T(7, 51, 40)) === null);
  // Kette riss um 7:44, lebt 7:48:30 wieder: 7:47 fiel aus -> sofort nachholen (melden).
  const a = nachzuholen(T(7, 48, 30), T(7, 42, 1));
  pruefe('Kette riss vor 7:47, lebt 7:48:30: 7:47 wird nachgeholt (melden)',
    a && a.zeit === T(7, 47) && a.aufgabe === 'melden', JSON.stringify(a));
  // Laengerer Ausfall: 7:42 (schnell) und 7:47 (melden) fehlen -> EIN Lauf, und zwar der groessere.
  const b = nachzuholen(T(7, 48, 30), T(7, 37, 1));
  pruefe('Zwei Takte ausgefallen: ein Lauf, die groessere Aufgabe (schnell)',
    b && b.zeit === T(7, 47) && b.aufgabe === 'schnell', JSON.stringify(b));
  // Voller Lauf um 10:02 ausgefallen, Neustart 10:20.
  const c = nachzuholen(T(10, 20), T(9, 57, 1));
  pruefe('10:02 (voll) ausgefallen: voll wird nachgeholt', c && c.aufgabe === 'voll' && c.zeit === T(10, 17), JSON.stringify(c));
  // Abends: Kette um 21:10 neu gestartet, letzter Abruf 18:57 -> Abendvorschau nachholen.
  const e = nachzuholen(T(21, 10), T(18, 57, 1));
  pruefe('Neustart 21:10: 21:02/21:07 werden nachgeholt (schnell)', e && e.zeit === T(21, 7) && e.aufgabe === 'schnell', JSON.stringify(e));
  // Nachts: Der letzte Termin liegt mehr als 90 Minuten zurueck -> nichts.
  pruefe('Neustart 23:30: nichts nachzuholen (21:07 liegt mehr als 90 Minuten zurueck)', nachzuholen(T(23, 30), T(18, 57, 1)) === null);
  // Noch nie ein Abruf bekannt (0): der juengste Termin im Fenster.
  const f = nachzuholen(T(7, 48, 30), 0);
  pruefe('Kein Abruf bekannt: es wird nachgeholt', f && f.zeit === T(7, 47), JSON.stringify(f));
  // Samstagmorgen: nichts.
  pruefe('Samstag 03:00: nichts nachzuholen', nachzuholen(utc(2026, 11, 21, 2, 0), utc(2026, 11, 20, 17, 57)) === null);
}

console.log(fehler === 0 ? '\nAlle Pruefungen bestanden.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
