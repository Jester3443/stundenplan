// Gegenstueck zu public/shared/krypto.mjs fuer Node.
// Muss exakt dieselben Parameter benutzen, sonst kann der Browser nicht lesen.
import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { KRYPTO } from '../public/shared/krypto.mjs';

/**
 * Verschluesselt ein Objekt mit dem Zugangscode.
 * Ergebnis: { version, salz, iv, daten } - alles base64, direkt als JSON ablegbar.
 *
 * WICHTIG: salzB64 vom letzten Mal WIEDERVERWENDEN. Die App leitet aus
 * Code+Salz einmalig einen Schluessel ab und speichert ihn - wechselt das
 * Salz bei jeder Veroeffentlichung, wird der Nutzer jedes Mal ausgesperrt.
 * Nur der IV muss (und darf) jedes Mal frisch sein.
 */
export function verschluesseln(objekt, code, salzB64 = null) {
  if (!code || code.length < 4) throw new Error('Zugangscode fehlt oder ist zu kurz (mindestens 4 Zeichen).');

  const salz = salzB64 ? Buffer.from(salzB64, 'base64') : randomBytes(KRYPTO.salzLaenge);
  const iv = randomBytes(KRYPTO.ivLaenge);
  const schluessel = pbkdf2Sync(code, salz, KRYPTO.runden, KRYPTO.schluesselBits / 8, 'sha256');

  const cipher = createCipheriv('aes-256-gcm', schluessel, iv);
  const inhalt = Buffer.concat([cipher.update(JSON.stringify(objekt), 'utf8'), cipher.final()]);

  // WebCrypto erwartet Chiffrat und Pruefsumme aneinandergehaengt.
  const daten = Buffer.concat([inhalt, cipher.getAuthTag()]);

  return {
    version: 1,
    runden: KRYPTO.runden,
    salz: salz.toString('base64'),
    iv: iv.toString('base64'),
    daten: daten.toString('base64'),
  };
}

/** Gegenrichtung - wird gebraucht, um den zuletzt veroeffentlichten Stand zu lesen. */
export function entschluesseln(paket, code) {
  const salz = Buffer.from(paket.salz, 'base64');
  const iv = Buffer.from(paket.iv, 'base64');
  const alles = Buffer.from(paket.daten, 'base64');

  // Die letzten 16 Byte sind die Pruefsumme (so legt WebCrypto es ab).
  const inhalt = alles.subarray(0, alles.length - 16);
  const pruefsumme = alles.subarray(alles.length - 16);

  const schluessel = pbkdf2Sync(code, salz, paket.runden ?? KRYPTO.runden, KRYPTO.schluesselBits / 8, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', schluessel, iv);
  decipher.setAuthTag(pruefsumme);

  return JSON.parse(Buffer.concat([decipher.update(inhalt), decipher.final()]).toString('utf8'));
}
