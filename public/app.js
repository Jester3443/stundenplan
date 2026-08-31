import {
  wochentyp,
  stundenBezeichnung,
  DOPPELBLOECKE,
  VAPID_OEFFENTLICH,
  DATEN_URL,
  BENUTZER,
  setzeBenutzer,
} from './shared/konfiguration.mjs?v=18';
import { schluesselAusCode, entschluesseln, b64 } from './shared/krypto.mjs?v=18';
import {
  schluesselSichern,
  schluesselLaden,
  schluesselVergessen,
  ladeMeineDaten,
  speichereMeineDaten,
  setzePerson,
  LEER,
} from './daten.mjs?v=18';
import { symbolFuer } from './symbole.mjs?v=18';
import {
  initBereiche,
  zeichneAufgaben,
  zeichneNoten,
  zeichneMehr,
  schliesseEingabe,
  eingabeOffen,
  offeneAufgaben,
  lernVorschau,
  aufgabenVorschau,
  lernenAm,
  aktualisiereStundenZaehler,
} from './bereiche.mjs?v=18';

/** Sichtbare Versionsnummer - bei jedem Update zusammen mit ?v= hochzaehlen. */
const APP_VERSION = 18;

const $ = (id) => document.getElementById(id);
const TAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const TAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Lokales YYYY-MM-DD, nicht über toISOString (das rechnet nach UTC). */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ISO-Kalenderwoche (die Zählung, die auch die Schule benutzt). */
function kalenderwoche(datum) {
  const d = new Date(datum instanceof Date ? datum : `${datum}T12:00:00`);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Donnerstag der Woche
  const jahresanfang = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jahresanfang) / 864e5 - 3 + ((jahresanfang.getDay() + 6) % 7)) / 7);
}

const alsDatum = (s) => new Date(`${s}T12:00:00`);
const minuten = (uhr) => Number(uhr.slice(0, 2)) * 60 + Number(uhr.slice(3, 5));

/** Wer ist auf diesem Geraet angemeldet? */
const gemerkt = localStorage.getItem('benutzer');
let person = BENUTZER[gemerkt] ? gemerkt : 'jasper';
setzeBenutzer(person);
setzePerson(person);

const zustand = {
  plan: null,
  gewaehlt: null, // YYYY-MM-DD
  tab: 'plan',
  ansicht: localStorage.getItem('ansicht') === 'woche' ? 'woche' : 'tag',
  gelesen: new Set(JSON.parse(localStorage.getItem('gelesen') ?? '[]')),
  meineDaten: LEER(),
  datenGeladen: false, // erst nach erfolgreichem Laden darf gespeichert werden
};

let schluessel = null;

// ------------------------------------------------------------- Daten holen

async function holeRoh(frisch) {
  const anhang = frisch ? `?t=${Date.now()}` : '';
  const einstellung = { cache: frisch ? 'reload' : 'default' };

  // Bevorzugt aus der Cloud (immer aktuell, unabhängig vom Deploy) ...
  if (DATEN_URL) {
    const cloud = await fetch(`${DATEN_URL.replace('{benutzer}', person)}${anhang}`, einstellung).catch(() => null);
    if (cloud?.ok) return { verschluesselt: true, paket: await cloud.json() };

    // Rückfall auf den alten Dateinamen: GitHubs Auslieferung braucht für neu
    // angelegte Dateien einige Minuten. Ohne das bliebe die App so lange leer.
    if (person === 'jasper') {
      const alt = await fetch(`${DATEN_URL.replace('plan-{benutzer}', 'plan')}${anhang}`, einstellung).catch(() => null);
      if (alt?.ok) return { verschluesselt: true, paket: await alt.json() };
    }
  }

  // ... sonst von der eigenen Adresse.
  const verschluesselt = await fetch(`data/plan-${person}.enc.json${anhang}`, einstellung).catch(() => null);
  if (verschluesselt?.ok) return { verschluesselt: true, paket: await verschluesselt.json() };

  const klar = await fetch(`data/plan.json${anhang}`, einstellung).catch(() => null);
  if (klar?.ok) return { verschluesselt: false, plan: await klar.json() };

  throw new Error('Plandaten sind nicht erreichbar.');
}

/** Auswahlknöpfe für die Person - nur nötig, wenn es mehr als eine gibt. */
function zeichneBenutzerwahl() {
  const behaelter = $('sperreWer');
  const namen = Object.keys(BENUTZER);
  behaelter.hidden = namen.length < 2;
  if (namen.length < 2) return;

  behaelter.textContent = '';
  for (const kennung of namen) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = `wer-knopf${kennung === person ? ' aktiv' : ''}`;
    knopf.textContent = BENUTZER[kennung].name;
    knopf.addEventListener('click', () => {
      person = kennung;
      localStorage.setItem('benutzer', kennung);
      setzeBenutzer(kennung);
      setzePerson(kennung);
      schluessel = null;
      zeichneBenutzerwahl();
      $('sperreFehler').hidden = true;
      $('sperreCode').focus();
    });
    behaelter.append(knopf);
  }
}

function frageCode({ fehler = false } = {}) {
  return new Promise((aufloesen) => {
    const form = $('sperreForm');
    const feld = $('sperreCode');
    const knopf = $('sperreKnopf');

    $('sperre').hidden = false;
    zeichneBenutzerwahl();
    $('sperreFehler').hidden = !fehler;
    knopf.disabled = false;
    knopf.textContent = 'Entsperren';
    feld.value = '';
    setTimeout(() => feld.focus(), 50);

    const absenden = (e) => {
      e.preventDefault();
      const code = feld.value.trim();
      if (!code) return;
      form.removeEventListener('submit', absenden);
      knopf.disabled = true;
      knopf.textContent = 'Entsperre …';
      // Kurz warten, damit der Text noch gezeichnet wird, bevor die
      // absichtlich langsame Schlüsselableitung den Faden blockiert.
      setTimeout(() => aufloesen(code), 30);
    };
    form.addEventListener('submit', absenden);
  });
}

/**
 * leise = Hintergrund-Aktualisierung: Wenn der gespeicherte Schlüssel nicht
 * passt, wird NICHT der Sperrbildschirm gezeigt, sondern der alte Stand
 * behalten (Rückgabe null).
 */
async function ladePlan({ frisch = false, leise = false } = {}) {
  const roh = await holeRoh(frisch);

  if (!roh.verschluesselt) {
    $('sperre').hidden = true;
    return roh.plan;
  }

  let paket = roh.paket;
  schluessel ??= await schluesselLaden();
  let fehler = false;
  let vorigePerson = person;

  for (;;) {
    if (!schluessel) {
      if (leise && zustand.plan) return null; // alten Stand behalten, nicht nerven
      const code = await frageCode({ fehler });
      // Person kann im Anmeldefenster gewechselt worden sein - dann gehören
      // die geladenen Daten zur falschen Person.
      if (person !== vorigePerson) {
        vorigePerson = person;
        const neuRoh = await holeRoh(true);
        if (neuRoh.verschluesselt) paket = neuRoh.paket;
        schluessel = await schluesselLaden();
        if (schluessel) continue;
      }
      schluessel = await schluesselAusCode(code, b64.aus(paket.salz));
    }
    try {
      const plan = await entschluesseln(paket, schluessel);
      await schluesselSichern(schluessel);
      localStorage.setItem('benutzer', person);
      $('sperre').hidden = true;
      return plan;
    } catch {
      schluessel = null;
      await schluesselVergessen();
      fehler = true;
    }
  }
}

/**
 * Speichern ist nur erlaubt, wenn die eigenen Daten vorher erfolgreich
 * gelesen wurden. Sonst wuerde ein Lesefehler dazu fuehren, dass ein leerer
 * Stand ueber Noten, Aufgaben und Fehlzeiten geschrieben wird.
 */
const speichern = () => {
  if (!zustand.datenGeladen) {
    console.warn('Nicht gespeichert: eigene Daten wurden nie geladen.');
    return Promise.resolve();
  }
  // Abgeleitete Kurzfassung fuer den Hintergrunddienst mit ablegen.
  zustand.meineDaten.lernVorschau = lernVorschau();
  zustand.meineDaten.aufgabenVorschau = aufgabenVorschau();
  return speichereMeineDaten(zustand.meineDaten, schluessel);
};

// ------------------------------------------------------------- Hilfsmittel

const notizId = (s) => `${s.datum}|${s.von}|${s.kurs ?? 'TERMIN'}`;

const alleTage = () =>
  (zustand.plan?.wochen ?? [])
    .flatMap((w) => w.tage.map((t) => ({ ...t, wochentyp: w.typ, veroeffentlicht: w.veroeffentlicht })))
    .sort((a, b) => a.datum.localeCompare(b.datum));

const tagFinden = (datum) => alleTage().find((t) => t.datum === datum) ?? null;
const wocheFinden = (datum) => zustand.plan?.wochen.find((w) => w.tage.some((t) => t.datum === datum)) ?? null;

function startTag() {
  const heute = iso(new Date());
  const tage = alleTage();
  const jetzt = new Date();
  const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes();

  const heutiger = tage.find((t) => t.datum === heute);
  if (heutiger) {
    const letzteEnde = heutiger.stunden.reduce((m, s) => Math.max(m, minuten(s.bis)), 0);
    if (!heutiger.stunden.length || jetztMin < letzteEnde) return heute;
  }
  const naechster = tage.find((t) => t.datum > heute && t.stunden.length);
  return naechster?.datum ?? heutiger?.datum ?? tage[0]?.datum ?? heute;
}

const farbeVon = (name) => `var(--fl-${name ?? 'grau'})`;

const istEntfall = (s) => s.status === 'CANCELLED';
const istVertretung = (s) => !!s.lehrerErsetzt || s.status === 'SUBSTITUTION';
const istRaumwechsel = (s) => !!s.raumErsetzt;
const istGeaendert = (s) => istEntfall(s) || istVertretung(s) || istRaumwechsel(s) || s.status === 'CHANGED';

const eintragVon = (s) => zustand.meineDaten.notizen[notizId(s)] ?? {};
const hatEigenes = (s) => {
  const e = eintragVon(s);
  return { aufgabe: !!e.aufgabe, notiz: !!e.notiz };
};
const hatLehrerAufgabe = (s) => (s.aufgaben ?? []).some((a) => a.text || a.anmerkung);

/**
 * Untis zerlegt ganztaegige Veranstaltungen (z. B. eine Studienwoche) in
 * mehrere Bloecke pro Tag. Aufeinanderfolgende Termine mit gleichem Namen
 * werden hier zu einem Eintrag zusammengezogen - sonst steht viermal
 * dasselbe untereinander.
 */
function fasseTermineZusammen(stunden) {
  const kursstunden = stunden.filter((s) => s.kurs);
  const termine = new Map();

  // Alle Termine gleichen Namens zu EINEM Eintrag ueber den ganzen Tag -
  // nicht nur direkte Nachbarn, denn zwischen den Bloecken stehen die
  // entfallenen Kursstunden.
  for (const s of stunden.filter((x) => !x.kurs)) {
    const vorhanden = termine.get(s.fachName);
    if (!vorhanden) {
      termine.set(s.fachName, { ...s });
      continue;
    }
    if (s.von < vorhanden.von) vorhanden.von = s.von;
    if (s.bis > vorhanden.bis) vorhanden.bis = s.bis;
  }

  for (const termin of termine.values()) {
    termin.block = stundenBezeichnung(termin.von, termin.bis);
  }

  return [...kursstunden, ...termine.values()].sort((a, b) => a.von.localeCompare(b.von));
}

/** Wann der Tag wirklich beginnt und endet - entfallene Randstunden zählen nicht. */
function tagesInfo(tag) {
  if (!tag) return '';
  const alle = [...tag.stunden].sort((a, b) => a.von.localeCompare(b.von));
  if (!alle.length) return '';

  const gueltig = alle.filter((s) => !istEntfall(s));
  if (!gueltig.length) return 'Alle Stunden entfallen · schulfrei';

  const geplantStart = alle[0];
  const geplantEnde = alle[alle.length - 1];
  const echtStart = gueltig[0];
  const echtEnde = gueltig[gueltig.length - 1];

  return [
    echtStart.von === geplantStart.von ? `Start ${echtStart.von}` : `Start erst ${echtStart.von} statt ${geplantStart.von}`,
    echtEnde.bis === geplantEnde.bis ? `Schluss ${echtEnde.bis}` : `Schluss schon ${echtEnde.bis} statt ${geplantEnde.bis}`,
  ].join(' · ');
}

function wochenInfo(woche) {
  if (!woche) return '';
  const stunden = woche.tage.flatMap((t) => t.stunden);
  const bloecke = stunden.filter((s) => s.kurs).length;
  const entfaelle = stunden.filter(istEntfall).length;
  if (!bloecke) return 'Noch kein Plan veröffentlicht';
  return `${bloecke} Blöcke${entfaelle ? ` · ${entfaelle} Entfall` : ' · keine Ausfälle'}`;
}

// ---------------------------------------------------------------- Kopfzeile

function zeichneKopf() {
  const planTab = zustand.tab === 'plan';
  $('umschalter').hidden = !planTab;
  $('wocheAbzeichen').hidden = !(planTab && zustand.ansicht === 'tag');
  $('tagesleiste').hidden = !(planTab && zustand.ansicht === 'tag');
  $('aktualisieren').hidden = !planTab;

  if (!planTab) {
    $('tagesFortschritt').hidden = true;
    const titel = { aufgaben: 'Aufgaben', noten: 'Noten', mehr: 'Mehr' }[zustand.tab];
    const offen =
      zustand.tab === 'aufgaben' ? offeneAufgaben().length + lernenAm(iso(new Date())).length : 0;
    $('kopfDatum').textContent = 'Stundenplan';
    $('kopfTitel').textContent = titel;
    $('kopfInfo').textContent =
      zustand.tab === 'aufgaben'
        ? offen
          ? `${offen} ${offen === 1 ? 'Aufgabe' : 'Aufgaben'} offen`
          : 'Alles erledigt'
        : zustand.tab === 'noten'
          ? 'Deine Punkte im Überblick'
          : 'Fehlzeiten und Einstellungen';
    return;
  }

  const wochenModus = zustand.ansicht === 'woche';
  const tag = tagFinden(zustand.gewaehlt);
  const woche = wocheFinden(zustand.gewaehlt);
  const d = alsDatum(zustand.gewaehlt);
  const heute = iso(new Date()) === zustand.gewaehlt;
  const morgen = iso(new Date(Date.now() + 864e5)) === zustand.gewaehlt;

  if (wochenModus && woche) {
    const montag = alsDatum(woche.montag);
    const freitag = new Date(montag);
    freitag.setDate(freitag.getDate() + 4);
    $('kopfDatum').textContent = `${montag.getDate()}. – ${freitag.getDate()}. ${MONATE[freitag.getMonth()]}`;
    $('kopfTitel').textContent = `${woche.typ}-Woche`;
    $('kopfInfo').textContent = wochenInfo(woche);
  } else {
    $('kopfDatum').textContent = `${TAGE_LANG[d.getDay()]}, ${d.getDate()}. ${MONATE[d.getMonth()]}`;
    $('kopfTitel').textContent = heute ? 'Heute' : morgen ? 'Morgen' : TAGE_LANG[d.getDay()];
    $('kopfInfo').textContent = tagesInfo(tag);
  }

  $('wocheAbzeichen').textContent = `KW ${kalenderwoche(zustand.gewaehlt)} · ${tag?.wochentyp ?? wochentyp(zustand.gewaehlt)}`;
  $('ansichtTag').classList.toggle('aktiv', !wochenModus);
  $('ansichtWoche').classList.toggle('aktiv', wochenModus);
  $('ansichtTag').setAttribute('aria-selected', String(!wochenModus));
  $('ansichtWoche').setAttribute('aria-selected', String(wochenModus));
}

/**
 * Feiner Balken im Kopf: wie viel vom Schultag ist geschafft?
 * Nur fuer heute und nur in der Tagesansicht.
 */
function zeichneFortschritt(tag, istHeute, jetztMin) {
  const kasten = $('tagesFortschritt');
  const gueltig = (tag?.stunden ?? []).filter((s) => !istEntfall(s));

  if (!istHeute || zustand.ansicht !== 'tag' || !gueltig.length) {
    kasten.hidden = true;
    return;
  }

  const start = Math.min(...gueltig.map((s) => minuten(s.von)));
  const ende = Math.max(...gueltig.map((s) => minuten(s.bis)));
  const anteil = Math.max(0, Math.min(1, (jetztMin - start) / (ende - start)));

  const restMinuten = ende - jetztMin;
  const stunden = Math.floor(restMinuten / 60);
  const minutenRest = restMinuten % 60;

  let text;
  if (jetztMin < start) {
    const bis = start - jetztMin;
    text = bis >= 60 ? `Beginnt in ${Math.floor(bis / 60)} Std ${bis % 60} Min` : `Beginnt in ${bis} Min`;
  } else if (jetztMin >= ende) {
    text = 'Geschafft';
  } else {
    text = stunden ? `noch ${stunden} Std ${minutenRest} Min` : `noch ${minutenRest} Min`;
  }

  kasten.hidden = false;
  kasten.classList.toggle('fertig', jetztMin >= ende);
  $('tfFuellung').style.width = `${Math.round(anteil * 100)}%`;
  $('tfText').textContent = text;
}

function zeichneTagesleiste() {
  const leiste = $('tagesleiste');
  leiste.textContent = '';
  const d = alsDatum(zustand.gewaehlt);
  const montag = new Date(d);
  montag.setDate(montag.getDate() - ((montag.getDay() + 6) % 7));
  const heute = iso(new Date());

  for (let i = 0; i < 5; i++) {
    const tagDatum = new Date(montag);
    tagDatum.setDate(tagDatum.getDate() + i);
    const schluesselDatum = iso(tagDatum);
    const tag = tagFinden(schluesselDatum);

    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'tag-knopf';
    if (schluesselDatum === zustand.gewaehlt) knopf.classList.add('aktiv');
    if (schluesselDatum === heute) knopf.classList.add('heute');
    if (!tag?.stunden.length) knopf.classList.add('leer');

    const auffaellig = (tag?.stunden ?? []).some((s) => istGeaendert(s) || hatLehrerAufgabe(s));
    knopf.innerHTML =
      `<span class="kuerzel">${TAGE_KURZ[tagDatum.getDay()]}</span>` +
      `<span class="zahl">${tagDatum.getDate()}</span>` +
      `<span class="punkt${auffaellig ? '' : ' unsichtbar'}"></span>`;
    knopf.addEventListener('click', () => waehle(schluesselDatum));
    leiste.append(knopf);
  }
}

// ------------------------------------------------------------- Tagesansicht

function heroKarte(stunden, jetztMin) {
  const kommend = stunden.filter((s) => !istEntfall(s));
  const laufend = kommend.find((s) => jetztMin >= minuten(s.von) && jetztMin < minuten(s.bis));
  const naechste = kommend.find((s) => minuten(s.von) > jetztMin);
  const s = laufend ?? naechste;
  if (!s) return null;

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'hero';
  el.style.setProperty('--fach-farbe', farbeVon(s.farbe));

  let label;
  let balken = '';
  if (laufend) {
    const gesamt = minuten(s.bis) - minuten(s.von);
    const um = jetztMin - minuten(s.von);
    label = `<span class="hero-label live">Jetzt · noch ${gesamt - um} Min</span>`;
    balken = `<div class="hero-balken"><div style="width:${Math.round((um / gesamt) * 100)}%"></div></div>`;
  } else {
    const inMin = minuten(s.von) - jetztMin;
    label = `<span class="hero-label">${inMin <= 90 ? `Gleich · in ${inMin} Min` : `Als Nächstes · ${s.von} Uhr`}</span>`;
  }

  const teile = [s.lehrerLang || s.lehrer, s.raum, `${s.block} Stunde`].filter(Boolean).join(' · ');
  el.innerHTML =
    `${label}` +
    `<h2 class="hero-fach">${symbolFuer(s.fachName, { groesse: 24, strich: 1.9 })}${s.fachName || s.kurs}</h2>` +
    `<p class="hero-zeile">${teile}</p>${balken}`;
  el.addEventListener('click', () => oeffneStunde(s));
  return el;
}

function stundenKarte(s, jetztMin, istHeute) {
  const wrapper = document.createElement('article');
  wrapper.className = 'stunde';
  wrapper.style.setProperty('--fach-farbe', farbeVon(s.farbe));
  if (istEntfall(s)) wrapper.classList.add('entfaellt');

  const laeuft = istHeute && !istEntfall(s) && jetztMin >= minuten(s.von) && jetztMin < minuten(s.bis);
  if (laeuft) wrapper.classList.add('jetzt');

  const zeit = document.createElement('div');
  zeit.className = 'stunde-zeit';
  zeit.innerHTML =
    `<span class="stunde-block">${s.block || ''}</span>` +
    `<span class="stunde-uhr">${s.von}</span>` +
    `<span class="stunde-uhr bis">${s.bis}</span>`;

  const karte = document.createElement('div');
  karte.className = 'karte';

  const kopf = document.createElement('div');
  kopf.className = 'karte-kopf';
  kopf.innerHTML =
    `<h2 class="fach">${symbolFuer(s.fachName, { groesse: 16, strich: 1.9 })}${s.fachName || s.kurs || 'Termin'}</h2>` +
    (s.niveau ? `<span class="niveau">${s.niveau}</span>` : '') +
    (laeuft ? `<span class="rest">noch ${minuten(s.bis) - jetztMin} Min</span>` : '');

  const zeile = document.createElement('p');
  zeile.className = 'karte-zeile';
  const stuecke = [];
  if (s.lehrerErsetzt) {
    stuecke.push(`<span class="durchgestrichen">${s.lehrerErsetzt}</span>`);
    stuecke.push(`<span>${s.lehrerLang || s.lehrer || 'ohne Lehrkraft'}</span>`);
  } else if (s.lehrerLang || s.lehrer) {
    stuecke.push(`<span>${s.lehrerLang || s.lehrer}</span>`);
  }
  if (s.raum || s.raumErsetzt) {
    if (stuecke.length) stuecke.push('<span class="trenner">·</span>');
    if (s.raumErsetzt) stuecke.push(`<span class="durchgestrichen">${s.raumErsetzt}</span>`);
    if (s.raum) stuecke.push(`<span>${s.raum}</span>`);
  }
  zeile.innerHTML = stuecke.join('');

  karte.append(kopf, zeile);

  const marke = document.createElement('span');
  if (istEntfall(s)) {
    marke.className = 'marke entfall';
    marke.textContent = s.eva ? 'Entfällt · ohne Lehrkraft' : 'Entfällt';
  } else if (istVertretung(s)) {
    marke.className = 'marke vertretung';
    marke.textContent = s.lehrerErsetzt ? 'Vertretung' : 'Geändert';
  } else if (istRaumwechsel(s)) {
    marke.className = 'marke raum';
    marke.textContent = 'Raumwechsel';
  } else if (!s.kurs) {
    marke.className = 'marke termin';
    marke.textContent = 'Termin';
  }
  if (marke.className) karte.append(marke);

  // Nur ein dezentes Zeichen - die Inhalte stehen im geöffneten Fenster.
  const eigenes = hatEigenes(s);
  if (hatLehrerAufgabe(s) || eigenes.aufgabe || eigenes.notiz) {
    const zeichen = document.createElement('div');
    zeichen.className = 'karte-zeichen';
    if (hatLehrerAufgabe(s) || eigenes.aufgabe) zeichen.innerHTML += '<span class="punkt-aufgabe"></span>';
    if (eigenes.notiz) zeichen.innerHTML += '<span class="punkt-notiz"></span>';
    karte.append(zeichen);
  }

  karte.addEventListener('click', () => oeffneStunde(s));

  wrapper.append(zeit, karte);
  return wrapper;
}

function zeichneTag(ziel) {
  ziel.textContent = '';

  const offen = (zustand.plan?.aenderungen ?? []).filter((a) => !zustand.gelesen.has(kennung(a)));
  if (offen.length) ziel.append(banner(offen));

  const tag = tagFinden(zustand.gewaehlt);
  const istHeute = iso(new Date()) === zustand.gewaehlt;
  const jetzt = new Date();
  const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes();

  zeichneFortschritt(tag, istHeute, jetztMin);

  if (!tag) {
    ziel.append(leerHinweis('Kein Plan', 'Für diesen Tag liegen keine Daten vor.'));
    return;
  }
  if (!tag.stunden.length) {
    const woche = wocheFinden(tag.datum);
    ziel.append(
      woche && !woche.veroeffentlicht
        ? leerHinweis('Noch kein Plan', 'Diese Woche ist in WebUntis noch nicht veröffentlicht.')
        : leerHinweis('Schulfrei', 'An diesem Tag hast du keinen Unterricht.')
    );
    return;
  }

  const stunden = fasseTermineZusammen(tag.stunden);

  const hero = istHeute ? heroKarte(stunden, jetztMin) : null;
  if (hero) ziel.append(hero);

  let jetztGesetzt = !!hero;

  stunden.forEach((s, i) => {
    if (istHeute && !jetztGesetzt && jetztMin < minuten(s.von)) {
      ziel.append(jetztLinie(jetzt));
      jetztGesetzt = true;
    }
    const karte = stundenKarte(s, jetztMin, istHeute);
    if (istHeute && minuten(s.bis) <= jetztMin) karte.classList.add('vorbei');
    ziel.append(karte);

    const naechste = stunden[i + 1];
    if (naechste) {
      const luecke = minuten(naechste.von) - minuten(s.bis);
      const sinnvoll = !(istEntfall(s) && istEntfall(naechste));
      if (luecke >= 10 && sinnvoll) ziel.append(pause(luecke));
    }
  });

  if (istHeute && !jetztGesetzt) {
    const letzteEnde = stunden.reduce((m, s) => Math.max(m, minuten(s.bis)), 0);
    if (jetztMin >= letzteEnde) ziel.append(jetztLinie(jetzt));
  }
}

function pause(dauer) {
  const el = document.createElement('div');
  el.className = `pause${dauer >= 60 ? ' lang' : ''}`;
  const stunden = Math.floor(dauer / 60);
  const rest = dauer % 60;
  const text = stunden ? `${stunden} Std${rest ? ` ${rest} Min` : ''}` : `${dauer} Min`;
  el.innerHTML = `<div></div><div class="pause-text">${dauer >= 60 ? 'Mittagspause' : 'Pause'} · ${text}</div>`;
  return el;
}

function jetztLinie(jetzt) {
  const el = document.createElement('div');
  el.className = 'jetzt-linie';
  const uhr = `${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}`;
  el.innerHTML = `<div class="jetzt-uhr">${uhr}</div><div class="jetzt-strich"></div>`;
  return el;
}

function leerHinweis(titel, text) {
  const el = document.createElement('div');
  el.className = 'leer-tag';
  el.innerHTML = `<div class="gross">${titel}</div><div>${text}</div>`;
  return el;
}

const kennung = (a) => `${a.datum}|${a.kurs}|${a.art}|${a.text}`;

function banner(aenderungen) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'banner';
  const liste = aenderungen
    .slice(0, 5)
    .map((a) => {
      const d = alsDatum(a.datum);
      return `<li>${TAGE_KURZ[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}. · ${a.text}</li>`;
    })
    .join('');
  el.innerHTML =
    `<div class="banner-titel">${aenderungen.length} ${aenderungen.length === 1 ? 'Änderung' : 'Änderungen'} seit deinem letzten Blick</div>` +
    `<ul class="banner-liste">${liste}${aenderungen.length > 5 ? `<li>und ${aenderungen.length - 5} weitere</li>` : ''}</ul>`;
  el.addEventListener('click', () => {
    for (const a of aenderungen) zustand.gelesen.add(kennung(a));
    localStorage.setItem('gelesen', JSON.stringify([...zustand.gelesen].slice(-200)));
    zeichnen();
  });
  return el;
}

// ----------------------------------------------------------- Wochenansicht

const blockIndex = (s) => DOPPELBLOECKE.findIndex((b) => s.von >= b.von && s.von < b.bis);

/**
 * Weiche Trennstellen für die schmalen Wochenzellen. Die automatische
 * Silbentrennung ist je nach Gerät unzuverlässig - diese Liste nicht.
 */
const TRENNUNGEN = {
  Geschichte: 'Ge­schich­te',
  Mathematik: 'Ma­the­ma­tik',
  Seminarfach: 'Se­mi­nar­fach',
  Erdkunde: 'Erd­kun­de',
  Biologie: 'Bio­lo­gie',
  Englisch: 'Eng­lisch',
};
const trenne = (name) => TRENNUNGEN[name] ?? name;

function zeichneWoche(ziel) {
  ziel.textContent = '';
  ziel.classList.add('woche-modus');
  $('tagesFortschritt').hidden = true;

  const offen = (zustand.plan?.aenderungen ?? []).filter((a) => !zustand.gelesen.has(kennung(a)));
  if (offen.length) ziel.append(banner(offen));

  const woche = wocheFinden(zustand.gewaehlt);
  if (!woche) {
    ziel.append(leerHinweis('Kein Plan', 'Für diese Woche liegen keine Daten vor.'));
    return;
  }
  if (!woche.veroeffentlicht) {
    ziel.append(leerHinweis('Noch kein Plan', 'Diese Woche ist in WebUntis noch nicht veröffentlicht.'));
    return;
  }

  const kursstundenVon = (tag) => tag.stunden.filter((s) => s.kurs);
  const termineVon = (tag) => tag.stunden.filter((s) => !s.kurs);

  const benutzt = new Set();
  for (const tag of woche.tage) {
    for (const s of kursstundenVon(tag)) {
      const i = blockIndex(s);
      if (i >= 0) benutzt.add(i);
    }
  }
  const zeilen = DOPPELBLOECKE.map((b, i) => ({ ...b, index: i })).filter((b) => benutzt.has(b.index));

  const raster = document.createElement('div');
  raster.className = 'raster';
  raster.style.gridTemplateRows = `auto repeat(${zeilen.length}, 1fr)`;

  const heute = iso(new Date());
  const jetzt = new Date();
  const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes();
  const heuteSpalte = woche.tage.findIndex((t) => t.datum === heute);

  // WICHTIG: Jedes Feld bekommt seine Position ausdruecklich zugewiesen.
  // Die farbige Heute-Bahn belegt sonst eine Zelle im automatischen Fluss
  // und schiebt alle folgenden Felder um eins weiter - dann landet Freitag
  // in der naechsten Zeile ganz links.
  const setzePlatz = (el, spalte, zeile, zeilenSpanne = 1) => {
    el.style.gridColumn = String(spalte);
    el.style.gridRow = zeilenSpanne === 1 ? String(zeile) : `${zeile} / span ${zeilenSpanne}`;
  };

  // Farbige Bahn hinter der heutigen Spalte - hebt den Tag klar hervor.
  if (heuteSpalte >= 0) {
    const bahn = document.createElement('div');
    bahn.className = 'heute-bahn';
    setzePlatz(bahn, heuteSpalte + 2, 1, zeilen.length + 1);
    raster.append(bahn);
  }

  const ecke = document.createElement('div');
  setzePlatz(ecke, 1, 1);
  raster.append(ecke);

  woche.tage.forEach((tag, tagIndex) => {
    const kopf = document.createElement('button');
    kopf.type = 'button';
    kopf.className = 'raster-kopf';
    if (tag.datum === heute) kopf.classList.add('raster-heute');
    const d = alsDatum(tag.datum);
    kopf.innerHTML = `<span class="rk-tag">${TAGE_KURZ[d.getDay()]}</span><span class="rk-datum">${d.getDate()}.</span>`;
    kopf.addEventListener('click', () => {
      zustand.gewaehlt = tag.datum;
      setzeAnsicht('tag');
    });
    setzePlatz(kopf, tagIndex + 2, 1);
    raster.append(kopf);
  });

  zeilen.forEach((zeile, zeilenIndex) => {
    const zeit = document.createElement('div');
    zeit.className = 'raster-zeit';
    zeit.innerHTML = `<span class="rz-block">${zeile.name}</span><span class="rz-uhr">${zeile.von}</span>`;
    setzePlatz(zeit, 1, zeilenIndex + 2);
    raster.append(zeit);

    woche.tage.forEach((tag, tagIndex) => {
      const s = kursstundenVon(tag).find((x) => blockIndex(x) === zeile.index);
      const zelle = document.createElement(s ? 'button' : 'div');
      zelle.className = 'zelle';
      if (tag.datum === heute) zelle.classList.add('heute-spalte');
      setzePlatz(zelle, tagIndex + 2, zeilenIndex + 2);
      if (!s) {
        zelle.classList.add('frei');
        raster.append(zelle);
        return;
      }
      zelle.type = 'button';
      zelle.style.setProperty('--fach-farbe', farbeVon(s.farbe));
      if (istEntfall(s)) zelle.classList.add('z-entfall');
      else if (istGeaendert(s)) zelle.classList.add('z-geaendert');

      if (tag.datum === heute && !istEntfall(s) && jetztMin >= minuten(s.von) && jetztMin < minuten(s.bis)) {
        zelle.classList.add('z-jetzt');
      }

      const eigenes = hatEigenes(s);
      zelle.innerHTML =
        `<span class="z-symbol">${symbolFuer(s.fachName, { groesse: 15, strich: 1.9 })}</span>` +
        `<span class="z-fach">${trenne(s.fachName || s.kurs)}</span>` +
        `<span class="z-detail">${[s.raum, s.lehrer].filter(Boolean).join(' · ')}</span>` +
        (hatLehrerAufgabe(s) || eigenes.aufgabe || eigenes.notiz ? '<span class="z-punkt"></span>' : '');
      zelle.addEventListener('click', () => oeffneStunde(s));
      raster.append(zelle);
    });
  });

  ziel.append(raster);

  // Termine je Name buendeln: "Studienwoche 12" steht in Untis vierzehnmal
  // in der Woche - hier wird daraus ein Eintrag mit den betroffenen Tagen.
  const gebuendelt = new Map();
  for (const tag of woche.tage) {
    for (const termin of fasseTermineZusammen(termineVon(tag))) {
      if (!gebuendelt.has(termin.fachName)) {
        gebuendelt.set(termin.fachName, { tage: [], erster: termin });
      }
      const eintrag = gebuendelt.get(termin.fachName);
      if (!eintrag.tage.includes(tag.datum)) eintrag.tage.push(tag.datum);
    }
  }

  if (gebuendelt.size) {
    const leiste = document.createElement('div');
    leiste.className = 'termin-leiste';
    for (const [name, { tage, erster }] of gebuendelt) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'termin-chip';
      const tageText =
        tage.length >= 5
          ? 'Ganze Woche'
          : tage.map((d) => TAGE_KURZ[alsDatum(d).getDay()]).join(' ');
      chip.textContent = `${tageText} · ${name}`;
      chip.addEventListener('click', () => oeffneStunde(erster));
      leiste.append(chip);
    }
    ziel.append(leiste);
  }
}

// ------------------------------------------------------- Geöffnete Stunde

let offeneStunde = null;

function oeffneStunde(s) {
  offeneStunde = s;
  const eigene = eintragVon(s);
  const d = alsDatum(s.datum);

  const karte = document.querySelector('#stundeModal .modal-karte');
  karte.style.setProperty('--fach-farbe', farbeVon(s.farbe));

  $('modalBlock').textContent = `${TAGE_KURZ[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}. · ${s.block} Stunde · ${s.von}–${s.bis}`;
  $('modalFach').innerHTML = `${symbolFuer(s.fachName, { groesse: 24, strich: 1.9 })}${s.fachName || s.kurs || 'Termin'}`;
  $('modalFach').classList.toggle('entfaellt', istEntfall(s));

  const teile = [];
  if (s.lehrerLang || s.lehrer) teile.push(s.lehrerErsetzt ? `${s.lehrerLang || s.lehrer} (statt ${s.lehrerErsetzt})` : s.lehrerLang || s.lehrer);
  if (s.raum) teile.push(s.raumErsetzt ? `Raum ${s.raum} (statt ${s.raumErsetzt})` : `Raum ${s.raum}`);
  if (s.niveau) teile.push(s.niveau === 'eA' ? 'erhöhtes Niveau' : 'grundlegendes Niveau');
  $('modalZeile').textContent = teile.join(' · ');

  const marke = $('modalMarke');
  if (istEntfall(s)) {
    marke.className = 'marke entfall';
    marke.textContent = s.eva ? 'Entfällt – Lehrkraft fehlt, nichts wird vertreten' : 'Diese Stunde entfällt';
    marke.hidden = false;
  } else if (istVertretung(s)) {
    marke.className = 'marke vertretung';
    marke.textContent = s.lehrerErsetzt ? 'Vertretung' : 'Geändert';
    marke.hidden = false;
  } else if (istRaumwechsel(s)) {
    marke.className = 'marke raum';
    marke.textContent = 'Raumwechsel';
    marke.hidden = false;
  } else {
    marke.hidden = true;
  }

  const bereich = $('modalAufgaben');
  bereich.textContent = '';
  bereich.style.setProperty('--fach-farbe', farbeVon(s.farbe));
  for (const a of s.aufgaben ?? []) {
    const el = document.createElement('div');
    el.className = 'notiz-anzeige';
    el.innerHTML = '<span class="notiz-kopf">Hausaufgabe von der Lehrkraft</span>';
    el.append(document.createTextNode(a.text || a.anmerkung || '—'));
    if (a.anmerkung && a.text) {
      const zusatz = document.createElement('span');
      zusatz.className = 'notiz-quelle';
      zusatz.textContent = a.anmerkung;
      el.append(zusatz);
    }
    bereich.append(el);
  }
  if (s.text && !s.kurs) {
    const el = document.createElement('div');
    el.className = 'notiz-anzeige';
    el.innerHTML = '<span class="notiz-kopf">Hinweis</span>';
    el.append(document.createTextNode(s.text));
    bereich.append(el);
  }

  $('notizAufgabe').value = eigene.aufgabe ?? '';
  $('notizText').value = eigene.notiz ?? '';

  $('stundeModal').hidden = false;
  $('modalHintergrund').hidden = false;
}

async function schliesseStunde({ speichernJa = true, loeschen = false } = {}) {
  if (offeneStunde && (speichernJa || loeschen)) {
    const id = notizId(offeneStunde);
    const vorhanden = zustand.meineDaten.notizen[id] ?? {};
    const aufgabe = $('notizAufgabe').value.trim();
    const notiz = $('notizText').value.trim();

    if (loeschen) {
      delete zustand.meineDaten.notizen[id];
    } else if (!aufgabe && !notiz) {
      // Erledigt-Haken der Lehrer-Aufgaben behalten, auch ohne eigenen Text.
      const rest = Object.fromEntries(Object.entries(vorhanden).filter(([k]) => k.startsWith('erledigt_')));
      if (Object.keys(rest).length) zustand.meineDaten.notizen[id] = rest;
      else delete zustand.meineDaten.notizen[id];
    } else {
      zustand.meineDaten.notizen[id] = { ...vorhanden, aufgabe, notiz };
    }
    await speichern();
  }
  offeneStunde = null;
  $('stundeModal').hidden = true;
  $('modalHintergrund').hidden = true;
  zeichnen();
}

// ---------------------------------------------------------- Mitteilungen

const vapidBytes = (text) => {
  const gefuellt = (text + '='.repeat((4 - (text.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(gefuellt), (c) => c.charCodeAt(0));
};

const pushMoeglich = () =>
  VAPID_OEFFENTLICH && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let pushAn = false;

async function oeffnePush() {
  $('pushBlatt').hidden = false;
  $('blattHintergrund').hidden = false;
  $('pushDaten').hidden = true;
  $('pushKopieren').hidden = true;

  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installiert = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (iOS && !installiert) {
    $('pushStatus').textContent = 'Noch nicht möglich';
    $('pushHinweis').textContent =
      'Auf dem iPhone erlaubt Apple Mitteilungen nur, wenn die App über „Teilen → Zum Home-Bildschirm" installiert ist. Leg sie dort ab, öffne sie von dort und versuch es noch einmal.';
    return;
  }

  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== 'granted') {
    $('pushStatus').textContent = 'Nicht erlaubt';
    $('pushHinweis').textContent =
      'Du hast Mitteilungen abgelehnt. In den Einstellungen deines Geräts kannst du das für diese App wieder ändern.';
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const anmeldung =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidBytes(VAPID_OEFFENTLICH),
    }));

  pushAn = true;
  $('pushStatus').textContent = 'Mitteilungen sind erlaubt';
  $('pushHinweis').textContent = 'Diese Anmeldung muss einmal beim Server hinterlegt werden. Danach ist nichts mehr zu tun.';
  $('pushDaten').value = JSON.stringify(anmeldung.toJSON());
  $('pushDaten').hidden = false;
  $('pushKopieren').hidden = false;
}

async function pushStandPruefen() {
  if (!pushMoeglich()) return;
  try {
    // serviceWorker.ready wartet EWIG, wenn die Registrierung scheitert.
    // Deshalb mit Zeitgrenze - die App darf daran nie haengen bleiben.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((fertig) => setTimeout(() => fertig(null), 1500)),
    ]);
    const anmeldung = await reg?.pushManager?.getSubscription().catch(() => null);
    pushAn = !!anmeldung;
  } catch {
    pushAn = false;
  }
}

const pushStatusText = () =>
  !pushMoeglich() ? 'Auf diesem Gerät nicht verfügbar' : pushAn ? 'Aktiv' : 'Noch nicht eingerichtet';

const standText = () => (zustand.plan ? zeitstempel(zustand.plan.aktualisiert) : 'noch nicht geladen');

// ------------------------------------------------------------------ Steuerung

function waehle(datum) {
  zustand.gewaehlt = datum;
  zeichnen();
}

function setzeAnsicht(ansicht) {
  zustand.ansicht = ansicht;
  localStorage.setItem('ansicht', ansicht);
  zeichnen();
}

function setzeTab(tab) {
  zustand.tab = tab;
  // Bereichswechsel immer oben beginnen, nicht mitten im alten Inhalt.
  window.scrollTo({ top: 0 });
  for (const knopf of document.querySelectorAll('.tab')) {
    const aktiv = knopf.dataset.tab === tab;
    knopf.classList.toggle('aktiv', aktiv);
    if (aktiv) knopf.setAttribute('aria-current', 'page');
    else knopf.removeAttribute('aria-current');
  }
  zeichnen();
}

function zeichnen() {
  // Vor dem ersten geladenen Plan gibt es nichts zu zeichnen - sonst
  // rechnet die Kopfzeile mit einem leeren Datum ("undefined, NaN").
  if (!zustand.plan || !zustand.gewaehlt) return;

  zeichneKopf();

  const inhalt = $('inhalt');
  const schluesselJetzt = `${zustand.tab}|${zustand.ansicht}|${zustand.gewaehlt}`;
  const animieren = zeichnen.zuletzt !== schluesselJetzt;
  zeichnen.zuletzt = schluesselJetzt;
  inhalt.classList.toggle('ohne-animation', !animieren);
  inhalt.classList.remove('woche-modus');

  if (zustand.tab === 'aufgaben') zeichneAufgaben(inhalt);
  else if (zustand.tab === 'noten') zeichneNoten(inhalt);
  else if (zustand.tab === 'mehr') zeichneMehr(inhalt);
  else if (zustand.ansicht === 'woche') zeichneWoche(inhalt);
  else {
    zeichneTagesleiste();
    zeichneTag(inhalt);
  }

  // Lernetappen von heute zaehlen als offene Aufgaben mit.
  const offen = offeneAufgaben().length + lernenAm(iso(new Date())).length;
  $('tabPunktAufgaben').hidden = offen === 0;

  [...inhalt.children].forEach((el, i) => el.style.setProperty('--i', i));
}

/** Einen Schultag bzw. eine Woche vor oder zurück. */
function blaettern(richtung) {
  if (zustand.tab !== 'plan') return;
  if (zustand.ansicht === 'woche') {
    const wochen = zustand.plan?.wochen ?? [];
    const i = wochen.findIndex((w) => w.tage.some((t) => t.datum === zustand.gewaehlt));
    const ziel = wochen[i + richtung];
    if (ziel) waehle(ziel.tage[0].datum);
    return;
  }
  const tage = alleTage().filter((t) => t.stunden.length || t.datum === zustand.gewaehlt);
  const i = tage.findIndex((t) => t.datum === zustand.gewaehlt);
  const ziel = tage[i + richtung];
  if (ziel) waehle(ziel.datum);
}

function zeitstempel(wert) {
  const d = new Date(wert);
  const heute = new Date().toDateString() === d.toDateString();
  const uhr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return heute ? `Stand ${uhr} Uhr` : `Stand ${d.getDate()}.${d.getMonth() + 1}. ${uhr} Uhr`;
}

async function starten({ frisch = false, leise = false } = {}) {
  const knopf = $('aktualisieren');
  knopf.classList.add('dreht');
  try {
    const plan = await ladePlan({ frisch, leise });
    if (plan) zustand.plan = plan;
    try {
      zustand.meineDaten = await ladeMeineDaten(schluessel);
      zustand.datenGeladen = true;
    } catch (fehler) {
      // Eigene Daten nicht lesbar: den bisherigen Stand behalten und auf
      // keinen Fall speichern - lieber diesmal ohne Noten und Aufgaben.
      console.warn('Eigene Daten konnten nicht geladen werden:', fehler.message);
    }
    // Vergangene Schultage in die Stundenstatistik aufnehmen (Basis der Fehlquote).
    if (aktualisiereStundenZaehler() > 0) await speichern();
    zustand.gewaehlt ??= startTag();
    if (!tagFinden(zustand.gewaehlt)) zustand.gewaehlt = startTag();
    zeichnen();
    // Push-Status im Hintergrund nachreichen - blockiert die Anzeige nicht.
    pushStandPruefen().then(() => {
      if (zustand.tab === 'mehr') zeichnen();
    });
  } catch (error) {
    if (!zustand.plan) {
      $('inhalt').textContent = '';
      $('inhalt').append(leerHinweis('Keine Daten', error.message));
    }
  } finally {
    knopf.classList.remove('dreht');
  }
}

// Alles, was die anderen Bereiche von hier brauchen.
/** Abmelden: Schluessel verwerfen, damit die Anmeldung wieder erscheint. */
async function abmelden() {
  await schluesselVergessen();
  schluessel = null;
  zustand.plan = null;
  zustand.gewaehlt = null;
  zeichnen.zuletzt = null;
  zustand.meineDaten = LEER();
  zustand.datenGeladen = false;
  $('inhalt').textContent = '';
  await starten();
  setzeTab('plan'); // nach dem Wechsel wieder beim Stundenplan anfangen
}

initBereiche({
  zustand,
  iso,
  minuten,
  abmelden,
  personName: () => BENUTZER[person].name,
  alleTage,
  notizId,
  speichern,
  zeichnen,
  oeffneStunde,
  oeffnePush,
  pushStatusText,
  standText,
  starten,
  version: APP_VERSION,
});

// ----------------------------------------------------------------- Ereignisse

$('aktualisieren').addEventListener('click', () => starten({ frisch: true }));
$('ansichtTag').addEventListener('click', () => setzeAnsicht('tag'));
$('ansichtWoche').addEventListener('click', () => setzeAnsicht('woche'));

for (const knopf of document.querySelectorAll('.tab')) {
  knopf.addEventListener('click', () => setzeTab(knopf.dataset.tab));
}

$('notizSichern').addEventListener('click', () => schliesseStunde());
$('notizLoeschen').addEventListener('click', () => schliesseStunde({ loeschen: true }));
$('modalSchliessen').addEventListener('click', () => schliesseStunde());

$('eingabeSichern').addEventListener('click', () => schliesseEingabe({ sichern: true }));
$('eingabeLoeschen').addEventListener('click', () => schliesseEingabe({ loeschen: true }));
$('eingabeSchliessen').addEventListener('click', () => schliesseEingabe());

$('modalHintergrund').addEventListener('click', () => {
  if (eingabeOffen()) schliesseEingabe();
  else schliesseStunde();
});

$('pushSchliessen').addEventListener('click', () => {
  $('pushBlatt').hidden = true;
  $('blattHintergrund').hidden = true;
  pushStandPruefen().then(zeichnen);
});
$('pushKopieren').addEventListener('click', async () => {
  const feld = $('pushDaten');
  try {
    await navigator.clipboard.writeText(feld.value);
    $('pushKopieren').textContent = 'Kopiert ✓';
  } catch {
    feld.select();
    $('pushKopieren').textContent = 'Bitte von Hand kopieren';
  }
});
$('blattHintergrund').addEventListener('click', () => $('pushSchliessen').click());

/** Ist gerade ein Fenster offen? Dann darf Wischen nicht blättern. */
const fensterOffen = () =>
  !$('stundeModal').hidden || !$('eingabeModal').hidden || !$('pushBlatt').hidden || !$('sperre').hidden;

let startX = 0;
let startY = 0;
document.addEventListener('touchstart', (e) => {
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (fensterOffen()) return;
  const dx = e.changedTouches[0].clientX - startX;
  const dy = e.changedTouches[0].clientY - startY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) blaettern(dx < 0 ? 1 : -1);
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (eingabeOffen()) schliesseEingabe();
    else if (offeneStunde) schliesseStunde();
    else if (!$('pushBlatt').hidden) $('pushSchliessen').click();
    return;
  }
  if (fensterOffen() || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
  if (e.key === 'ArrowRight') blaettern(1);
  if (e.key === 'ArrowLeft') blaettern(-1);
});

// Beim Zurückkehren zur App neu laden und nach einer neuen Version suchen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
  if (!fensterOffen()) starten({ frisch: true, leise: true });
});

// Sobald eine neue Version übernommen hat: einmal neu laden.
let einmalNeuGeladen = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (einmalNeuGeladen) return;
  einmalNeuGeladen = true;
  location.reload();
});

// Laufende Stunde und Jetzt-Linie aktuell halten
setInterval(() => {
  if (zustand.plan && zustand.tab === 'plan' && zustand.ansicht === 'tag' && iso(new Date()) === zustand.gewaehlt && !fensterOffen()) {
    zeichnen();
  }
}, 30_000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

setzeTab('plan');
starten();
