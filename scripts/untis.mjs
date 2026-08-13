// Gemeinsame Verbindungs-Logik: liest die .env und baut den passenden Client.
import 'dotenv/config';
import { WebUntis, WebUntisSecretAuth } from 'webuntis';

const need = (key) => {
  const value = (process.env[key] ?? '').trim();
  if (!value) throw new Error(`In der .env fehlt: ${key}`);
  return value;
};

export function createClient() {
  const school = need('UNTIS_SCHOOL');
  const host = need('UNTIS_HOST');
  const user = need('UNTIS_USER');

  const secret = (process.env.UNTIS_SECRET ?? '').trim();
  const password = (process.env.UNTIS_PASSWORD ?? '').trim();

  if (secret) {
    // Variante A: App-Schluessel (TOTP) - ueberlebt Passwortwechsel.
    return {
      mode: 'App-Schluessel',
      client: new WebUntisSecretAuth(school, user, secret, host, 'stundenplan-app'),
    };
  }
  if (password) {
    // Variante B: klassisches Passwort.
    return { mode: 'Passwort', client: new WebUntis(school, user, password, host) };
  }
  throw new Error('In der .env muss entweder UNTIS_SECRET oder UNTIS_PASSWORD ausgefuellt sein.');
}

/** Untis liefert Datumsangaben als Zahl 20260817 -> "17.08.2026" */
export const untisDateToText = (n) => {
  const s = String(n);
  return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
};

/** Untis liefert Uhrzeiten als Zahl 815 -> "08:15" */
export const untisTimeToText = (n) => String(n).padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2');
