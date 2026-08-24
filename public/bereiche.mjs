// Die drei Bereiche neben dem Stundenplan: Aufgaben, Noten, Mehr.
// Bekommt beim Start alles Noetige von app.js uebergeben - so gibt es
// keine gegenseitigen Importe zwischen den Dateien.
import { KURSE } from './shared/konfiguration.mjs?v=11';
import { symbolFuer } from './symbole.mjs?v=11';
import { neueId } from './daten.mjs?v=11';

let A = null; // die von app.js gereichten Hilfsmittel
export function initBereiche(api) {
  A = api;
}

const $ = (id) => document.getElementById(id);
const kursVon = (kuerzel) => KURSE.find((k) => k.kuerzel === kuerzel) ?? null;
const farbeVon = (name) => `var(--fl-${name ?? 'grau'})`;

// ------------------------------------------------------------- Datumshilfen

const heute = () => A.iso(new Date());
const tageBis = (datum) =>
  Math.round((new Date(`${datum}T12:00:00`) - new Date(`${heute()}T12:00:00`)) / 864e5);

function datumText(datum) {
  const abstand = tageBis(datum);
  if (abstand === 0) return 'Heute';
  if (abstand === 1) return 'Morgen';
  if (abstand === -1) return 'Gestern';
  const d = new Date(`${datum}T12:00:00`);
  const wochentag = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
  return `${wochentag}, ${d.getDate()}.${d.getMonth() + 1}.`;
}

const restText = (abstand) =>
  abstand === 0 ? 'heute' : abstand === 1 ? 'morgen' : abstand < 0 ? `vor ${-abstand} Tagen` : `in ${abstand} Tagen`;

// -------------------------------------------------- Allzweck-Eingabefenster

let eingabeStand = null;

/**
 * Oeffnet das generische Eingabefenster.
 * felder: [{ name, label, typ, optionen?, wert?, pflicht? }]
 */
export function oeffneEingabe({ titel, unterzeile = '', felder, beimSichern, beimLoeschen = null }) {
  eingabeStand = { felder, beimSichern, beimLoeschen };

  $('eingabeTitel').textContent = titel;
  $('eingabeUnterzeile').textContent = unterzeile;
  $('eingabeLoeschen').hidden = !beimLoeschen;

  const behaelter = $('eingabeFelder');
  behaelter.textContent = '';

  for (const feld of felder) {
    const marke = document.createElement('label');
    marke.className = 'notiz-label';
    marke.textContent = feld.label;
    marke.htmlFor = `eingabe_${feld.name}`;
    behaelter.append(marke);

    if (feld.typ === 'auswahl') {
      const reihe = document.createElement('div');
      reihe.className = 'auswahl-reihe';
      reihe.id = `eingabe_${feld.name}`;
      for (const option of feld.optionen) {
        const knopf = document.createElement('button');
        knopf.type = 'button';
        knopf.className = `auswahl-knopf${option.wert === feld.wert ? ' aktiv' : ''}`;
        knopf.dataset.wert = option.wert;
        knopf.textContent = option.text;
        knopf.addEventListener('click', () => {
          for (const g of reihe.children) g.classList.remove('aktiv');
          knopf.classList.add('aktiv');
        });
        reihe.append(knopf);
      }
      behaelter.append(reihe);
      continue;
    }

    const eingabe = document.createElement('input');
    eingabe.id = `eingabe_${feld.name}`;
    eingabe.className = 'notiz-feld';
    eingabe.value = feld.wert ?? '';
    if (feld.typ === 'zahl') {
      eingabe.type = 'number';
      eingabe.min = feld.min ?? 0;
      eingabe.max = feld.max ?? 15;
      eingabe.inputMode = 'numeric';
    } else if (feld.typ === 'datum') {
      eingabe.type = 'date';
    } else {
      eingabe.type = 'text';
      eingabe.placeholder = feld.platzhalter ?? '';
    }
    behaelter.append(eingabe);
  }

  $('eingabeModal').hidden = false;
  $('modalHintergrund').hidden = false;
}

export function schliesseEingabe({ sichern = false, loeschen = false } = {}) {
  if (!eingabeStand) return;
  const { felder, beimSichern, beimLoeschen } = eingabeStand;

  if (loeschen && beimLoeschen) {
    beimLoeschen();
  } else if (sichern) {
    const werte = {};
    for (const feld of felder) {
      const el = $(`eingabe_${feld.name}`);
      werte[feld.name] =
        feld.typ === 'auswahl'
          ? el.querySelector('.auswahl-knopf.aktiv')?.dataset.wert ?? feld.wert
          : el.value.trim();
    }
    // Pflichtfelder pruefen - lieber offen lassen als Unsinn speichern.
    const fehlt = felder.find((f) => f.pflicht && !werte[f.name]);
    if (fehlt) {
      $(`eingabe_${fehlt.name}`).focus();
      return;
    }
    beimSichern(werte);
  }

  eingabeStand = null;
  $('eingabeModal').hidden = true;
  $('modalHintergrund').hidden = true;
}

export const eingabeOffen = () => eingabeStand !== null;

// ------------------------------------------------------------ Bausteine

function ueberschrift(text, knopfText = null, beiKlick = null) {
  const zeile = document.createElement('div');
  zeile.className = 'abschnitt-kopf';
  const h = document.createElement('h2');
  h.textContent = text;
  zeile.append(h);
  if (knopfText) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'abschnitt-knopf';
    knopf.textContent = knopfText;
    knopf.addEventListener('click', beiKlick);
    zeile.append(knopf);
  }
  return zeile;
}

function leerBox(titel, text) {
  const el = document.createElement('div');
  el.className = 'leer-box';
  el.innerHTML = `<div class="leer-gross">${titel}</div><div>${text}</div>`;
  return el;
}

// ============================================================== AUFGABEN

/** Sammelt alle Hausaufgaben: von Lehrern aus WebUntis und eigene Eintraege. */
export function alleAufgaben() {
  const liste = [];
  for (const tag of A.alleTage()) {
    for (const s of tag.stunden) {
      if (!s.kurs) continue;
      const id = A.notizId(s);
      const eigene = A.zustand.meineDaten.notizen[id] ?? {};

      for (const [i, a] of (s.aufgaben ?? []).entries()) {
        if (!a.text && !a.anmerkung) continue;
        liste.push({
          schluessel: `${id}|lehrer${i}`,
          quelle: 'lehrer',
          datum: tag.datum,
          kurs: s.kurs,
          fachName: s.fachName,
          farbe: s.farbe,
          text: a.text || a.anmerkung,
          erledigt: !!eigene[`erledigt_lehrer${i}`],
          stunde: s,
          feld: `erledigt_lehrer${i}`,
        });
      }

      if (eigene.aufgabe) {
        liste.push({
          schluessel: `${id}|eigen`,
          quelle: 'eigen',
          datum: tag.datum,
          kurs: s.kurs,
          fachName: s.fachName,
          farbe: s.farbe,
          text: eigene.aufgabe,
          erledigt: !!eigene.erledigt,
          stunde: s,
          feld: 'erledigt',
        });
      }
    }
  }
  return liste.sort((a, b) => a.datum.localeCompare(b.datum));
}

export const offeneAufgaben = () =>
  alleAufgaben().filter((a) => !a.erledigt && tageBis(a.datum) >= 0);

function aufgabenZeile(aufgabe) {
  const el = document.createElement('div');
  el.className = `aufgabe${aufgabe.erledigt ? ' erledigt' : ''}`;
  el.style.setProperty('--fach-farbe', farbeVon(aufgabe.farbe));

  const haken = document.createElement('button');
  haken.type = 'button';
  haken.className = 'haken';
  haken.setAttribute('aria-label', aufgabe.erledigt ? 'Als offen markieren' : 'Als erledigt markieren');
  haken.innerHTML = aufgabe.erledigt
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
    : '';
  haken.addEventListener('click', async () => {
    const id = A.notizId(aufgabe.stunde);
    const eintrag = A.zustand.meineDaten.notizen[id] ?? {};
    eintrag[aufgabe.feld] = !aufgabe.erledigt;
    A.zustand.meineDaten.notizen[id] = eintrag;
    await A.speichern();
    A.zeichnen();
  });

  const inhalt = document.createElement('div');
  inhalt.className = 'aufgabe-inhalt';
  inhalt.innerHTML =
    `<div class="aufgabe-kopf">${symbolFuer(aufgabe.fachName, { groesse: 13, strich: 2 })}` +
    `<span class="aufgabe-fach">${aufgabe.fachName}</span>` +
    (aufgabe.quelle === 'lehrer' ? '<span class="aufgabe-quelle">Lehrkraft</span>' : '') +
    `</div>`;
  const text = document.createElement('p');
  text.className = 'aufgabe-text';
  text.textContent = aufgabe.text;
  inhalt.append(text);
  inhalt.addEventListener('click', () => A.oeffneStunde(aufgabe.stunde));

  el.append(haken, inhalt);
  return el;
}

function klausurKarte(klausur) {
  const kurs = kursVon(klausur.kurs);
  const abstand = tageBis(klausur.datum);

  const huelle = document.createElement('div');
  huelle.className = `klausur-huelle${abstand >= 0 && abstand <= 7 ? ' nah' : ''}`;
  huelle.style.setProperty('--fach-farbe', farbeVon(kurs?.farbe));

  const el = document.createElement('button');
  el.type = 'button';
  el.className = `klausur-karte${abstand < 0 ? ' vergangen' : ''}`;
  el.innerHTML =
    `<div class="klausur-tage">${abstand < 0 ? '–' : abstand}</div>` +
    `<div class="klausur-mitte">` +
    `<div class="klausur-fach">${symbolFuer(kurs?.fach ?? 'Termin', { groesse: 14, strich: 2 })}${kurs?.fach ?? klausur.kurs}</div>` +
    `<div class="klausur-info">${datumText(klausur.datum)} · ${restText(abstand)}${klausur.thema ? ` · ${klausur.thema}` : ''}</div>` +
    `</div>` +
    `<span class="klausur-stift" aria-hidden="true">›</span>`;
  el.addEventListener('click', () => klausurBearbeiten(klausur));
  huelle.append(el);

  // Lernplan: Etappen bis zur Klausur, abhakbar.
  const plan = lernplanFuer(klausur);
  if (plan.length) {
    const liste = document.createElement('div');
    liste.className = 'lernplan';

    const kopf = document.createElement('p');
    const offen = plan.filter((e) => !e.erledigt).length;
    kopf.className = 'lernplan-kopf';
    kopf.textContent = offen ? `Lernplan · ${offen} von ${plan.length} offen` : 'Lernplan · geschafft';
    liste.append(kopf);

    for (const etappe of plan) {
      const zeile = document.createElement('button');
      zeile.type = 'button';
      zeile.className = `lern-etappe${etappe.erledigt ? ' erledigt' : ''}${etappe.datum === heute() ? ' heute' : ''}`;
      zeile.innerHTML =
        `<span class="lern-haken">${etappe.erledigt ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' : ''}</span>` +
        `<span class="lern-text">${etappe.text}<span class="lern-datum">${datumText(etappe.datum)}</span></span>`;
      zeile.addEventListener('click', async () => {
        const daten = A.zustand.meineDaten;
        daten.lernen ??= {};
        if (etappe.erledigt) delete daten.lernen[etappe.schluessel];
        else daten.lernen[etappe.schluessel] = true;
        await A.speichern();
        A.zeichnen();
      });
      liste.append(zeile);
    }
    huelle.append(liste);
  }

  return huelle;
}

/**
 * Lernplan zu einer Klausur: verteilt Etappen rueckwaerts auf die Tage davor.
 * Bevorzugt werden Tage mit viel Zeit - Wochenenden, schulfreie Tage und
 * Schultage mit fruehem Schluss. Tage mit einer anderen Klausur fallen raus,
 * der Vortag ist immer dabei (Wiederholung).
 */
const ETAPPEN = [
  'Überblick verschaffen, Material sortieren',
  'Erstes Hauptthema durcharbeiten',
  'Zweites Hauptthema durcharbeiten',
  'Übungsaufgaben rechnen',
  'Alles wiederholen, Lücken schließen',
];

export function lernplanFuer(klausur) {
  const abstandKlausur = tageBis(klausur.datum);
  if (abstandKlausur < 0) return [];

  const kandidaten = [];
  for (let vorher = 12; vorher >= 1; vorher--) {
    const d = new Date(`${klausur.datum}T12:00:00`);
    d.setDate(d.getDate() - vorher);
    const datum = A.iso(d);
    if (tageBis(datum) < 0) continue; // Vergangenes bringt nichts mehr

    // An einem Tag mit anderer Klausur wird nicht fuer diese gelernt.
    if (A.zustand.meineDaten.klausuren.some((k) => k.datum === datum && k.id !== klausur.id)) continue;

    const tag = A.alleTage().find((t) => t.datum === datum);
    const wochenende = d.getDay() === 0 || d.getDay() === 6;
    const gueltig = (tag?.stunden ?? []).filter((x) => x.status !== 'CANCELLED' && x.kurs);

    let zeit;
    if (wochenende || !gueltig.length) zeit = 3;                        // ganzer Tag frei
    else if (Math.max(...gueltig.map((x) => A.minuten(x.bis))) <= 775) zeit = 2; // Schluss bis 12:55
    else zeit = 1;                                                      // langer Schultag

    kandidaten.push({ datum, zeit, vorher });
  }

  if (!kandidaten.length) return [];

  // Wie viele Etappen passen? Bei kurzem Vorlauf weniger.
  const anzahl = Math.min(ETAPPEN.length, Math.max(2, Math.min(kandidaten.length, Math.ceil(abstandKlausur / 2))));

  // Vortag setzen, Rest nach verfuegbarer Zeit (bei Gleichstand naeher dran zuerst).
  const vortag = kandidaten.find((k) => k.vorher === 1);
  const uebrige = kandidaten
    .filter((k) => k !== vortag)
    .sort((a, b) => b.zeit - a.zeit || a.vorher - b.vorher);

  const gewaehlt = [...(vortag ? [vortag] : []), ...uebrige.slice(0, anzahl - (vortag ? 1 : 0))]
    .sort((a, b) => a.datum.localeCompare(b.datum));

  // Die Wiederholung gehoert ans Ende, der Rest der Reihe nach.
  return gewaehlt.map((k, i) => ({
    datum: k.datum,
    schluessel: `${klausur.id}|${k.datum}`,
    text: i === gewaehlt.length - 1 ? ETAPPEN[ETAPPEN.length - 1] : ETAPPEN[Math.min(i, ETAPPEN.length - 2)],
    erledigt: !!A.zustand.meineDaten.lernen?.[`${klausur.id}|${k.datum}`],
  }));
}

/** Alle Lernetappen fuer ein bestimmtes Datum - fuer Aufgabenliste und Push. */
export function lernenAm(datum) {
  return A.zustand.meineDaten.klausuren
    .flatMap((k) => lernplanFuer(k).map((e) => ({ ...e, klausur: k })))
    .filter((e) => e.datum === datum && !e.erledigt);
}

/**
 * Flache Liste der anstehenden Lernetappen je Datum.
 * Wird beim Speichern mit abgelegt, damit der Hintergrunddienst sie
 * fuer die Abend- und Morgenmeldung lesen kann - der kann den Lernplan
 * nicht selbst ausrechnen, weil ihm der Stundenplan fehlt.
 */
export function lernVorschau() {
  const vorschau = {};
  for (const klausur of A.zustand.meineDaten.klausuren) {
    const kurs = kursVon(klausur.kurs);
    for (const etappe of lernplanFuer(klausur)) {
      if (etappe.erledigt) continue;
      (vorschau[etappe.datum] ??= []).push(`${kurs?.fach ?? klausur.kurs}: ${etappe.text}`);
    }
  }
  return vorschau;
}

function klausurBearbeiten(klausur = null) {
  oeffneEingabe({
    titel: klausur ? 'Klausur bearbeiten' : 'Klausur eintragen',
    unterzeile: 'Eure Schule gibt Klausurtermine nicht über WebUntis heraus – deshalb hier von Hand.',
    felder: [
      {
        name: 'kurs',
        label: 'Fach',
        typ: 'auswahl',
        wert: klausur?.kurs ?? KURSE[0].kuerzel,
        optionen: KURSE.map((k) => ({ wert: k.kuerzel, text: k.fach })),
      },
      { name: 'datum', label: 'Datum', typ: 'datum', wert: klausur?.datum ?? '', pflicht: true },
      { name: 'thema', label: 'Thema (optional)', typ: 'text', wert: klausur?.thema ?? '', platzhalter: 'z. B. Erörterung' },
    ],
    beimSichern: async (werte) => {
      const daten = A.zustand.meineDaten;
      if (klausur) {
        Object.assign(klausur, werte);
      } else {
        daten.klausuren.push({ id: neueId(), ...werte });
      }
      daten.klausuren.sort((a, b) => a.datum.localeCompare(b.datum));
      await A.speichern();
      A.zeichnen();
    },
    beimLoeschen: klausur
      ? async () => {
          const daten = A.zustand.meineDaten;
          daten.klausuren = daten.klausuren.filter((k) => k.id !== klausur.id);
          await A.speichern();
          A.zeichnen();
        }
      : null,
  });
}

export function zeichneAufgaben(ziel) {
  ziel.textContent = '';

  const daten = A.zustand.meineDaten;

  // --- Klausuren ---
  ziel.append(ueberschrift('Klausuren', '+ Eintragen', () => klausurBearbeiten()));
  const kommende = daten.klausuren.filter((k) => tageBis(k.datum) >= 0);
  if (kommende.length) {
    const box = document.createElement('div');
    box.className = 'klausur-liste';
    for (const k of kommende) box.append(klausurKarte(k));
    ziel.append(box);
  } else {
    ziel.append(leerBox('Keine Klausuren', 'Trag deine Termine ein, dann zählt die App die Tage herunter.'));
  }

  // --- Hausaufgaben ---
  const alle = alleAufgaben();
  const offen = alle.filter((a) => !a.erledigt && tageBis(a.datum) >= 0);
  const erledigt = alle.filter((a) => a.erledigt && tageBis(a.datum) >= -7);

  ziel.append(ueberschrift(`Hausaufgaben${offen.length ? ` · ${offen.length} offen` : ''}`));

  if (!offen.length) {
    ziel.append(
      erledigt.length
        ? leerBox('Alles erledigt', 'Nichts mehr offen – gut gemacht.')
        : leerBox(
            'Nichts offen',
            'Hier landen automatisch die Hausaufgaben deiner Lehrkräfte aus WebUntis – und alles, was du selbst in einer Stunde einträgst.'
          )
    );
  }

  let letztesDatum = '';
  for (const aufgabe of offen) {
    if (aufgabe.datum !== letztesDatum) {
      const kopf = document.createElement('p');
      kopf.className = 'tages-trenner';
      kopf.textContent = datumText(aufgabe.datum);
      ziel.append(kopf);
      letztesDatum = aufgabe.datum;
    }
    ziel.append(aufgabenZeile(aufgabe));
  }

  if (erledigt.length) {
    ziel.append(ueberschrift(`Erledigt · ${erledigt.length}`));
    for (const aufgabe of erledigt) ziel.append(aufgabenZeile(aufgabe));
  }
}

// ================================================================= NOTEN

/** Oberstufen-Punkte in die Notenschreibweise uebersetzen. */
export function punkteZuNote(punkte) {
  if (punkte == null || Number.isNaN(punkte)) return '–';
  const stufe = Math.max(0, Math.min(15, Math.round(punkte)));
  if (stufe === 0) return '6';
  // 15/14/13 = 1+/1/1-, 12/11/10 = 2+/2/2- und so weiter.
  const note = 1 + Math.floor((15 - stufe) / 3);
  const rest = (15 - stufe) % 3; // 0 = plus, 1 = glatt, 2 = minus
  return `${note}${rest === 0 ? '+' : rest === 2 ? '−' : ''}`;
}

/** Gewichtung: schriftlich 40 %, muendlich/sonstige 60 % (Regelfall in Niedersachsen). */
const GEWICHT_SCHRIFTLICH = 0.4;

export function kursSchnitt(kuerzel) {
  const liste = A.zustand.meineDaten.noten[kuerzel] ?? [];
  if (!liste.length) return null;

  const mittel = (art) => {
    const teil = liste.filter((n) => (art === 'klausur' ? n.art === 'klausur' : n.art !== 'klausur'));
    if (!teil.length) return null;
    return teil.reduce((s, n) => s + Number(n.punkte), 0) / teil.length;
  };

  const schriftlich = mittel('klausur');
  const sonstige = mittel('sonstige');
  if (schriftlich !== null && sonstige !== null) {
    return schriftlich * GEWICHT_SCHRIFTLICH + sonstige * (1 - GEWICHT_SCHRIFTLICH);
  }
  return schriftlich ?? sonstige;
}

export function gesamtSchnitt() {
  const werte = KURSE.map((k) => kursSchnitt(k.kuerzel)).filter((w) => w !== null);
  if (!werte.length) return null;
  return werte.reduce((s, w) => s + w, 0) / werte.length;
}

function noteBearbeiten(kuerzel, note = null) {
  const kurs = kursVon(kuerzel);
  oeffneEingabe({
    titel: note ? 'Note bearbeiten' : `Note in ${kurs?.fach ?? kuerzel}`,
    unterzeile: 'Punkte von 0 bis 15 wie in der Oberstufe.',
    felder: [
      {
        name: 'art',
        label: 'Art',
        typ: 'auswahl',
        wert: note?.art ?? 'sonstige',
        optionen: [
          { wert: 'klausur', text: 'Klausur' },
          { wert: 'sonstige', text: 'Mündlich / Test' },
        ],
      },
      { name: 'punkte', label: 'Punkte (0–15)', typ: 'zahl', wert: note?.punkte ?? '', pflicht: true },
      { name: 'titel', label: 'Bezeichnung (optional)', typ: 'text', wert: note?.titel ?? '', platzhalter: 'z. B. 1. Klausur' },
      { name: 'datum', label: 'Datum', typ: 'datum', wert: note?.datum ?? heute() },
    ],
    beimSichern: async (werte) => {
      const punkte = Math.max(0, Math.min(15, Number(werte.punkte)));
      if (Number.isNaN(punkte)) return;
      const daten = A.zustand.meineDaten;
      daten.noten[kuerzel] ??= [];
      if (note) {
        Object.assign(note, { ...werte, punkte });
      } else {
        daten.noten[kuerzel].push({ id: neueId(), ...werte, punkte });
      }
      daten.noten[kuerzel].sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));
      await A.speichern();
      A.zeichnen();
    },
    beimLoeschen: note
      ? async () => {
          const daten = A.zustand.meineDaten;
          daten.noten[kuerzel] = (daten.noten[kuerzel] ?? []).filter((n) => n.id !== note.id);
          await A.speichern();
          A.zeichnen();
        }
      : null,
  });
}

export function zeichneNoten(ziel) {
  ziel.textContent = '';

  const schnitt = gesamtSchnitt();

  const kopf = document.createElement('div');
  kopf.className = 'noten-kopf';
  kopf.innerHTML = schnitt
    ? `<div class="noten-zahl">${schnitt.toFixed(1)}</div>` +
      `<div class="noten-unter">Punkte im Schnitt · entspricht ${punkteZuNote(schnitt)}</div>`
    : `<div class="noten-zahl leer">–</div><div class="noten-unter">Noch keine Noten eingetragen</div>`;
  ziel.append(kopf);

  for (const kurs of KURSE) {
    const liste = A.zustand.meineDaten.noten[kurs.kuerzel] ?? [];
    const eigen = kursSchnitt(kurs.kuerzel);

    const karte = document.createElement('div');
    karte.className = 'noten-karte';
    karte.style.setProperty('--fach-farbe', farbeVon(kurs.farbe));

    const zeile = document.createElement('button');
    zeile.type = 'button';
    zeile.className = 'noten-zeile';
    zeile.innerHTML =
      `<span class="noten-symbol">${symbolFuer(kurs.fach, { groesse: 18, strich: 1.8 })}</span>` +
      `<span class="noten-name">${kurs.fach}${kurs.niveau ? `<span class="noten-niveau">${kurs.niveau}</span>` : ''}</span>` +
      `<span class="noten-wert">${eigen === null ? '–' : eigen.toFixed(1)}</span>`;
    zeile.addEventListener('click', () => {
      karte.classList.toggle('offen');
    });
    karte.append(zeile);

    const balken = document.createElement('div');
    balken.className = 'noten-balken';
    balken.innerHTML = `<div style="width:${eigen === null ? 0 : Math.round((eigen / 15) * 100)}%"></div>`;
    karte.append(balken);

    const details = document.createElement('div');
    details.className = 'noten-details';
    for (const note of liste) {
      const eintrag = document.createElement('button');
      eintrag.type = 'button';
      eintrag.className = 'note-eintrag';
      eintrag.innerHTML =
        `<span class="note-punkte">${note.punkte}</span>` +
        `<span class="note-text">${note.titel || (note.art === 'klausur' ? 'Klausur' : 'Mündlich')}` +
        `<span class="note-datum">${note.art === 'klausur' ? 'Klausur · ' : ''}${note.datum ? datumText(note.datum) : ''}</span></span>` +
        `<span class="note-note">${punkteZuNote(note.punkte)}</span>`;
      eintrag.addEventListener('click', () => noteBearbeiten(kurs.kuerzel, note));
      details.append(eintrag);
    }
    const hinzu = document.createElement('button');
    hinzu.type = 'button';
    hinzu.className = 'note-hinzu';
    hinzu.textContent = '+ Note eintragen';
    hinzu.addEventListener('click', () => noteBearbeiten(kurs.kuerzel));
    details.append(hinzu);
    karte.append(details);

    ziel.append(karte);
  }

  const fuss = document.createElement('p');
  fuss.className = 'bereich-fuss';
  fuss.textContent = 'Gewichtung: 40 % schriftlich, 60 % mündlich. Sag Bescheid, wenn eure Schule anders rechnet.';
  ziel.append(fuss);
}

// ================================================================== MEHR

function fehlzeitBearbeiten(eintrag = null) {
  oeffneEingabe({
    titel: eintrag ? 'Fehlzeit bearbeiten' : 'Fehlzeit eintragen',
    felder: [
      { name: 'datum', label: 'Datum', typ: 'datum', wert: eintrag?.datum ?? heute(), pflicht: true },
      {
        name: 'art',
        label: 'Umfang',
        typ: 'auswahl',
        wert: eintrag?.art ?? 'ganztags',
        optionen: [
          { wert: 'ganztags', text: 'Ganzer Tag' },
          { wert: 'stunden', text: 'Einzelne Stunden' },
        ],
      },
      {
        name: 'entschuldigt',
        label: 'Status',
        typ: 'auswahl',
        wert: eintrag?.entschuldigt ?? 'ja',
        optionen: [
          { wert: 'ja', text: 'Entschuldigt' },
          { wert: 'nein', text: 'Offen' },
        ],
      },
      { name: 'grund', label: 'Grund (optional)', typ: 'text', wert: eintrag?.grund ?? '', platzhalter: 'z. B. krank' },
    ],
    beimSichern: async (werte) => {
      const daten = A.zustand.meineDaten;
      if (eintrag) Object.assign(eintrag, werte);
      else daten.fehlzeiten.push({ id: neueId(), ...werte });
      daten.fehlzeiten.sort((a, b) => b.datum.localeCompare(a.datum));
      await A.speichern();
      A.zeichnen();
    },
    beimLoeschen: eintrag
      ? async () => {
          const daten = A.zustand.meineDaten;
          daten.fehlzeiten = daten.fehlzeiten.filter((f) => f.id !== eintrag.id);
          await A.speichern();
          A.zeichnen();
        }
      : null,
  });
}

export function zeichneMehr(ziel) {
  ziel.textContent = '';
  const daten = A.zustand.meineDaten;

  // --- Fehlzeiten ---
  const offen = daten.fehlzeiten.filter((f) => f.entschuldigt === 'nein').length;
  ziel.append(ueberschrift('Fehlzeiten', '+ Eintragen', () => fehlzeitBearbeiten()));

  const zaehler = document.createElement('div');
  zaehler.className = 'zaehler-reihe';
  zaehler.innerHTML =
    `<div class="zaehler"><span class="zaehler-zahl">${daten.fehlzeiten.length}</span><span class="zaehler-text">Fehltage</span></div>` +
    `<div class="zaehler${offen ? ' warnung' : ''}"><span class="zaehler-zahl">${offen}</span><span class="zaehler-text">nicht entschuldigt</span></div>`;
  ziel.append(zaehler);

  for (const f of daten.fehlzeiten.slice(0, 20)) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `fehlzeit${f.entschuldigt === 'nein' ? ' offen' : ''}`;
    el.innerHTML =
      `<span class="fehlzeit-datum">${datumText(f.datum)}</span>` +
      `<span class="fehlzeit-text">${f.art === 'ganztags' ? 'Ganzer Tag' : 'Einzelne Stunden'}${f.grund ? ` · ${f.grund}` : ''}</span>` +
      `<span class="fehlzeit-marke">${f.entschuldigt === 'nein' ? 'offen' : '✓'}</span>`;
    el.addEventListener('click', () => fehlzeitBearbeiten(f));
    ziel.append(el);
  }

  // --- Einstellungen ---
  ziel.append(ueberschrift('App'));

  const liste = document.createElement('div');
  liste.className = 'menue-liste';

  const eintragMachen = (text, unter, beiKlick) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'menue-eintrag';
    el.innerHTML = `<span class="menue-text">${text}<span class="menue-unter">${unter}</span></span><span class="menue-pfeil">›</span>`;
    el.addEventListener('click', beiKlick);
    liste.append(el);
  };

  eintragMachen('Mitteilungen', A.pushStatusText(), () => A.oeffnePush());
  eintragMachen('Jetzt aktualisieren', A.standText(), () => A.starten({ frisch: true }));
  ziel.append(liste);

  const fuss = document.createElement('p');
  fuss.className = 'bereich-fuss';
  fuss.textContent = `Stundenplan v${A.version} · Deine Noten, Aufgaben und Fehlzeiten sind verschlüsselt und bleiben auf diesem Gerät.`;
  ziel.append(fuss);
}
