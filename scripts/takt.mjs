// Taktgeber: stoesst den Stundenplan-Abruf (sync.yml) selbst an - alle fuenf
// Minuten, ohne GitHubs Zeitplan, ohne eigenes Token, ohne fremden Dienst.
//
// WARUM: GitHub fuehrt Zeitplaene (schedule) nur "nach Moeglichkeit" aus. Bei
// diesem Repo kamen von 156 geplanten Laeufen am Tag 5 bis 9 an, und die
// 4 bis 9 Stunden zu spaet. Ein von Hand bzw. per Schnittstelle gestarteter
// Lauf (workflow_dispatch) beginnt dagegen sofort - und seit September 2022
// darf ein Lauf mit seinem eingebauten GITHUB_TOKEN solche Laeufe anstossen.
//
// WIE: Ein Lauf von takt.yml schlaeft bis zur naechsten Fuenf-Minuten-Marke,
// stoesst sync.yml an und wiederholt das rund 55 Minuten lang. Gleich beim
// Start stellt er seinen Nachfolger bereit (die "Reserve"): Der wartet in
// derselben Concurrency-Gruppe, bis dieser Lauf endet - egal ob regulaer,
// durch Absturz oder Zeitueberschreitung - und uebernimmt dann von selbst.
// So entsteht eine Kette, die Tag und Nacht durchlaeuft; nachts und am
// Wochenende schlaeft sie nur (kein Abruf beim Schulserver).
//
// Nur jeder zweite Takt fragt den Schulserver ab ('schnell' bzw. 'voll'). Die
// Takte dazwischen ('melden') verschicken Erinnerungen und Tagesmeldungen aus
// dem zuletzt veroeffentlichten Plan - dafuer braucht es WebUntis nicht.
//
// Aufrufe:
//   node scripts/takt.mjs takt     - der Taktgeber selbst (Job "takt")
//   node scripts/takt.mjs staffel  - prueft nach dem Ende, ob ein Nachfolger laeuft
//   node scripts/takt.mjs wache    - Wiederanlauf, falls die Kette steht
//   node scripts/takt.mjs plan 48  - zeigt nur, was in den naechsten 48 Stunden
//                                    angestossen wuerde (ohne Netz, zum Pruefen)
//
// Bewusst ohne npm-Pakete: Der Job braucht kein "npm ci" und startet in
// wenigen Sekunden. Laeuft mit jedem Node ab Version 18.
import { pathToFileURL } from 'node:url';

const REPO = (process.env.GITHUB_REPOSITORY ?? 'Jester3443/stundenplan').trim();
const TOKEN = (process.env.GITHUB_TOKEN ?? '').trim();
const ICH = Number(process.env.GITHUB_RUN_ID ?? 0);
const ZWEIG = 'master'; // workflow_dispatch braucht die Datei auf dem Standardzweig
const API = `https://api.github.com/repos/${REPO}`;

const MIN = 60_000;
/** So weit wird nach dem naechsten Termin gesucht (laengste Pause: Fr 18:57 bis So 15:42). */
const HORIZONT = 80 * 60 * MIN;
/** Laufzeit eines Taktgeber-Jobs, solange Termine anstehen. */
const DAUER_TAKT = 55 * MIN;
/** Laufzeit, wenn in den naechsten Stunden nichts ansteht (nachts, Wochenende). */
const DAUER_RUHE = 170 * MIN;
/** Laufzeit im Probebetrieb. */
const DAUER_PROBE = 6 * MIN;
/** Spaetestens so oft wird im Schlaf nach der Reserve gesehen. */
const RUHE_SCHRITT = 20 * MIN;
/** Mehr Anstoesse kann ein Job regulaer nie brauchen - Schutz vor einer Endlosschleife. */
const HOECHSTENS_JE_JOB = 40;
/** So weit zurueck sieht ein neuer Taktgeber nach einem ausgefallenen Takt. */
const NACHHOLEN = 90 * MIN;
/** Welche Aufgabe mehr tut: Beim Nachholen gewinnt die groessere. */
const RANG = { melden: 1, schnell: 2, voll: 3 };

const schlafe = (ms) => new Promise((fertig) => setTimeout(fertig, Math.max(0, ms)));

// ------------------------------------------------------------ Zeitrechnung
// Alles in deutscher Zeit, aus dem absoluten Zeitpunkt berechnet. Damit ist
// die Sommer-/Winterzeit kein Thema: Es gibt keine UTC-Stunden mehr, die man
// zweimal im Jahr umrechnen muesste.

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const WOCHENTAG = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const KURZ = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Zeitpunkt (Millisekunden) -> deutsche Zeit: { datum, wt (1 = Montag ... 7 = Sonntag), hh, mm }. */
export function berlin(ms) {
  const t = Object.fromEntries(FORMAT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    datum: `${t.year}-${t.month}-${t.day}`,
    wt: WOCHENTAG[t.weekday],
    hh: Number(t.hour) % 24,
    mm: Number(t.minute),
  };
}

/** Fuer das Protokoll: "Mo 16.11. 07:47". */
export function uhr(ms) {
  const z = berlin(ms);
  const zwei = (n) => String(n).padStart(2, '0');
  return `${KURZ[z.wt]} ${z.datum.slice(8, 10)}.${z.datum.slice(5, 7)}. ${zwei(z.hh)}:${zwei(z.mm)}`;
}

/**
 * Was ist zu dieser Minute anzustossen? Liefert 'schnell', 'voll', 'melden'
 * oder null.
 *
 *   schnell = Plan holen (2 Wochen), dann Erinnerung und Tagesmeldungen
 *   voll    = Plan holen (6 Wochen), dann Erinnerung und Tagesmeldungen
 *   melden  = nur Erinnerung und Tagesmeldungen aus dem veroeffentlichten
 *             Plan - KEIN Abruf beim Schulserver
 *
 * Das Raster liegt auf den Minuten 2, 7, 12 ... - nicht auf 0, 5, 10:
 * Die Stunden beginnen um 8:00, 9:50, 11:30, 14:05 und 15:45. Der Lauf um
 * :47 / :37 / :17 / :52 / :32 liegt damit immer 13 Minuten vor Beginn, und
 * die Erinnerung kommt im gewuenschten Fenster von 10 bis 15 Minuten an.
 *
 * - Schultage 6:00 bis 19:00: alle fuenf Minuten ein Lauf, abwechselnd
 *   'schnell' (:02, :12, :22 ...) und 'melden' (:07, :17, :27 ...). Der
 *   Schulserver wird also alle zehn Minuten gefragt - 79-mal am Tag. Das ist
 *   die Groessenordnung, die Anfang September ohne einen einzigen Fehlschlag
 *   lief (63 bis 72 Laeufe am Tag); 158 Anmeldungen am Tag hat dieses
 *   Schulkonto noch nie erlebt. Um 6:02, 10:02, 14:02 und 18:02 'voll'.
 * - Sonntag bis Donnerstag 15:42/15:47 und 21:02/21:07: je zwei Laeufe fuer
 *   die Hausaufgaben-Erinnerung und die Abendvorschau. Welche Tagesmeldung
 *   faellig ist, entscheidet der Abruf selbst anhand der Uhrzeit - der
 *   Taktgeber sorgt nur dafuer, dass zur richtigen Zeit ein Lauf stattfindet.
 * - Ferien, Feiertage und die Zeit ausserhalb des Schuljahres: nur die vier
 *   vollen Laeufe und ein Schnell-Lauf je halbe Stunde. Das schont den
 *   Schulserver; faellt ein Ferieneintrag falsch aus, kommen Aenderungen und
 *   Erinnerungen trotzdem noch an.
 * - Probebetrieb: jede gerade Minute 'melden' - nur zum Testen der Kette,
 *   ohne den Schulserver zu belasten.
 */
export function aufgabeUm(z, ferien = [], probe = false) {
  if (probe) return z.mm % 2 === 0 ? 'melden' : null;
  if (z.mm % 5 !== 2) return null;

  // Jeder zweite Takt kommt ohne den Schulserver aus.
  const art = z.mm % 10 === 2 ? 'schnell' : 'melden';
  const schultag = z.wt >= 1 && z.wt <= 5;
  const vorSchultag = z.wt === 7 || z.wt <= 4; // Sonntag bis Donnerstag
  const meldung =
    vorSchultag && ((z.hh === 15 && (z.mm === 42 || z.mm === 47)) || (z.hh === 21 && (z.mm === 2 || z.mm === 7)));

  if (schultag && z.hh >= 6 && z.hh < 19) {
    if ([6, 10, 14, 18].includes(z.hh) && z.mm === 2) return 'voll';
    const frei = ferien.some((f) => f.von <= z.datum && z.datum <= f.bis);
    // :02 und :32 sind immer Schnell-Laeufe (2 % 10 = 32 % 10 = 2).
    if (!frei || meldung || z.mm === 2 || z.mm === 32) return art;
    return null;
  }
  return meldung ? art : null;
}

/** Der naechste Termin ab einem Zeitpunkt: { zeit, aufgabe } - oder null, wenn im Horizont nichts ansteht. */
export function naechsterTermin(abMs, ferien = [], probe = false, horizont = HORIZONT) {
  for (let t = Math.ceil(abMs / MIN) * MIN; t <= abMs + horizont; t += MIN) {
    const aufgabe = aufgabeUm(berlin(t), ferien, probe);
    if (aufgabe) return { zeit: t, aufgabe };
  }
  return null;
}

/**
 * Ist beim Start eines Taktgebers ein ausgefallener Takt nachzuholen?
 *
 * Im Normalfall nein: Der Vorgaenger hat seinen letzten Takt ausgeloest und
 * erst danach uebergeben. War die Kette aber unterbrochen (Nachfolger nicht
 * angelaufen, Stoerung bei GitHub), dann liegt der juengste faellige Termin
 * NACH dem juengsten Abruf-Lauf. Ohne Nachholen wartete der neue Taktgeber
 * auf den naechsten Rasterpunkt - abends ist der Stunden entfernt (nach 21:07
 * kommt bis 6:02 keiner), und die Abendvorschau fiele aus, obwohl ihr
 * Zeitfenster noch offen ist.
 *
 * Liefert { zeit, aufgabe } oder null. zeit = der juengste ausgefallene
 * Termin; aufgabe = die groesste der ausgefallenen (voll vor schnell vor
 * melden). Nachgeholt wird hoechstens EIN Lauf je Jobstart - kein Schwall.
 *
 * @param startMs        Jobstart
 * @param letzterAbrufMs Startzeit des juengsten Laufs von sync.yml (0 = keiner)
 */
export function nachzuholen(startMs, letzterAbrufMs, ferien = []) {
  // Ein Termin gilt als bedient, wenn ab 30 s vor ihm ein Abruf-Lauf begann.
  const ab = Math.max(startMs - NACHHOLEN, letzterAbrufMs + 30_000);
  let offen = null;
  for (let t = Math.floor(startMs / MIN) * MIN; t > ab; t -= MIN) {
    const aufgabe = aufgabeUm(berlin(t), ferien);
    if (!aufgabe) continue;
    if (!offen) offen = { zeit: t, aufgabe };
    else if (RANG[aufgabe] > RANG[offen.aufgabe]) offen.aufgabe = aufgabe;
  }
  return offen;
}

// ------------------------------------------------------------------ GitHub

async function github(pfad, { methode = 'GET', koerper = null, roh = false } = {}) {
  const antwort = await fetch(`${API}${pfad}`, {
    method: methode,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: roh ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stundenplan-takt',
      ...(koerper ? { 'Content-Type': 'application/json' } : {}),
    },
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  const text = await antwort.text();
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status} bei ${methode} ${pfad}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

/** Startet einen Workflow ueber workflow_dispatch. Mehrere Versuche, weil ein verlorener Anstoss einen Takt kostet. */
async function anstossen(datei, eingaben) {
  const pausen = [0, 4_000, 12_000, 30_000];
  for (let i = 0; i < pausen.length; i++) {
    await schlafe(pausen[i]);
    try {
      await github(`/actions/workflows/${datei}/dispatches`, {
        methode: 'POST',
        koerper: { ref: ZWEIG, inputs: eingaben },
      });
      return true;
    } catch (fehler) {
      console.error(`Anstoss ${datei} misslungen (Versuch ${i + 1} von ${pausen.length}): ${String(fehler.message).slice(0, 200)}`);
    }
  }
  return false;
}

/** Die letzten Laeufe eines Workflows, neueste zuerst. */
const laeufe = async (datei) => (await github(`/actions/workflows/${datei}/runs?per_page=30`))?.workflow_runs ?? [];

/**
 * Laeuft gerade irgendwo ein Taktgeber? Liefert dessen Lauf-Nummer oder 0.
 * Massgeblich ist der JOB "takt" im Zustand in_progress - nicht der Lauf:
 * Ein wartender Lauf oder einer, der nie einen Runner bekommen hat (so einer
 * haengt seit dem 11.11. bei sync.yml), zaehlt damit nicht als "lebt".
 */
async function aktiverTakt(ausser = 0) {
  const offen = (await laeufe('takt.yml')).filter((l) => l.id !== ausser && l.status !== 'completed').slice(0, 6);
  for (const lauf of offen) {
    const jobs = (await github(`/actions/runs/${lauf.id}/jobs?per_page=20`))?.jobs ?? [];
    if (jobs.some((j) => j.name === 'takt' && j.status === 'in_progress')) return lauf.id;
  }
  return 0;
}

/** Wartet, bis ein Taktgeber laeuft. Abfragefehler zaehlen als "noch nicht". */
async function warteAufTakt(ms) {
  const beginn = Date.now();
  const bis = beginn + ms;
  for (;;) {
    try {
      const lauf = await aktiverTakt(ICH);
      if (lauf) return lauf;
    } catch (fehler) {
      console.error(`Abfrage misslungen: ${String(fehler.message).slice(0, 120)}`);
    }
    if (Date.now() >= bis) return 0;
    // Anfangs dicht nachsehen, bei langem Warten seltener - das eingebaute
    // Token darf nur 1.000 Anfragen je Stunde stellen.
    await schlafe(Math.min(bis - Date.now(), Date.now() - beginn < 2 * MIN ? 15_000 : 30_000));
  }
}

/**
 * Notbremse gegen eine Kette, die sich im Kreis neu startet (z. B. wegen
 * eines Fehlers in diesem Skript) - das waeren sonst hunderte Fehllaeufe in
 * der Stunde. Sie greift in zwei Faellen:
 *
 *   - drei gescheiterte Taktgeber-Laeufe in der letzten halben Stunde;
 *   - acht neu angelegte Taktgeber-Laeufe in den letzten zehn Minuten. Ein
 *     Lauf gilt erst als gescheitert, wenn auch sein Job "staffel" fertig ist
 *     (das dauert Minuten) - eine schnelle Absturzschleife waere bis dahin
 *     ungebremst. Im Normalbetrieb entsteht ein Lauf in 55 Minuten, im
 *     Probebetrieb zwei in zehn; acht erreicht nur eine Schleife.
 *
 * Danach startet nur noch die Wache (oder ein spaeterer Versuch der Staffel)
 * die Kette neu.
 */
async function notbremse() {
  try {
    const andere = (await laeufe('takt.yml')).filter((l) => l.id !== ICH);
    const kaputt = andere.filter(
      (l) =>
        l.status === 'completed' &&
        ['failure', 'timed_out', 'startup_failure'].includes(l.conclusion) &&
        Date.now() - Date.parse(l.updated_at) < 30 * MIN
    );
    const frisch = andere.filter((l) => Date.now() - Date.parse(l.created_at) < 10 * MIN);
    return kaputt.length >= 3 || frisch.length >= 8;
  } catch {
    return false; // nicht feststellbar - dann nicht bremsen
  }
}

/** Ferien und Feiertage (nur von/bis) vom data-Zweig. Nicht lesbar = keine Ferien = normaler Takt. */
async function ferienLaden() {
  try {
    const liste = await github('/contents/ferien.json?ref=data', { roh: true });
    const datum = /^\d{4}-\d{2}-\d{2}$/;
    return (Array.isArray(liste) ? liste : []).filter((f) => datum.test(f?.von ?? '') && datum.test(f?.bis ?? ''));
  } catch {
    console.log('Ferienliste nicht lesbar - es gilt der normale Takt.');
    return [];
  }
}

// ---------------------------------------------------------------- Aufgaben

async function takt() {
  const start = Date.now();
  let probe = Number.parseInt(process.env.PROBE ?? '0', 10);
  if (!Number.isFinite(probe) || probe < 0) probe = 0;
  probe = Math.min(probe, 5); // mehr als fuenf Probe-Generationen braucht niemand
  const imTest = probe > 0;

  if (await notbremse()) {
    console.error('Notbremse: zu viele gescheiterte oder neu gestartete Taktgeber-Laeufe. Die Kette haelt an; die Wache startet sie spaeter neu.');
    process.exit(1);
  }

  const ferien = imTest ? [] : await ferienLaden();
  const erster = naechsterTermin(start, ferien, imTest);
  const dauer = imTest ? DAUER_PROBE : erster && erster.zeit - start <= DAUER_RUHE + 5 * MIN ? DAUER_TAKT : DAUER_RUHE;
  const ende = start + dauer;

  console.log(
    `Taktgeber gestartet (Lauf ${ICH}, ${imTest ? `PROBE, noch ${probe} Generation(en)` : 'Normalbetrieb'}). ` +
      `Geplant bis ${uhr(ende)}. Naechster Termin: ${erster ? `${uhr(erster.zeit)} (${erster.aufgabe})` : 'keiner in Sicht'}.`
  );

  // Die Reserve: der Nachfolger, der in der Concurrency-Gruppe wartet, bis
  // dieser Job endet. Sie wird SOFORT bereitgestellt und bei jedem Takt
  // ueberprueft - nicht erst am Ende. Stirbt dieser Job unterwegs, steht der
  // Nachfolger schon in den Startloechern.
  let reserveZuletzt = 0;
  const reserveSichern = async () => {
    if (Date.now() - reserveZuletzt < 3 * MIN) return; // GitHub braucht einen Moment, bis ein neuer Lauf in der Liste steht
    try {
      if ((await laeufe('takt.yml')).some((l) => l.id > ICH && l.status !== 'completed')) return;
    } catch (fehler) {
      console.error(`Reserve nicht pruefbar: ${String(fehler.message).slice(0, 120)}`);
      return; // beim naechsten Takt noch einmal
    }
    if (await anstossen('takt.yml', { probe: String(Math.max(0, probe - 1)) })) {
      reserveZuletzt = Date.now();
      console.log('Reserve bereitgestellt.');
    }
  };
  await reserveSichern();

  // Ausgefallenen Takt nachholen (siehe nachzuholen) - hoechstens einen je
  // Jobstart. Steht der naechste regulaere Takt ohnehin in weniger als 45
  // Sekunden an, eruebrigt sich das.
  if (!imTest && !(erster && erster.zeit - Date.now() < 45_000)) {
    try {
      const juengster = (await laeufe('sync.yml'))[0];
      const offen = nachzuholen(start, juengster ? Date.parse(juengster.created_at) || 0 : 0, ferien);
      if (offen) {
        const geklappt = await anstossen('sync.yml', { aufgabe: offen.aufgabe });
        console.log(
          `${uhr(offen.zeit)} war ausgefallen - ${geklappt ? `jetzt nachgeholt (${offen.aufgabe})` : 'Nachholen misslungen'}.`
        );
      }
    } catch (fehler) {
      console.error(`Nachholen nicht pruefbar: ${String(fehler.message).slice(0, 120)}`);
    }
  }

  let letzterTermin = 0;
  let anstoesse = 0;
  for (;;) {
    const jetzt = Date.now();
    const n = naechsterTermin(Math.max(jetzt, letzterTermin + MIN), ferien, imTest);

    // Kein Termin mehr in meiner Zeit: bis zum Ende ruhen. Ein Termin kurz
    // nach dem geplanten Ende (bis 90 s) wird noch mitgenommen, damit er
    // nicht in die Uebergabe faellt.
    if (!n || n.zeit > ende + 90_000) {
      if (jetzt >= ende) break;
      await schlafe(Math.min(ende - jetzt, RUHE_SCHRITT));
      await reserveSichern();
      if (Date.now() < ende) console.log(`${uhr(Date.now())} lebt, naechster Termin ${n ? uhr(n.zeit) : 'keiner in Sicht'}.`);
      continue;
    }

    // Lange Wartezeit in Abschnitten, damit die Reserve zwischendurch geprueft wird.
    if (n.zeit - jetzt > RUHE_SCHRITT + 30_000) {
      await schlafe(RUHE_SCHRITT);
      await reserveSichern();
      continue;
    }

    await schlafe(n.zeit - Date.now());
    const geklappt = await anstossen('sync.yml', { aufgabe: n.aufgabe });
    letzterTermin = n.zeit;
    anstoesse++;
    console.log(`${uhr(n.zeit)} ${n.aufgabe} ${geklappt ? 'angestossen' : 'NICHT angestossen (GitHub nimmt den Anstoss nicht an)'}.`);
    await reserveSichern();

    if (anstoesse >= HOECHSTENS_JE_JOB) {
      console.error('Mehr Anstoesse als ein Job je brauchen kann - Abbruch zur Sicherheit.');
      break;
    }
    // Faellt der naechste Termin nicht mehr in meine Zeit, ist JETZT Schluss -
    // direkt nach einem Takt. So hat der Nachfolger fast fuenf Minuten zum
    // Starten, und kein Termin geraet in die Uebergabe.
    const danach = naechsterTermin(Math.max(Date.now(), letzterTermin + MIN), ferien, imTest);
    if (!danach || danach.zeit > ende + 90_000) break;
  }
  console.log(`Zeit um nach ${anstoesse} Anstoss/Anstoessen - die Reserve uebernimmt.`);
}

/**
 * Laeuft als zweiter Job nach dem Taktgeber (auch nach Absturz oder Abbruch)
 * und prueft die Uebergabe. Regulaer hat die Reserve dann schon uebernommen.
 * Laeuft kein Taktgeber, wird die Kette hier neu gestartet. Auf die Wache ist
 * dafuer vormittags kein Verlass (ihr Zeitplan kam in den letzten Wochen nie
 * vor 12:46 Uhr an).
 *
 * Zwei Faelle (TAKT_ERGEBNIS = Ergebnis des Jobs "takt" in diesem Lauf):
 *   - success: Der Taktgeber hat seine Zeit regulaer beendet. Fehlt jetzt der
 *     Nachfolger, ist das ein Startproblem bei GitHub (ein Lauf, der nie einen
 *     Runner bekommt - so einer haengt seit dem 11.11.). Dann zuegig und bis
 *     zu fuenfmal neu starten, verteilt ueber gut eine Stunde. Ein
 *     ueberzaehliger Neustart schadet nicht: Er reiht sich als Reserve ein.
 *   - alles andere (failure, cancelled): vorsichtig bleiben - vier Minuten
 *     warten, EIN Neustart, Notbremse beachten. "failure" kann ein Fehler im
 *     Skript sein, der sich sonst aufschaukelt. "cancelled" traegt auch jeder
 *     Lauf, der als wartende Reserve von einem neueren ersetzt wurde und nie
 *     getaktet hat - startete jeder davon fuenfmal neu, vervielfachten sich
 *     die Laeufe. Und wer die Kette von Hand abbricht, will keinen Dauerlauf
 *     dagegen.
 */
async function staffel() {
  const sauber = (process.env.TAKT_ERGEBNIS ?? '').trim() === 'success';
  const fristen = sauber ? [75_000, 3 * MIN, 5 * MIN, 10 * MIN, 20 * MIN, 30 * MIN] : [4 * MIN, 4 * MIN];

  for (let runde = 0; runde < fristen.length; runde++) {
    const lauf = await warteAufTakt(fristen[runde]);
    if (lauf) return console.log(`${runde ? 'Neustart' : 'Uebergabe'} geglueckt - Lauf ${lauf} taktet.`);
    if (runde === fristen.length - 1) break;

    if (await notbremse()) {
      console.error('Kein Taktgeber laeuft, aber die Notbremse ist aktiv - jetzt kein Neustart.');
      if (!sauber) process.exit(1); // die Wache versucht es spaeter
      continue; // nach der naechsten Frist noch einmal nachsehen
    }
    console.log(`Kein Taktgeber laeuft - Neustart (Versuch ${runde + 1} von ${fristen.length - 1}).`);
    await anstossen('takt.yml', { probe: '0' });
  }

  console.error('Die Kette steht. Die Wache (Zeitplan) startet sie beim naechsten Mal neu.');
  process.exit(1);
}

/**
 * Wiederanlauf ueber GitHubs Zeitplan (wache.yml). Der ist unzuverlaessig und
 * oft Stunden zu spaet - deshalb haengt hier nichts Zeitkritisches dran, nur
 * die Frage: Lebt die Kette? Wenn nicht, neu starten und einmal vollstaendig
 * abgleichen.
 */
async function wache() {
  const pruefe = () => aktiverTakt().catch(() => -1);
  let lauf = await pruefe();
  if (lauf === 0) {
    // Mitten in einer Uebergabe laeuft fuer einige Sekunden kein Taktgeber.
    await schlafe(45_000);
    lauf = await pruefe();
  }
  if (lauf > 0) return console.log(`Kette lebt (Lauf ${lauf}) - nichts zu tun.`);
  if (lauf < 0) {
    console.error('GitHub-Abfrage misslungen - kein Urteil moeglich, nichts unternommen.');
    process.exit(1);
  }
  if (await notbremse()) {
    console.error('Kette steht, aber die Notbremse ist aktiv - kein Neustart in diesem Durchgang.');
    process.exit(1);
  }
  console.log('Kette steht - Neustart und ein vollstaendiger Abgleich.');
  const a = await anstossen('takt.yml', { probe: '0' });
  const b = await anstossen('sync.yml', { aufgabe: 'voll' });
  if (!a || !b) process.exit(1);
}

/** Nur anzeigen, was angestossen wuerde - ohne Netz. Ferien bleiben dabei unberuecksichtigt. */
function plan(stunden) {
  const von = Date.now();
  const bis = von + stunden * 60 * MIN;
  const tage = new Map();
  for (let t = von; ; ) {
    const n = naechsterTermin(t, [], false, bis - t);
    if (!n) break;
    const z = berlin(n.zeit);
    const tag = tage.get(z.datum) ?? { erster: n.zeit, letzter: n.zeit, zahl: 0, abruf: 0, voll: [] };
    tag.letzter = n.zeit;
    tag.zahl++;
    if (n.aufgabe !== 'melden') tag.abruf++;
    if (n.aufgabe === 'voll') tag.voll.push(uhr(n.zeit).slice(-5));
    tage.set(z.datum, tag);
    t = n.zeit + MIN;
  }
  console.log(`Anstoesse in den naechsten ${stunden} Stunden (ab ${uhr(von)}, ohne Ferien):`);
  for (const tag of tage.values()) {
    console.log(
      `  ${uhr(tag.erster).slice(0, 9)}: ${tag.zahl} Anstoesse (${tag.abruf} mit Abruf beim Schulserver), ` +
        `${uhr(tag.erster).slice(-5)} bis ${uhr(tag.letzter).slice(-5)}` +
        (tag.voll.length ? `, voll um ${tag.voll.join(', ')}` : '')
    );
  }
  if (!tage.size) console.log('  keine');
}

// Nur ausfuehren, wenn die Datei direkt gestartet wurde - der Test importiert sie bloss.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const befehl = process.argv[2] ?? '';
  try {
    if (befehl === 'plan') {
      plan(Math.min(Math.max(Number(process.argv[3]) || 48, 1), 24 * 14));
    } else if (['takt', 'staffel', 'wache'].includes(befehl)) {
      if (!TOKEN) throw new Error('GITHUB_TOKEN fehlt.');
      if (befehl !== 'wache' && !ICH) throw new Error('GITHUB_RUN_ID fehlt - dieser Befehl laeuft nur in GitHub Actions.');
      await { takt, staffel, wache }[befehl]();
    } else {
      throw new Error('Aufruf: node scripts/takt.mjs takt | staffel | wache | plan [Stunden]');
    }
  } catch (fehler) {
    console.error(String(fehler.stack ?? fehler.message).slice(0, 600));
    process.exit(1);
  }
}
