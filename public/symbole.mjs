// Ein Zeichen je Fach - zusaetzlich zur Farbe. Hilft vor allem in der
// schmalen Wochenansicht beim schnellen Erkennen.
// Bewusst als Strichzeichnung (currentColor), damit sie die Fachfarbe
// uebernimmt und in hell wie dunkel funktioniert.

const PFADE = {
  Deutsch:
    '<path d="M12 6.6C10.4 5.3 8.4 4.6 6 4.6H4v12.8h2c2.4 0 4.4.7 6 2m0-14.8c1.6-1.3 3.6-2 6-2h2v12.8h-2c-2.4 0-4.4.7-6 2m0-14.8v14.8"/>',
  Mathematik:
    '<path d="M4.5 20V4M4.5 20h15"/><path d="M7.5 16.5c2.8 0 2.8-8.5 5.5-8.5s2.8 5.5 5.5 5.5"/>',
  Englisch:
    '<path d="M20.5 11.4c0 4.3-3.8 7.8-8.5 7.8-.9 0-1.8-.1-2.6-.4L4.5 20.5l1.3-3.9a7.5 7.5 0 0 1-2.3-5.2c0-4.3 3.8-7.8 8.5-7.8s8.5 3.5 8.5 7.8z"/>',
  Biologie:
    '<path d="M11.5 19.5A6.5 6.5 0 0 1 10.4 6.6C15.7 5.5 17.1 5 19 3.6c.9 1.9 1.8 3.9 1.8 6.5a6.5 6.5 0 0 1-9.3 9.4z"/><path d="M3 20.5c0-2.8 1.8-6.4 5.1-8.8"/>',
  Physik:
    '<circle cx="12" cy="12" r="1.9"/><ellipse cx="12" cy="12" rx="9.3" ry="4.1"/><ellipse cx="12" cy="12" rx="9.3" ry="4.1" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.3" ry="4.1" transform="rotate(120 12 12)"/>',
  Geschichte:
    '<path d="M3 20.6h18M5.4 20.6V9.4M9.8 20.6V9.4M14.2 20.6V9.4M18.6 20.6V9.4M3 9.4h18L12 3.4 3 9.4z"/>',
  Erdkunde:
    '<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6"/><path d="M12 3.2a13.5 13.5 0 0 1 0 17.6 13.5 13.5 0 0 1 0-17.6z"/>',
  Seminarfach:
    '<path d="M9.4 18.4h5.2M10.4 21h3.2"/><path d="M12 3.2a5.9 5.9 0 0 0-3.4 10.7c.6.4.9 1.1.9 1.8v.7h5v-.7c0-.7.3-1.4.9-1.8A5.9 5.9 0 0 0 12 3.2z"/>',
  Sport:
    '<path d="M6.5 7.5v9M17.5 7.5v9M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  Chemie:
    '<path d="M9.5 3h5M10 3v6.5L4.6 19a1.5 1.5 0 0 0 1.3 2.2h12.2a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M7.4 15.5h9.2"/>',
  Politik:
    '<rect x="3.5" y="11" width="17" height="9.5" rx="1.8"/><path d="M8 11V4.5h8V11M12 8h0M9.5 11h5"/>',
  'Werte und Normen':
    '<path d="M12 3.5v17M8.5 20.5h7M4 12.5l3-6 3 6a3 3 0 0 1-6 0zM14 12.5l3-6 3 6a3 3 0 0 1-6 0z"/><path d="M7 6.5h10"/>',
  Spanisch:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  // Termine ohne Fach
  Termin:
    '<rect x="3.4" y="5.4" width="17.2" height="15.2" rx="2.4"/><path d="M3.4 10.2h17.2M8.2 3v4.4M15.8 3v4.4"/>',
};

/**
 * Liefert das Symbol als SVG-Text.
 * groesse in Pixeln; strich steuert die Linienstaerke.
 */
export function symbolFuer(fachName, { groesse = 16, strich = 1.7 } = {}) {
  const pfad = PFADE[fachName] ?? PFADE.Termin;
  return (
    `<svg class="fach-symbol" width="${groesse}" height="${groesse}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${strich}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pfad}</svg>`
  );
}

export const hatSymbol = (fachName) => Object.hasOwn(PFADE, fachName);
