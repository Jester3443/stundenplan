// Deutsche Zeit fuer die Server-Skripte - der Server rechnet in UTC.
//
// Zum Testen laesst sich die Uhr verstellen: Mit PROBE_ZEIT="2026-11-16 07:47"
// tun erinnerungen.mjs und vorschau.mjs so, als waere es dieser Moment.
// Im Probebetrieb wird NICHTS verschickt und NICHTS vermerkt - es steht nur
// im Protokoll, was passiert waere.
const PROBE = (process.env.PROBE_ZEIT ?? '').trim();
const MUSTER = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/;

if (PROBE && !MUSTER.test(PROBE)) {
  console.error('PROBE_ZEIT muss die Form "JJJJ-MM-TT HH:MM" haben (deutsche Zeit).');
  process.exit(1);
}

/** Laeuft das Skript nur zur Probe? */
export const istProbe = PROBE !== '';

/** Jetzt in deutscher Zeit: { datum: 'JJJJ-MM-TT', minuten: Minuten seit Mitternacht }. */
export function jetztBerlin() {
  if (istProbe) {
    const [, datum, hh, mm] = PROBE.match(MUSTER);
    return { datum, minuten: Number(hh) * 60 + Number(mm) };
  }
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((t) => [t.type, t.value])
  );
  return {
    datum: `${teile.year}-${teile.month}-${teile.day}`,
    minuten: (Number(teile.hour) % 24) * 60 + Number(teile.minute),
  };
}

/** Kalendertag plus n Tage - reine Datumsrechnung, unabhaengig von der Zeitumstellung. */
export function plusTage(datum, n) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "08:00" -> 480 */
export const minutenVon = (uhr) => Number(uhr.slice(0, 2)) * 60 + Number(uhr.slice(3, 5));
