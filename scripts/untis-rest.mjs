// Kern des Projekts: Zugriff auf die moderne WebUntis-REST-API,
// die den PERSOENLICHEN Stundenplan liefert (timetableType=MY_TIMETABLE).
// Der Weg dorthin: klassisch anmelden -> Session-Cookies -> Bearer-Token -> REST.
import 'dotenv/config';
import { WebUntis, WebUntisSecretAuth } from 'webuntis';

const env = (key) => (process.env[key] ?? '').trim();

/** Untis liefert Datumsangaben mal als 20260817, mal als "2026-08-17". */
export function formatTag(wert) {
  if (!wert) return '';
  const s = String(wert);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

/** Lokales Datum als YYYY-MM-DD - bewusst NICHT toISOString(), das rechnet nach UTC um. */
export const isoDatum = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Montag der Woche, in der das Datum liegt. */
export const montagVon = (datum) => {
  const d = new Date(datum);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

export class UntisRest {
  constructor() {
    this.schule = env('UNTIS_SCHOOL');
    this.host = env('UNTIS_HOST');
    this.benutzer = env('UNTIS_USER');
    this.geheim = env('UNTIS_SECRET');
    this.passwort = env('UNTIS_PASSWORD');

    if (!this.schule || !this.host || !this.benutzer) {
      throw new Error('In der .env fehlen UNTIS_SCHOOL, UNTIS_HOST oder UNTIS_USER.');
    }
    this.client = this.geheim
      ? new WebUntisSecretAuth(this.schule, this.benutzer, this.geheim, this.host, 'stundenplan-app')
      : new WebUntis(this.schule, this.benutzer, this.passwort, this.host);
    this.anmeldeart = this.geheim ? 'App-Schluessel' : 'Passwort';
  }

  async anmelden() {
    await this.client.login();
    this.session = this.client.sessionInformation;
    const schoolBase64 = Buffer.from(`_${this.schule}`).toString('base64');
    this.cookies = `JSESSIONID=${this.session.sessionId}; schoolname="${schoolBase64}"`;

    const antwort = await fetch(`https://${this.host}/WebUntis/api/token/new`, {
      headers: { Cookie: this.cookies },
    });
    if (!antwort.ok) throw new Error(`Token konnte nicht geholt werden (HTTP ${antwort.status})`);
    this.token = (await antwort.text()).trim();
    return this.session;
  }

  async rest(pfad) {
    const antwort = await fetch(`https://${this.host}${pfad}`, {
      headers: {
        Cookie: this.cookies,
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });
    if (!antwort.ok) {
      throw new Error(`HTTP ${antwort.status} bei ${pfad}: ${(await antwort.text()).slice(0, 200)}`);
    }
    return antwort.json();
  }

  /** Stammdaten inkl. Schuljahr und Stundenraster. */
  appDaten() {
    return this.rest('/WebUntis/api/rest/view/v1/app/data');
  }

  /** Der persoenliche Stundenplan fuer einen Zeitraum (Datum als YYYY-MM-DD). */
  async meinPlan(von, bis) {
    const id = this.session.personId;
    const roh = await this.rest(
      `/WebUntis/api/rest/view/v1/timetable/entries?start=${von}&end=${bis}` +
        `&format=1&resourceType=STUDENT&resources=${id}&periodTypes=&timetableType=MY_TIMETABLE`
    );
    return (roh.days ?? []).map((tag) => ({
      datum: tag.date,
      status: tag.status,
      hinweise: (tag.dayEntries ?? []).map((e) => ({
        typ: e.type,
        text: e.text ?? e.name ?? '',
      })),
      stunden: (tag.gridEntries ?? []).map((e) => normalisiere(e, tag.date)),
    }));
  }

  /**
   * Hausaufgaben, die Lehrer in WebUntis eingetragen haben.
   * Rueckgabe: Liste mit { faellig, fach, text, anmerkung, erledigt }.
   */
  async hausaufgaben(von, bis) {
    const zahl = (d) => d.replace(/-/g, '');
    let roh;
    try {
      roh = await this.rest(`/WebUntis/api/homeworks/lessons?startDate=${zahl(von)}&endDate=${zahl(bis)}`);
    } catch {
      return [];
    }
    const daten = roh?.data ?? roh ?? {};
    const stunden = new Map((daten.lessons ?? []).map((l) => [l.id, l.subject]));
    const lehrer = new Map((daten.teachers ?? []).map((t) => [t.id, t.name ?? t.longName ?? '']));

    return (daten.homeworks ?? []).map((h) => ({
      id: h.id,
      fach: stunden.get(h.lessonId) ?? '',
      gestellt: formatTag(h.date),
      faellig: formatTag(h.dueDate ?? h.date),
      text: (h.text ?? '').trim(),
      anmerkung: (h.remark ?? '').trim(),
      erledigt: !!h.completed,
      lehrer: lehrer.get((daten.records ?? []).find((r) => r.homeworkId === h.id)?.teacherId) ?? '',
    }));
  }

  /**
   * Die neue REST-API laesst bei Terminen (Vollversammlung, Ausflug ...) den
   * Text weg. Die alte Wochen-Schnittstelle liefert ihn - also holen wir ihn
   * dort nach und ordnen ihn ueber Datum + Startzeit zu.
   */
  async terminTexte(montag) {
    const texte = new Map();
    try {
      const roh = (await this.client.getOwnTimetableForWeek(new Date(`${montag}T12:00:00`))) ?? [];
      for (const e of roh) {
        const text = e.periodText || e.lessonText || e.substText || '';
        if (!text) continue;
        const s = String(e.date);
        const datum = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        const zeit = String(e.startTime).padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2');
        texte.set(`${datum}|${zeit}`, text);
      }
    } catch {
      /* alte Schnittstelle liefert nicht fuer jede Woche Daten - dann eben ohne Text */
    }
    return texte;
  }

  async abmelden() {
    try {
      await this.client.logout();
    } catch {
      /* egal */
    }
  }
}

/**
 * Sortiert ALLE Positionen nach ihrem Typ (TEACHER/SUBJECT/ROOM/...).
 * Wichtig: position1..7 sind NICHT fest belegt - bei Terminen ohne Lehrer
 * rutscht sonst der Raum ins Fach-Feld.
 */
const nachTyp = (eintrag) => {
  const eimer = {};
  for (let i = 1; i <= 7; i++) {
    for (const p of eintrag[`position${i}`] ?? []) {
      const typ = p.current?.type ?? p.removed?.type;
      if (!typ) continue;
      (eimer[typ] ??= { aktuell: [], entfernt: [] });
      if (p.current) eimer[typ].aktuell.push(p.current);
      if (p.removed) eimer[typ].entfernt.push(p.removed);
    }
  }
  return eimer;
};

const feld = (eimer, typ) => {
  const t = eimer[typ];
  if (!t) return null;
  return {
    kurz: t.aktuell.map((a) => a.shortName).join(', '),
    lang: t.aktuell.map((a) => a.longName || a.shortName).join(', '),
    ersetzt: t.entfernt.length ? t.entfernt.map((r) => r.shortName).join(', ') : null,
  };
};

const uhr = (s) => (s ?? '').slice(11, 16);

/** Macht aus einem Roh-Eintrag ein sauberes Stunden-Objekt. */
export function normalisiere(e, datum) {
  const eimer = nachTyp(e);
  const lehrer = feld(eimer, 'TEACHER');
  const fach = feld(eimer, 'SUBJECT');
  const raum = feld(eimer, 'ROOM');
  const klasse = feld(eimer, 'CLASS');

  return {
    id: (e.ids ?? []).join('-'),
    datum,
    von: uhr(e.duration?.start),
    bis: uhr(e.duration?.end),
    typ: e.type, // NORMAL_TEACHING_PERIOD, EVENT, ...
    status: e.status, // REGULAR, CANCELLED, SUBSTITUTION, ...
    statusDetail: e.statusDetail,
    fach: fach?.kurz ?? '',
    fachLang: fach?.lang ?? '',
    fachErsetzt: fach?.ersetzt ?? null,
    lehrer: lehrer?.kurz ?? '',
    lehrerLang: lehrer?.lang ?? '',
    lehrerErsetzt: lehrer?.ersetzt ?? null,
    raum: raum?.kurz ?? '',
    raumLang: raum?.lang ?? '',
    raumErsetzt: raum?.ersetzt ?? null,
    klasse: klasse?.kurz ?? '',
    farbe: e.color ? `#${e.color}` : null,
    name: e.name ?? '',
    text: [e.lessonText, e.substitutionText, e.notesAll].filter(Boolean).join(' | '),
    icons: e.icons ?? [],
    spalte: e.layoutStartPosition ?? 0,
    breite: e.layoutWidth ?? 1000,
  };
}
