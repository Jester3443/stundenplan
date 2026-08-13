// Einmaliges Einrichtungsskript: Repository anlegen, Code hochladen,
// Geheimnisse setzen, ersten Cloud-Lauf starten. Schreibt ein Protokoll
// nach data/setup-log.txt (ohne geheime Werte).
import { spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const projekt = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(projekt);
mkdirSync(join(projekt, 'data'), { recursive: true });

const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const REPO = 'Jester3443/stundenplan';
const LOG = join(projekt, 'data', 'setup-log.txt');

writeFileSync(LOG, `Einrichtung ${new Date().toLocaleString('de-DE')}\r\n\r\n`, 'utf8');

const melde = (text) => {
  console.log(text);
  appendFileSync(LOG, text + '\r\n', 'utf8');
};

/** Fuehrt einen Befehl aus und protokolliert Ausgabe (gekuerzt). */
const lauf = (titel, exe, args, eingabe) => {
  melde(`\n== ${titel} ==`);
  const r = spawnSync(exe, args, {
    cwd: projekt,
    input: eingabe,
    encoding: 'utf8',
    windowsHide: true,
  });
  const ausgabe = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  melde(ausgabe.slice(0, 1500) || '(keine Ausgabe)');
  melde(`Ergebnis: ${r.status === 0 ? 'OK' : 'FEHLER (Code ' + r.status + ')'}`);
  return r.status === 0;
};

// 1) Gibt es das Repository schon?
const vorhanden = spawnSync(GH, ['repo', 'view', REPO, '--json', 'name'], {
  encoding: 'utf8',
  windowsHide: true,
}).status === 0;

if (!vorhanden) {
  const ok = lauf('Repository anlegen und hochladen', GH, [
    'repo', 'create', 'stundenplan', '--public', '--source', '.', '--push',
  ]);
  if (!ok) {
    melde('\nABBRUCH - Repository konnte nicht angelegt werden. Protokoll oben.');
    process.exit(1);
  }
} else {
  melde('\nRepository existiert schon.');
  // Sicherstellen, dass der aktuelle Stand hochgeladen ist
  const remote = spawnSync('git', ['remote'], { cwd: projekt, encoding: 'utf8' }).stdout ?? '';
  if (!remote.includes('origin')) {
    lauf('Remote verbinden', 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  }
  lauf('Code hochladen', GH, ['repo', 'sync', REPO, '--source', REPO]) ||
    lauf('Code hochladen (git)', 'git', ['push', '-u', 'origin', 'HEAD:main']);
}

// 2) Geheimnisse setzen - Werte kommen aus der .env und werden NIE angezeigt.
const geheimnisse = ['UNTIS_USER', 'UNTIS_SECRET', 'UNTIS_PASSWORD', 'APP_CODE', 'VAPID_PUBLIC', 'VAPID_PRIVATE'];
let gesetzt = 0;
for (const name of geheimnisse) {
  const wert = (process.env[name] ?? '').trim();
  if (!wert) {
    melde(`Geheimnis ${name}: leer, uebersprungen`);
    continue;
  }
  const r = spawnSync(GH, ['secret', 'set', name, '--repo', REPO], {
    input: wert,
    encoding: 'utf8',
    windowsHide: true,
  });
  melde(`Geheimnis ${name}: ${r.status === 0 ? 'gesetzt' : 'FEHLER - ' + (r.stderr ?? '').slice(0, 200)}`);
  if (r.status === 0) gesetzt++;
}

// 3) Ersten Lauf starten (kurz warten, bis GitHub den Ablauf registriert hat)
melde('\nWarte 20 Sekunden, bis GitHub den Ablauf registriert hat ...');
await new Promise((r) => setTimeout(r, 20_000));
lauf('Ersten Cloud-Lauf starten', GH, ['workflow', 'run', 'sync.yml', '--repo', REPO]);

melde(`\nFertig. ${gesetzt} Geheimnisse gesetzt. Protokoll: data\\setup-log.txt`);
