import { wochentyp, stundenBezeichnung, VAPID_OEFFENTLICH, DATEN_URL } from './shared/konfiguration.mjs?v=4';
import {
  schluesselAusCode,
  entschluesseln,
  verschluesseln,
  schluesselSichern,
  schluesselLaden,
  schluesselVergessen,
  b64,
} from './shared/krypto.mjs?v=4';

/** Sichtbare Versionsnummer - bei jedem Update zusammen mit ?v= hochzaehlen. */
const APP_VERSION = 4;

const $ = (id) => document.getElementById(id);
const TAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const TAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Lokales YYYY-MM-DD, nicht über toISOString (das rechnet nach UTC). */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const alsDatum = (s) => new Date(`${s}T12:00:00`);
const minuten = (uhr) => Number(uhr.slice(0, 2)) * 60 + Number(uhr.slice(3, 5));

const zustand = {
  plan: null,
  gewaehlt: null, // YYYY-MM-DD
  ansicht: localStorage.getItem('ansicht') === 'woche' ? 'woche' : 'tag',
  gelesen: new Set(JSON.parse(localStorage.getItem('gelesen') ?? '[]')),
  notizen: {}, // "datum|von|kurs" -> { aufgabe, notiz }
};

let schluessel = null;

// ------------------------------------------------------------- Daten holen

async function holeRoh(frisch) {
  const anhang = frisch ? `?t=${Date.now()}` : '';
  const einstellung = { cache: frisch ? 'reload' : 'default' };

  // Bevorzugt aus der Cloud (immer aktuell, unabhaengig vom Deploy) ...
  if (DATEN_URL) {
    const cloud = await fetch(`${DATEN_URL}${anhang}`, einstellung).catch(() => null);
    if (cloud?.ok) return { verschluesselt: true, paket: await cloud.json() };
  }

  // ... sonst von der eigenen Adresse.
  const verschluesselt = await fetch(`data/plan.enc.json${anhang}`, einstellung).catch(() => null);
  if (verschluesselt?.ok) return { verschluesselt: true, paket: await verschluesselt.json() };

  const klar = await fetch(`data/plan.json${anhang}`, einstellung).catch(() => null);
  if (klar?.ok) return { verschluesselt: false, plan: await klar.json() };

  throw new Error('Plandaten sind nicht erreichbar.');
}

function frageCode({ fehler = false } = {}) {
  return new Promise((aufloesen) => {
    const form = $('sperreForm');
    const feld = $('sperreCode');
    const knopf = $('sperreKnopf');

    $('sperre').hidden = false;
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

async function ladePlan({ frisch = false } = {}) {
  const roh = await holeRoh(frisch);

  if (!roh.verschluesselt) {
    $('sperre').hidden = true;
    return roh.plan;
  }

  const salz = b64.aus(roh.paket.salz);
  schluessel ??= await schluesselLaden();
  let fehler = false;

  for (;;) {
    if (!schluessel) {
      const code = await frageCode({ fehler });
      schluessel = await schluesselAusCode(code, salz);
    }
    try {
      const plan = await entschluesseln(roh.paket, schluessel);
      await schluesselSichern(schluessel);
      $('sperre').hidden = true;
      return plan;
    } catch {
      schluessel = null;
      schluesselVergessen();
      fehler = true;
    }
  }
}

// -------------------------------------------------- Hausaufgaben & Notizen

const notizId = (s) => `${s.datum}|${s.von}|${s.kurs ?? 'TERMIN'}`;

async function ladeNotizen() {
  const roh = localStorage.getItem('notizen');
  if (!roh) return {};
  try {
    const inhalt = JSON.parse(roh);
    if (inhalt?.iv) return schluessel ? await entschluesseln(inhalt, schluessel) : {};
    return inhalt; // Klartext gibt es nur bei der lokalen Entwicklung
  } catch {
    return {};
  }
}

async function speichereNotizen() {
  const inhalt = schluessel ? await verschluesseln(zustand.notizen, schluessel) : zustand.notizen;
  localStorage.setItem('notizen', JSON.stringify(inhalt));
}

// ------------------------------------------------------------- Hilfsmittel

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

const hatEigenes = (s) => {
  const e = zustand.notizen[notizId(s)];
  return { aufgabe: !!e?.aufgabe, notiz: !!e?.notiz };
};
const hatLehrerAufgabe = (s) => (s.aufgaben ?? []).length > 0;

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

/** Zusammenfassung einer Woche für die Kopfzeile. */
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

  $('wocheAbzeichen').textContent = `${tag?.wochentyp ?? wochentyp(zustand.gewaehlt)}-Woche`;
  $('wocheAbzeichen').hidden = wochenModus;

  $('ansichtTag').classList.toggle('aktiv', !wochenModus);
  $('ansichtWoche').classList.toggle('aktiv', wochenModus);
  $('ansichtTag').setAttribute('aria-selected', String(!wochenModus));
  $('ansichtWoche').setAttribute('aria-selected', String(wochenModus));
  $('tagesleiste').hidden = wochenModus;
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
    `<h2 class="fach">${s.fachName || s.kurs || 'Termin'}</h2>` +
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
    marke.textContent = 'Entfällt';
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

function zeichneTag() {
  const inhalt = $('inhalt');
  inhalt.textContent = '';

  const offen = (zustand.plan?.aenderungen ?? []).filter((a) => !zustand.gelesen.has(kennung(a)));
  if (offen.length) inhalt.append(banner(offen));

  const tag = tagFinden(zustand.gewaehlt);
  const istHeute = iso(new Date()) === zustand.gewaehlt;
  const jetzt = new Date();
  const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes();

  if (!tag) {
    inhalt.append(leerHinweis('Kein Plan', 'Für diesen Tag liegen keine Daten vor.'));
    return;
  }
  if (!tag.stunden.length) {
    const woche = wocheFinden(tag.datum);
    inhalt.append(
      woche && !woche.veroeffentlicht
        ? leerHinweis('Noch kein Plan', 'Diese Woche ist in WebUntis noch nicht veröffentlicht.')
        : leerHinweis('Schulfrei', 'An diesem Tag hast du keinen Unterricht.')
    );
    return;
  }

  const stunden = [...tag.stunden].sort((a, b) => a.von.localeCompare(b.von));
  let jetztGesetzt = false;

  stunden.forEach((s, i) => {
    if (istHeute && !jetztGesetzt && jetztMin < minuten(s.von)) {
      inhalt.append(jetztLinie(jetzt));
      jetztGesetzt = true;
    }
    inhalt.append(stundenKarte(s, jetztMin, istHeute));

    const naechste = stunden[i + 1];
    if (naechste) {
      const luecke = minuten(naechste.von) - minuten(s.bis);
      if (luecke >= 20) inhalt.append(pause(luecke));
    }
  });

  if (istHeute && !jetztGesetzt) {
    const letzteEnde = stunden.reduce((m, s) => Math.max(m, minuten(s.bis)), 0);
    if (jetztMin >= letzteEnde) inhalt.append(jetztLinie(jetzt));
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

function zeichneWoche() {
  const inhalt = $('inhalt');
  inhalt.textContent = '';

  const offen = (zustand.plan?.aenderungen ?? []).filter((a) => !zustand.gelesen.has(kennung(a)));
  if (offen.length) inhalt.append(banner(offen));

  const woche = wocheFinden(zustand.gewaehlt);
  if (!woche) {
    inhalt.append(leerHinweis('Kein Plan', 'Für diese Woche liegen keine Daten vor.'));
    return;
  }
  if (!woche.veroeffentlicht) {
    inhalt.append(leerHinweis('Noch kein Plan', 'Diese Woche ist in WebUntis noch nicht veröffentlicht.'));
    return;
  }

  // Nur Blöcke zeigen, in denen überhaupt etwas stattfindet.
  const bloecke = [];
  for (const tag of woche.tage) {
    for (const s of tag.stunden) {
      const key = `${s.von}|${s.bis}`;
      if (!bloecke.some((b) => b.key === key)) {
        bloecke.push({ key, von: s.von, bis: s.bis, name: s.block || stundenBezeichnung(s.von, s.bis) });
      }
    }
  }
  bloecke.sort((a, b) => a.von.localeCompare(b.von));

  const raster = document.createElement('div');
  raster.className = 'raster';
  raster.append(document.createElement('div'));

  const heute = iso(new Date());
  for (const tag of woche.tage) {
    const kopf = document.createElement('div');
    kopf.className = 'raster-kopf';
    if (tag.datum === heute) kopf.classList.add('raster-heute');
    kopf.textContent = TAGE_KURZ[alsDatum(tag.datum).getDay()];
    raster.append(kopf);
  }

  for (const block of bloecke) {
    const zeit = document.createElement('div');
    zeit.className = 'raster-zeit';
    zeit.textContent = block.name;
    raster.append(zeit);

    for (const tag of woche.tage) {
      const s = tag.stunden.find((x) => x.von === block.von && x.bis === block.bis);
      const zelle = document.createElement('div');
      if (!s) {
        zelle.className = 'zelle frei';
        raster.append(zelle);
        continue;
      }
      zelle.className = 'zelle';
      zelle.style.setProperty('--fach-farbe', farbeVon(s.farbe));
      if (istEntfall(s)) zelle.classList.add('z-entfall');
      else if (istGeaendert(s)) zelle.classList.add('z-geaendert');

      const eigenes = hatEigenes(s);
      zelle.innerHTML =
        `<span class="z-fach">${s.kurs ?? '•'}</span>` +
        (s.raum ? `<span class="z-raum">${s.raum}</span>` : '') +
        (hatLehrerAufgabe(s) || eigenes.aufgabe || eigenes.notiz ? '<span class="z-punkt"></span>' : '');
      zelle.addEventListener('click', () => oeffneStunde(s));
      raster.append(zelle);
    }
  }

  inhalt.append(raster);

  const fuss = document.createElement('p');
  fuss.className = 'blatt-fuss';
  fuss.textContent = 'Tippe auf eine Stunde, um sie zu öffnen.';
  inhalt.append(fuss);
}

// ------------------------------------------------------- Geöffnete Stunde

let offeneStunde = null;

function oeffneStunde(s) {
  offeneStunde = s;
  const eigene = zustand.notizen[notizId(s)] ?? {};
  const d = alsDatum(s.datum);

  const karte = document.querySelector('.modal-karte');
  karte.style.setProperty('--fach-farbe', farbeVon(s.farbe));

  $('modalBlock').textContent = `${TAGE_KURZ[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}. · ${s.block} Stunde · ${s.von}–${s.bis}`;
  $('modalFach').textContent = s.fachName || s.kurs || 'Termin';
  $('modalFach').classList.toggle('entfaellt', istEntfall(s));

  const teile = [];
  if (s.lehrerLang || s.lehrer) teile.push(s.lehrerErsetzt ? `${s.lehrerLang || s.lehrer} (statt ${s.lehrerErsetzt})` : s.lehrerLang || s.lehrer);
  if (s.raum) teile.push(s.raumErsetzt ? `Raum ${s.raum} (statt ${s.raumErsetzt})` : `Raum ${s.raum}`);
  if (s.niveau) teile.push(s.niveau === 'eA' ? 'erhöhtes Niveau' : 'grundlegendes Niveau');
  $('modalZeile').textContent = teile.join(' · ');

  const marke = $('modalMarke');
  if (istEntfall(s)) {
    marke.className = 'marke entfall';
    marke.textContent = 'Diese Stunde entfällt';
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

  // Hausaufgaben, die die Lehrkraft in WebUntis eingetragen hat
  const bereich = $('modalAufgaben');
  bereich.textContent = '';
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

async function schliesseStunde({ speichern = true, loeschen = false } = {}) {
  if (offeneStunde && (speichern || loeschen)) {
    const id = notizId(offeneStunde);
    const aufgabe = $('notizAufgabe').value.trim();
    const notiz = $('notizText').value.trim();
    if (loeschen || (!aufgabe && !notiz)) delete zustand.notizen[id];
    else zustand.notizen[id] = { aufgabe, notiz };
    await speichereNotizen();
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

  $('pushStatus').textContent = 'Mitteilungen sind erlaubt';
  $('pushHinweis').textContent = 'Diese Anmeldung muss einmal beim Server hinterlegt werden. Danach ist nichts mehr zu tun.';
  $('pushDaten').value = JSON.stringify(anmeldung.toJSON());
  $('pushDaten').hidden = false;
  $('pushKopieren').hidden = false;
}

async function pushKnopfAktualisieren() {
  const knopf = $('mitteilungen');
  if (!pushMoeglich()) {
    knopf.hidden = true;
    return;
  }
  knopf.hidden = false;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const anmeldung = await reg?.pushManager.getSubscription().catch(() => null);
  knopf.textContent = anmeldung ? 'Mitteilungen ✓' : 'Mitteilungen';
}

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

function zeichnen() {
  zeichneKopf();
  if (zustand.ansicht === 'woche') {
    zeichneWoche();
  } else {
    zeichneTagesleiste();
    zeichneTag();
  }
}

/** Einen Schultag bzw. eine Woche vor oder zurück. */
function blaettern(richtung) {
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

async function starten({ frisch = false } = {}) {
  const knopf = $('aktualisieren');
  knopf.disabled = true;
  knopf.textContent = 'Lade …';
  try {
    zustand.plan = await ladePlan({ frisch });
    zustand.notizen = await ladeNotizen();
    zustand.gewaehlt ??= startTag();
    if (!tagFinden(zustand.gewaehlt)) zustand.gewaehlt = startTag();
    $('stand').textContent = `${zeitstempel(zustand.plan.aktualisiert)} · v${APP_VERSION}`;
    zeichnen();
  } catch (error) {
    $('inhalt').textContent = '';
    $('inhalt').append(leerHinweis('Keine Daten', error.message));
  } finally {
    knopf.disabled = false;
    knopf.textContent = 'Aktualisieren';
  }
}

$('aktualisieren').addEventListener('click', () => starten({ frisch: true }));
$('ansichtTag').addEventListener('click', () => setzeAnsicht('tag'));
$('ansichtWoche').addEventListener('click', () => setzeAnsicht('woche'));

$('notizSichern').addEventListener('click', () => schliesseStunde());
$('notizLoeschen').addEventListener('click', () => schliesseStunde({ loeschen: true }));
$('modalSchliessen').addEventListener('click', () => schliesseStunde());
$('modalHintergrund').addEventListener('click', () => schliesseStunde());

$('mitteilungen').addEventListener('click', () =>
  oeffnePush().catch((fehler) => {
    $('pushStatus').textContent = 'Fehler';
    $('pushHinweis').textContent = fehler.message;
  })
);
$('pushSchliessen').addEventListener('click', () => {
  $('pushBlatt').hidden = true;
  $('blattHintergrund').hidden = true;
  pushKnopfAktualisieren();
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
const fensterOffen = () => !$('stundeModal').hidden || !$('pushBlatt').hidden || !$('sperre').hidden;

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
    if (offeneStunde) schliesseStunde();
    else if (!$('pushBlatt').hidden) $('pushSchliessen').click();
    return;
  }
  if (fensterOffen() || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
  if (e.key === 'ArrowRight') blaettern(1);
  if (e.key === 'ArrowLeft') blaettern(-1);
});

// Beim Zurückkehren zur App neu laden - das ist der "prüft beim Öffnen"-Teil.
// Gleichzeitig nach einer neuen App-Version suchen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
  if (!fensterOffen()) starten({ frisch: true });
});

// Sobald eine neue Version uebernommen hat: einmal neu laden, damit alle
// Teile (HTML, Skript, Styles) garantiert zusammenpassen.
let einmalNeuGeladen = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (einmalNeuGeladen) return;
  einmalNeuGeladen = true;
  location.reload();
});

// Laufende Stunde und Jetzt-Linie aktuell halten
setInterval(() => {
  if (zustand.plan && zustand.ansicht === 'tag' && iso(new Date()) === zustand.gewaehlt && !fensterOffen()) {
    zeichneTag();
  }
}, 30_000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(pushKnopfAktualisieren).catch(() => {});
}

starten();
