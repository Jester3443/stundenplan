// Externer Anstoss fuer den Stundenplan-Abruf - laeuft als Google Apps Script.
//
// WARUM: GitHub fuehrt zeitgesteuerte Workflows nur "nach Moeglichkeit" aus.
// Seit Mitte September 2026 kamen von 150 geplanten Laeufen am Tag nur noch
// 6 bis 10 an. Dieses Skript stoesst den Lauf stattdessen selbst an - alle
// fuenf Minuten, zuverlaessig, kostenlos, ohne neues Konto (Jaspers Google-
// Konto reicht, mit dem auch GitHub angemeldet ist).
//
// EINRICHTEN (einmalig, etwa fuenf Minuten):
//   1. GitHub -> Settings -> Developer settings -> Personal access tokens
//      -> Fine-grained tokens -> "Generate new token"
//        Name: Stundenplan-Anstoss, Ablauf: 1 Jahr (laenger gibt es nicht),
//        Repository access: Only select repositories -> stundenplan,
//        Permissions -> Repository permissions -> Actions: Read and write.
//      Token kopieren (wird nur einmal angezeigt).
//   2. https://script.google.com -> Neues Projekt -> diesen Text komplett
//      in Code.gs einfuegen (den vorhandenen Inhalt ersetzen) -> speichern.
//   3. Links Zahnrad "Projekteinstellungen" -> Skript-Eigenschaften ->
//      Eigenschaft hinzufuegen: Name GITHUB_TOKEN, Wert = das Token.
//   4. Oben im Editor die Funktion "einrichten" auswaehlen -> Ausfuehren.
//      Google fragt einmal nach Berechtigungen (externe Dienste aufrufen,
//      Trigger anlegen) - bestaetigen. Fertig.
//
// Prueft man spaeter unter "Ausfuehrungen" links, ob es laeuft.
// Laeuft das Token ab, nur Schritt 1 und 3 wiederholen.

const REPO = 'Jester3443/stundenplan';
const WORKFLOW = 'sync.yml';
const ZWEIG = 'master';

/** Alle fuenf Minuten: Was ist jetzt dran? */
function anstossen() {
  const jetzt = new Date();
  const zeit = Utilities.formatDate(jetzt, 'Europe/Berlin', 'u HH mm'); // u: 1 = Montag ... 7 = Sonntag
  const [wt, hh, mm] = zeit.split(' ').map(Number);
  const schultag = wt >= 1 && wt <= 5;
  const vorSchultag = wt >= 7 || wt <= 4; // Sonntag bis Donnerstag
  const heute = Utilities.formatDate(jetzt, 'Europe/Berlin', 'yyyy-MM-dd');

  let aufgabe = null;

  // Tagesmeldungen - jede hoechstens einmal am Tag.
  if (schultag && hh === 6 && mm >= 30 && mm < 40) aufgabe = einmalTaeglich_('morgen', heute);
  else if (vorSchultag && hh === 15 && mm >= 40 && mm < 50) aufgabe = einmalTaeglich_('aufgaben', heute);
  else if (vorSchultag && hh === 21 && mm >= 0 && mm < 10) aufgabe = einmalTaeglich_('abend', heute);

  // Sonst: waehrend der Schulzeit der Abgleich - viermal am Tag vollstaendig.
  if (!aufgabe && schultag && hh >= 6 && hh < 19) {
    aufgabe = [6, 10, 14, 18].includes(hh) && mm < 5 ? 'voll' : 'schnell';
  }

  if (!aufgabe) return; // nachts und am Wochenende passiert nichts
  workflowStarten_(aufgabe);
}

/** Liefert die Aufgabe nur, wenn sie heute noch nicht angestossen wurde. */
function einmalTaeglich_(aufgabe, heute) {
  const ablage = PropertiesService.getScriptProperties();
  if (ablage.getProperty('zuletzt_' + aufgabe) === heute) return null;
  ablage.setProperty('zuletzt_' + aufgabe, heute);
  return aufgabe;
}

function workflowStarten_(aufgabe) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN fehlt in den Skript-Eigenschaften (Projekteinstellungen).');

  const antwort = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      payload: JSON.stringify({ ref: ZWEIG, inputs: { aufgabe: aufgabe } }),
      muteHttpExceptions: true,
    }
  );
  // 204 = angenommen. Alles andere ins Protokoll, damit man es unter
  // "Ausfuehrungen" sieht.
  if (antwort.getResponseCode() !== 204) {
    console.error('GitHub antwortet ' + antwort.getResponseCode() + ': ' + antwort.getContentText().slice(0, 200));
  } else {
    console.log('Angestossen: ' + aufgabe);
  }
}

/** Einmal ausfuehren: legt den Fuenf-Minuten-Trigger an (alte werden ersetzt). */
function einrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('anstossen').timeBased().everyMinutes(5).create();
  // Gleich einmal probieren, damit man sofort sieht, ob das Token stimmt.
  workflowStarten_('schnell');
  console.log('Trigger angelegt. Ab jetzt alle fuenf Minuten.');
}
