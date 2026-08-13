// Erzeugt die App-Icons als PNG - ohne Zusatzbibliothek, nur mit zlib.
// Motiv: dunkler Grund mit sechs farbigen Stundenbloecken im Raster.
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';

const GROESSEN = [180, 192, 512, 1024];
const GRUND = [0x11, 0x11, 0x13];
const BLOCKFARBEN = [
  [0xff, 0x45, 0x3a], // rot   - Deutsch
  [0x0a, 0x84, 0xff], // blau  - Mathe
  [0x30, 0xd1, 0x58], // gruen - Biologie
  [0xff, 0x9f, 0x0a], // orange- Geschichte
  [0xbf, 0x5a, 0xf2], // lila  - Physik
  [0x40, 0xcb, 0xe0], // tuerkis - Englisch
];

// ---------------------------------------------------------------- PNG-Bau
const tabelle = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = tabelle[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (typ, daten) => {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(koerper));
  return Buffer.concat([laenge, koerper, pruef]);
};

function alsPng(breite, hoehe, pixel /* RGBA, Uint8Array */) {
  const roh = Buffer.alloc((breite * 4 + 1) * hoehe);
  for (let y = 0; y < hoehe; y++) {
    roh[y * (breite * 4 + 1)] = 0; // Filtertyp "keiner"
    pixel.copy
      ? pixel.copy(roh, y * (breite * 4 + 1) + 1, y * breite * 4, (y + 1) * breite * 4)
      : Buffer.from(pixel.subarray(y * breite * 4, (y + 1) * breite * 4)).copy(roh, y * (breite * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- Zeichnen
/** Deckungsgrad eines Punktes in einem Rechteck mit runden Ecken (0..1). */
function deckung(x, y, links, oben, breite, hoehe, radius) {
  const rechts = links + breite;
  const unten = oben + hoehe;
  if (x < links || x > rechts || y < oben || y > unten) return 0;
  const cx = Math.min(Math.max(x, links + radius), rechts - radius);
  const cy = Math.min(Math.max(y, oben + radius), unten - radius);
  const abstand = Math.hypot(x - cx, y - cy);
  return Math.min(Math.max(radius + 0.5 - abstand, 0), 1);
}

function zeichne(groesse) {
  const pixel = Buffer.alloc(groesse * groesse * 4);
  const e = groesse / 100; // eine "Einheit" = 1 % der Kantenlaenge

  // Layout: zwei Spalten, drei Zeilen, mit Rand.
  const rand = 18 * e;
  const luecke = 7 * e;
  const spalte = (groesse - 2 * rand - luecke) / 2;
  const zeile = (groesse - 2 * rand - 2 * luecke) / 3;
  const radius = 3.2 * e;

  const bloecke = BLOCKFARBEN.map((farbe, i) => ({
    farbe,
    links: rand + (i % 2) * (spalte + luecke),
    oben: rand + Math.floor(i / 2) * (zeile + luecke),
    // Zweite Spalte der mittleren Zeile bleibt kuerzer - das wirkt wie ein echter Plan.
    breite: spalte,
    hoehe: i === 3 ? zeile * 0.55 : zeile,
  }));

  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      const i = (y * groesse + x) * 4;
      let [r, g, b] = GRUND;

      // 2x2-Ueberabtastung fuer weiche Kanten
      for (const block of bloecke) {
        let deck = 0;
        for (const dy of [0.25, 0.75]) {
          for (const dx of [0.25, 0.75]) {
            deck += deckung(x + dx, y + dy, block.links, block.oben, block.breite, block.hoehe, radius);
          }
        }
        deck /= 4;
        if (deck > 0) {
          r = Math.round(r * (1 - deck) + block.farbe[0] * deck);
          g = Math.round(g * (1 - deck) + block.farbe[1] * deck);
          b = Math.round(b * (1 - deck) + block.farbe[2] * deck);
        }
      }

      pixel[i] = r;
      pixel[i + 1] = g;
      pixel[i + 2] = b;
      pixel[i + 3] = 255;
    }
  }
  return alsPng(groesse, groesse, pixel);
}

await mkdir('public/icons', { recursive: true });
for (const groesse of GROESSEN) {
  const datei = `public/icons/icon-${groesse}.png`;
  await writeFile(datei, zeichne(groesse));
  console.log(`  ${datei}`);
}
console.log('\nIcons erzeugt.\n');
