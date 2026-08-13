// Verschluesselung der Plandaten.
// Ziel: Auf dem Server liegt NUR ein unlesbarer Block. Der Zugangscode steht
// nirgends im Programmcode - die App kann damit ausschliesslich versuchen zu
// entschluesseln. Ist er falsch, scheitert das, ohne dass etwas verraten wird.
//
// Diese Werte muessen in Node und im Browser identisch sein.
export const KRYPTO = {
  runden: 310_000, // PBKDF2-Runden (Empfehlung des OWASP fuer SHA-256)
  salzLaenge: 16,
  ivLaenge: 12,
  schluesselBits: 256,
};

const b64 = {
  ein: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))),
  aus: (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)),
};

/** Leitet aus Code + Salz den AES-Schluessel ab. Bewusst langsam. */
export async function schluesselAusCode(code, salz) {
  const roh = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salz, iterations: KRYPTO.runden, hash: 'SHA-256' },
    roh,
    { name: 'AES-GCM', length: KRYPTO.schluesselBits },
    true, // exportierbar, damit wir ihn lokal ablegen koennen
    ['encrypt', 'decrypt']
  );
}

/** Entschluesselt ein Paket { salz, iv, daten } zu einem Objekt. */
export async function entschluesseln(paket, schluessel) {
  const klar = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64.aus(paket.iv) },
    schluessel,
    b64.aus(paket.daten)
  );
  return JSON.parse(new TextDecoder().decode(klar));
}

/** Verschluesselt ein Objekt. Wird im Browser nur fuer eigene Notizen gebraucht. */
export async function verschluesseln(objekt, schluessel) {
  const iv = crypto.getRandomValues(new Uint8Array(KRYPTO.ivLaenge));
  const daten = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    schluessel,
    new TextEncoder().encode(JSON.stringify(objekt))
  );
  return { iv: b64.ein(iv), daten: b64.ein(daten) };
}

/** Schluessel als Text sichern bzw. zurueckholen - damit der Code nur einmal noetig ist. */
export async function schluesselSichern(schluessel) {
  const roh = await crypto.subtle.exportKey('raw', schluessel);
  localStorage.setItem('schluessel', b64.ein(roh));
}

export async function schluesselLaden() {
  const gespeichert = localStorage.getItem('schluessel');
  if (!gespeichert) return null;
  try {
    return await crypto.subtle.importKey('raw', b64.aus(gespeichert), 'AES-GCM', true, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

export const schluesselVergessen = () => localStorage.removeItem('schluessel');

export { b64 };
