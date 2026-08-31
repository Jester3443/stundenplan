// Die drei Bereiche neben dem Stundenplan: Aufgaben, Noten, Mehr.
// Bekommt beim Start alles Noetige von app.js uebergeben - so gibt es
// keine gegenseitigen Importe zwischen den Dateien.
import { KURSE, wochentyp } from './shared/konfiguration.mjs?v=16';
import { symbolFuer } from './symbole.mjs?v=16';
import { neueId } from './daten.mjs?v=16';

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

    // Stundenauswahl: zeigt die Stunden des gewaehlten Tages zum Ankreuzen
    // und aktualisiert sich, wenn das Datum geaendert wird.
    if (feld.typ === 'stunden') {
      const box = document.createElement('div');
      box.className = 'stunden-auswahl';
      box.id = `eingabe_${feld.name}`;

      const fuellen = (datum) => {
        box.textContent = '';
        const tag = A.alleTage().find((t) => t.datum === datum);
        const stunden = (tag?.stunden ?? []).filter((x) => x.kurs && x.status !== 'CANCELLED');

        if (!stunden.length) {
          const hinweis = document.createElement('p');
          hinweis.className = 'stunden-leer';
          hinweis.textContent = tag
            ? 'An diesem Tag hattest du keinen Unterricht.'
            : 'Für diesen Tag liegt kein Plan mehr vor – trag die Fehlzeit ohne Fachbezug ein.';
          box.append(hinweis);
          return;
        }

        const alle = document.createElement('button');
        alle.type = 'button';
        alle.className = 'stunden-alle';
        alle.textContent = 'Ganzer Tag';
        alle.addEventListener('click', () => {
          const fehlt = [...box.querySelectorAll('.stunden-knopf')].some((k) => !k.classList.contains('aktiv'));
          for (const k of box.querySelectorAll('.stunden-knopf')) k.classList.toggle('aktiv', fehlt);
        });
        box.append(alle);

        for (const st of stunden) {
          const knopf = document.createElement('button');
          knopf.type = 'button';
          const schonGewaehlt = (feld.wert ?? []).some((w) => w.von === st.von && w.kurs === st.kurs);
          knopf.className = `stunden-knopf${schonGewaehlt ? ' aktiv' : ''}`;
          knopf.style.setProperty('--fach-farbe', farbeVon(st.farbe));
          knopf.dataset.kurs = st.kurs;
          knopf.dataset.von = st.von;
          knopf.dataset.bis = st.bis;
          knopf.innerHTML =
            `<span class="sk-block">${st.block}</span><span class="sk-fach">${st.fachName}</span>`;
          knopf.addEventListener('click', () => knopf.classList.toggle('aktiv'));
          box.append(knopf);
        }
      };

      const datumsFeld = $('eingabe_datum');
      fuellen(datumsFeld?.value || heute());
      datumsFeld?.addEventListener('change', () => fuellen(datumsFeld.value));

      behaelter.append(box);
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
      if (feld.typ === 'auswahl') {
        werte[feld.name] = el.querySelector('.auswahl-knopf.aktiv')?.dataset.wert ?? feld.wert;
      } else if (feld.typ === 'stunden') {
        werte[feld.name] = [...el.querySelectorAll('.stunden-knopf.aktiv')].map((k) => ({
          kurs: k.dataset.kurs,
          von: k.dataset.von,
          bis: k.dataset.bis,
        }));
      } else {
        werte[feld.name] = el.value.trim();
      }
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

/**
 * Ist die Stunde, zu der die Aufgabe gehoert, schon vorbei?
 * Eine Hausaufgabe fuer eine Stunde, die heute Morgen war, muss man nicht
 * mehr abhaken - sie verschwindet von selbst, sobald die Stunde durch ist.
 */
function schonVorbei(aufgabe) {
  const abstand = tageBis(aufgabe.datum);
  if (abstand < 0) return true;
  if (abstand > 0) return false;
  const jetzt = new Date();
  return jetzt.getHours() * 60 + jetzt.getMinutes() >= A.minuten(aufgabe.stunde.bis);
}

export const offeneAufgaben = () => alleAufgaben().filter((a) => !a.erledigt && !schonVorbei(a));

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
  const offen = alle.filter((a) => !a.erledigt && !schonVorbei(a));
  // Erledigtes der letzten Woche bleibt sichtbar - zum Nachschauen,
  // nicht als Aufgabe.
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

/**
 * Gewichtung schriftlich zu muendlich.
 *
 * Niedersachsen gibt KEIN landesweites Verhaeltnis vor: Nach den
 * Ergaenzenden Bestimmungen legt die Fachkonferenz jeder Schule die
 * Gewichtung im Rahmen des Kerncurriculums fest. Einzige feste Zahl:
 * Im Seminarfach zaehlt die Facharbeit zu 50 %.
 * Deshalb ist der Wert je Fach einstellbar - Standard 40 %.
 */
const GEWICHT_STANDARD = 40;

export const gewichtVon = (kuerzel) =>
  A.zustand.meineDaten.gewichtung?.[kuerzel] ?? (kuerzel === 'sf3' ? 50 : GEWICHT_STANDARD);

export function kursSchnitt(kuerzel) {
  const liste = A.zustand.meineDaten.noten[kuerzel] ?? [];
  if (!liste.length) return null;
  const anteilSchriftlich = gewichtVon(kuerzel) / 100;

  const mittel = (art) => {
    const teil = liste.filter((n) => (art === 'klausur' ? n.art === 'klausur' : n.art !== 'klausur'));
    if (!teil.length) return null;
    return teil.reduce((s, n) => s + Number(n.punkte), 0) / teil.length;
  };

  const schriftlich = mittel('klausur');
  const sonstige = mittel('sonstige');
  if (schriftlich !== null && sonstige !== null) {
    return schriftlich * anteilSchriftlich + sonstige * (1 - anteilSchriftlich);
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

function gewichtBearbeiten(kuerzel) {
  const kurs = kursVon(kuerzel);
  oeffneEingabe({
    titel: `Gewichtung in ${kurs?.fach ?? kuerzel}`,
    unterzeile:
      'Wie viel zählen die Klausuren? Den Rest machen mündliche und sonstige Leistungen aus. ' +
      'Die Fachkonferenz legt das fest – frag deine Lehrkraft.',
    felder: [
      {
        name: 'anteil',
        label: 'Anteil der Klausuren',
        typ: 'auswahl',
        wert: String(gewichtVon(kuerzel)),
        optionen: [
          { wert: '30', text: '30 %' },
          { wert: '40', text: '40 %' },
          { wert: '50', text: '50 %' },
          { wert: '60', text: '60 %' },
        ],
      },
    ],
    beimSichern: async (werte) => {
      const daten = A.zustand.meineDaten;
      daten.gewichtung ??= {};
      daten.gewichtung[kuerzel] = Number(werte.anteil);
      await A.speichern();
      A.zeichnen();
    },
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
    const gewicht = document.createElement('button');
    gewicht.type = 'button';
    gewicht.className = 'note-gewicht';
    gewicht.innerHTML =
      `<span>Gewichtung</span><span class="ng-wert">${gewichtVon(kurs.kuerzel)} % schriftlich</span>`;
    gewicht.addEventListener('click', () => gewichtBearbeiten(kurs.kuerzel));
    details.append(gewicht);

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
  fuss.textContent =
    'Die Gewichtung legt in Niedersachsen die Fachkonferenz jedes Fachs fest – es gibt keine landesweite Vorgabe. ' +
    'Tipp auf ein Fach und dann auf die Gewichtung, um sie anzupassen; frag den Wert bei deiner Lehrkraft ab.';
  ziel.append(fuss);
}

// ============================================ Fehlzeiten-Auswertung

/**
 * Schreibt mit, wie viel Unterricht je Fach tatsaechlich stattgefunden hat.
 * Wird bei jedem Start aufgerufen und zaehlt jeden vergangenen Schultag
 * genau einmal - der abgerufene Plan reicht nur wenige Wochen zurueck.
 * Entfallene Stunden zaehlen nicht mit, die hatte ja niemand.
 */
export function aktualisiereStundenZaehler() {
  const daten = A.zustand.meineDaten;
  daten.stundenSumme ??= {};
  daten.gezaehlteTage ??= {};

  let neueTage = 0;
  for (const tag of A.alleTage()) {
    if (tag.datum >= heute()) continue;            // heute erst morgen zaehlen
    if (daten.gezaehlteTage[tag.datum]) continue;  // schon erfasst
    if (!tag.stunden.length) continue;             // kein Plan vorhanden

    for (const s of tag.stunden) {
      if (!s.kurs || s.status === 'CANCELLED') continue;
      daten.stundenSumme[s.kurs] = (daten.stundenSumme[s.kurs] ?? 0) + 1;
    }
    daten.gezaehlteTage[tag.datum] = true;
    neueTage++;
  }
  return neueTage;
}

/**
 * Der Wochenrhythmus je Fach: Wie viele Bloecke liegen an welchem Wochentag
 * in einer A- bzw. B-Woche? Abgeleitet aus den veroeffentlichten Wochen.
 */
function wochenRhythmus() {
  const roh = { A: {}, B: {} };   // typ -> wochentag -> kurs -> Summe
  const wochenZahl = { A: 0, B: 0 };

  for (const woche of A.zustand.plan?.wochen ?? []) {
    if (!woche.veroeffentlicht) continue;
    wochenZahl[woche.typ]++;
    for (const tag of woche.tage) {
      const wt = new Date(`${tag.datum}T12:00:00`).getDay();
      for (const st of tag.stunden) {
        if (!st.kurs) continue; // Termine zaehlen nicht als Unterricht
        ((roh[woche.typ][wt] ??= {})[st.kurs] ??= 0);
        roh[woche.typ][wt][st.kurs]++;
      }
    }
  }

  // Auf "pro Woche" herunterrechnen und runden - sonst zaehlt eine
  // Studienwoche doppelt, in der gar nichts stattfand.
  const rhythmus = { A: {}, B: {} };
  for (const typ of ['A', 'B']) {
    if (!wochenZahl[typ]) continue;
    for (const [wt, faecher] of Object.entries(roh[typ])) {
      rhythmus[typ][wt] = {};
      for (const [kurs, summe] of Object.entries(faecher)) {
        rhythmus[typ][wt][kurs] = Math.round(summe / wochenZahl[typ]);
      }
    }
  }
  return rhythmus;
}

/** Faellt dieser Tag in die Ferien oder auf einen Feiertag? */
function istFrei(datum) {
  return (A.zustand.plan?.ferien ?? []).some((f) => datum >= f.von && datum <= f.bis);
}

/**
 * Geplante Stunden je Fach seit Schuljahresbeginn - hochgerechnet aus dem
 * Wochenrhythmus, ohne Ferien und Feiertage.
 *
 * Warum hochrechnen statt mitzaehlen: WebUntis gibt den Plan nur wenige
 * Wochen weit heraus, es gibt keine Historie. Wuerde die App nur mitzaehlen,
 * stuende monatelang "zu wenig Daten" da.
 */
export function geplanteStunden() {
  const beginn = A.zustand.plan?.schuljahr?.von;
  if (!beginn) return {};

  const rhythmus = wochenRhythmus();
  const summe = {};
  const bis = heute();

  const tag = new Date(`${beginn}T12:00:00`);
  const ende = new Date(`${bis}T12:00:00`);

  while (tag < ende) {
    const wt = tag.getDay();
    if (wt !== 0 && wt !== 6) {
      const datum = A.iso(tag);
      if (!istFrei(datum)) {
        const eintraege = rhythmus[wochentyp(datum)]?.[wt] ?? {};
        for (const [kurs, anzahl] of Object.entries(eintraege)) {
          summe[kurs] = (summe[kurs] ?? 0) + anzahl;
        }
      }
    }
    tag.setDate(tag.getDate() + 1);
  }
  return summe;
}

/** Wie viele Stunden hat Jasper in einem Fach verpasst? */
function verpasstIn(kuerzel) {
  let gesamt = 0;
  let unentschuldigt = 0;
  for (const f of A.zustand.meineDaten.fehlzeiten) {
    for (const st of f.stunden ?? []) {
      if (st.kurs !== kuerzel) continue;
      gesamt++;
      if (f.entschuldigt === 'nein') unentschuldigt++;
    }
  }
  return { gesamt, unentschuldigt };
}

/**
 * Einstufung der Fehlquote.
 *
 * WICHTIG: Niedersachsen kennt KEINE Prozentgrenze. § 7 Abs. 4 VO-GO stellt
 * darauf ab, ob die Leistung ueberhaupt noch bewertet werden kann und ob das
 * Versaeumnis selbst zu vertreten ist. Die Stufen hier sind deshalb eine
 * Faustregel zur Selbsteinschaetzung - keine Rechtsgrundlage.
 */
export const STUFEN = [
  { ab: 30, name: 'kritisch', farbe: 'rot' },
  { ab: 20, name: 'hoch', farbe: 'orange' },
  { ab: 10, name: 'erhöht', farbe: 'gelb' },
  { ab: 0, name: 'unauffällig', farbe: 'gruen' },
];

/** Zu wenige Stunden fuer eine Aussage - dann bewusst KEINE Warnfarbe. */
const NEUTRAL = { name: 'noch zu wenig Daten', farbe: 'neutral' };

const MINDEST_STUNDEN = 6; // darunter ist eine Prozentangabe nicht aussagekraeftig

export function fehlAuswertung() {
  const daten = A.zustand.meineDaten;
  const geplant = geplanteStunden();
  const zeilen = [];

  for (const kurs of KURSE) {
    // Bezugsgroesse ist der hochgerechnete Plan seit Schuljahresbeginn.
    // Der mitgezaehlte Wert dient nur als Untergrenze, falls die
    // Hochrechnung (z. B. am Schuljahresanfang) noch klein ist.
    const stattgefunden = Math.max(geplant[kurs.kuerzel] ?? 0, daten.stundenSumme?.[kurs.kuerzel] ?? 0);
    const { gesamt, unentschuldigt } = verpasstIn(kurs.kuerzel);
    if (!stattgefunden && !gesamt) continue;

    const quote = stattgefunden ? (gesamt / stattgefunden) * 100 : null;
    const belastbar = stattgefunden >= MINDEST_STUNDEN;

    let stufe;
    if (!belastbar) {
      // Bei einer Handvoll Stunden sagt ein Prozentwert nichts aus -
      // dann lieber ehrlich neutral bleiben als falschen Alarm auszuloesen.
      stufe = NEUTRAL;
    } else {
      stufe = STUFEN.find((x) => quote >= x.ab) ?? STUFEN[STUFEN.length - 1];
      // Unentschuldigtes Fehlen ist der eigentliche Risikofaktor - nie gruen.
      if (unentschuldigt > 0 && stufe.farbe === 'gruen') stufe = STUFEN[2];
    }

    zeilen.push({ kurs, stattgefunden, verpasst: gesamt, unentschuldigt, quote, belastbar, stufe });
  }

  // Belastbare Werte zuerst, darin die hoechste Quote oben.
  return zeilen.sort((a, b) => Number(b.belastbar) - Number(a.belastbar) || (b.quote ?? -1) - (a.quote ?? -1));
}

// ================================================================== MEHR

function fehlzeitBearbeiten(eintrag = null) {
  oeffneEingabe({
    titel: eintrag ? 'Fehlzeit bearbeiten' : 'Fehlzeit eintragen',
    felder: [
      { name: 'datum', label: 'Datum', typ: 'datum', wert: eintrag?.datum ?? heute(), pflicht: true },
      { name: 'stunden', label: 'Welche Stunden hast du verpasst?', typ: 'stunden', wert: eintrag?.stunden ?? [] },
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

  // --- Auswertung je Fach ---
  const auswertung = fehlAuswertung();
  if (auswertung.some((z) => z.verpasst > 0)) {
    ziel.append(ueberschrift('Fehlquote je Fach'));

    for (const z of auswertung) {
      if (!z.verpasst) continue;
      const karte = document.createElement('div');
      karte.className = `fehlfach stufe-${z.stufe.farbe}`;
      karte.style.setProperty('--fach-farbe', farbeVon(z.kurs.farbe));

      const quoteText = z.belastbar ? `${z.quote.toFixed(0)} %` : `${z.verpasst} Std`;

      karte.innerHTML =
        `<div class="ff-kopf">` +
        `<span class="ff-name">${symbolFuer(z.kurs.fach, { groesse: 15, strich: 1.9 })}${z.kurs.fach}</span>` +
        `<span class="ff-quote">${quoteText}</span>` +
        `</div>` +
        `<div class="ff-balken"><div style="width:${z.belastbar ? Math.min(100, z.quote) : 0}%"></div></div>` +
        `<div class="ff-fuss">` +
        `<span class="ff-stufe">${z.stufe.name}</span>` +
        `<span class="ff-zahlen">${z.verpasst} von ${z.stattgefunden} geplanten Std${z.unentschuldigt ? ` · ${z.unentschuldigt} unentschuldigt` : ''}</span>` +
        `</div>`;
      ziel.append(karte);
    }

    const erklaerung = document.createElement('p');
    erklaerung.className = 'bereich-fuss';
    erklaerung.textContent =
      'Faustregel, keine Rechtsgrundlage: Niedersachsen kennt keine feste Prozentgrenze. ' +
      'Nach § 7 Abs. 4 VO-GO zählt, ob deine Leistung noch bewertet werden kann und ob du das Fehlen selbst zu verantworten hast – ' +
      'unentschuldigte Stunden wiegen deshalb schwerer als entschuldigte.';
    ziel.append(erklaerung);
  }

  if (daten.fehlzeiten.length) ziel.append(ueberschrift('Einzelne Einträge'));

  for (const f of daten.fehlzeiten.slice(0, 20)) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `fehlzeit${f.entschuldigt === 'nein' ? ' offen' : ''}`;
    const faecher = [...new Set((f.stunden ?? []).map((st) => kursVon(st.kurs)?.fach ?? st.kurs))];
    const beschreibung = faecher.length
      ? `${(f.stunden ?? []).length} Std · ${faecher.join(', ')}`
      : f.art === 'ganztags'
        ? 'Ganzer Tag'
        : 'Ohne Fachbezug';
    el.innerHTML =
      `<span class="fehlzeit-datum">${datumText(f.datum)}</span>` +
      `<span class="fehlzeit-text">${beschreibung}${f.grund ? ` · ${f.grund}` : ''}</span>` +
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
  eintragMachen('Angemeldet als ' + A.personName(), 'Antippen, um zu wechseln', () => A.abmelden());
  ziel.append(liste);

  const fuss = document.createElement('p');
  fuss.className = 'bereich-fuss';
  fuss.textContent = `Stundenplan v${A.version} · Deine Noten, Aufgaben und Fehlzeiten sind verschlüsselt und bleiben auf diesem Gerät.`;
  ziel.append(fuss);
}
