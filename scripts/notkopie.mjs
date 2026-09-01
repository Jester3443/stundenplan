// Holt die veroeffentlichten Plandaten nach public/data.
//
// Warum: Die App laedt normalerweise von raw.githubusercontent.com. Faellt das
// aus, greift sie auf die mitausgelieferte Kopie auf dem Webspace zurueck.
// Diese Kopie MUSS mit demselben Salz verschluesselt sein wie die
// veroeffentlichte - sonst passt der auf dem Geraet gespeicherte Schluessel
// nicht dazu. Ein lokaler `npm run sync` erzeugt aber seine eigene Kette.
// Deshalb vor jedem `firebase deploy` einmal dieses Skript laufen lassen.
import { writeFile } from 'node:fs/promises';
import { BENUTZER } from '../public/shared/konfiguration.mjs';

const BASIS = 'https://raw.githubusercontent.com/Jester3443/stundenplan/data';

let geholt = 0;
for (const kennung of Object.keys(BENUTZER)) {
  const antwort = await fetch(`${BASIS}/plan-${kennung}.enc.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!antwort.ok) {
    console.warn(`${kennung}: nicht veroeffentlicht (HTTP ${antwort.status}) - uebersprungen.`);
    continue;
  }
  const text = await antwort.text();
  const paket = JSON.parse(text);
  if (!paket.salz || !paket.iv || !paket.daten) {
    console.warn(`${kennung}: Antwort sieht nicht wie ein Datenpaket aus - uebersprungen.`);
    continue;
  }
  await writeFile(`public/data/plan-${kennung}.enc.json`, text, 'utf8');
  // Der alte Dateiname, den aeltere App-Versionen auf dem Handy noch abfragen.
  if (kennung === 'jasper') await writeFile('public/data/plan.enc.json', text, 'utf8');
  console.log(`${kennung}: uebernommen (Salz ${paket.salz.slice(0, 8)}…)`);
  geholt++;
}

if (!geholt) {
  console.error('Keine einzige Datei uebernommen - Deploy lieber verschieben.');
  process.exit(1);
}
