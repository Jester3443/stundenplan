// Winziger statischer Webserver fuer die Entwicklung - ohne Zusatzpakete.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const WURZEL = new URL('../public/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PORT = Number(process.env.PORT ?? 4173);

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (anfrage, antwort) => {
  try {
    const pfad = decodeURIComponent(new URL(anfrage.url, 'http://x').pathname);
    let ziel = join(WURZEL, normalize(pfad).replace(/^([/\\])+/, ''));
    if (!ziel.startsWith(normalize(WURZEL))) {
      antwort.writeHead(403).end('Verboten');
      return;
    }
    const info = await stat(ziel).catch(() => null);
    if (!info || info.isDirectory()) ziel = join(ziel, 'index.html');

    const daten = await readFile(ziel);
    antwort.writeHead(200, {
      'Content-Type': TYPEN[extname(ziel)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    antwort.end(daten);
  } catch {
    antwort.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}).listen(PORT, () => console.log(`Stundenplan laeuft auf http://localhost:${PORT}`));
