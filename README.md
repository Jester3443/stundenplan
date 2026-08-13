# Stundenplan

Ein persönlicher Stundenplan für Jasper (IGS Osterholz-Scharmbeck) auf Basis von WebUntis –
mit dem, was WebUntis selbst nicht kann: **nur die eigenen Kurse**, sauber getrennte
**A/B-Wochen** und **Änderungen auf den ersten Blick**.

## Warum es das gibt

WebUntis liefert für die Oberstufe den kompletten Jahrgangsplan – rund **51 Stunden pro Woche**,
von denen nur etwa 13 Blöcke einen betreffen. Auch die offizielle Ansicht „Mein Stundenplan"
ändert daran nichts, weil die Schule in Untis keine Kurszuordnung je Schüler gepflegt hat.
Diese App filtert deshalb selbst.

## Schnellstart

```bash
npm install
npm start
```

Danach im Browser: <http://localhost:4173>

`npm start` holt zuerst den aktuellen Plan von WebUntis und startet dann den Webserver.

## Befehle

| Befehl | Was passiert |
| --- | --- |
| `npm start` | Plan abrufen und App starten |
| `npm run sync` | Nur den Plan abrufen und `public/data/plan.json` schreiben |
| `npm run serve` | Nur den Webserver starten |
| `npm run test:login` | Prüfen, ob die Zugangsdaten funktionieren |
| `npm run dump` | Rohdaten mehrerer Wochen zur Kontrolle ausgeben |
| `npm run icons` | App-Icons neu erzeugen |

## Zugangsdaten

Alles steht in `.env`, die nie das Gerät verlässt und von Git ausgeschlossen ist.

```
UNTIS_SCHOOL=igs-osterholz-scharmbeck
UNTIS_HOST=igs-osterholz-scharmbeck.webuntis.com
UNTIS_USER=dein.benutzername
UNTIS_SECRET=…      # App-Schlüssel aus Profil → Freigaben (bevorzugt)
UNTIS_PASSWORD=…    # Alternative, falls es keinen App-Schlüssel gibt
```

Ist `UNTIS_SECRET` gesetzt, wird der App-Schlüssel benutzt und das Passwort ignoriert.
Der Schlüssel überlebt Passwortwechsel – deshalb ist er die bessere Wahl.

## Aufbau

```
public/                   die App selbst (das, was aufs Handy kommt)
  index.html
  styles.css              iOS-Optik, dunkel und hell
  app.js                  Darstellung, Tageswechsel, Wochenansicht
  sw.js                   Offline-Betrieb
  shared/konfiguration.mjs  Kurse, Farben, Stundenraster, A/B-Logik
  data/plan.json          der abgerufene Plan (wird von sync erzeugt)
scripts/
  untis-rest.mjs          Zugriff auf die WebUntis-REST-API
  sync.mjs                abrufen, filtern, Änderungen erkennen
  server.mjs              kleiner Webserver für die Entwicklung
  icons.mjs               erzeugt die App-Icons als PNG
  test-login.mjs          Verbindungstest
  dump-my.mjs             Rohdaten zur Kontrolle
```

## Wie die Daten geholt werden

WebUntis hat keine offizielle öffentliche API. Der Weg, den `untis-rest.mjs` geht:

1. Anmelden über die JSON-RPC-Schnittstelle (Bibliothek `webuntis`, mit TOTP-Schlüssel)
2. Aus der Sitzung die Cookies `JSESSIONID` und `schoolname` bauen
3. Damit unter `/WebUntis/api/token/new` einen Bearer-Token holen
4. Mit dem Token die moderne Schnittstelle abfragen:
   `/WebUntis/api/rest/view/v1/timetable/entries?…&timetableType=MY_TIMETABLE`

Nur dieser letzte Endpunkt liefert zusammengefasste Doppelstunden, Klarnamen und – wichtig –
zu jeder Stunde den vorherigen Wert (`removed`), sodass sich „Wilshusen → Meier" anzeigen lässt.

## Kursfilter

Die acht Kurse stehen in `public/shared/konfiguration.mjs`. Der Abgleich erfolgt über Kürzel
**und** Lehrer, weil Untis Groß- und Kleinschreibung unterscheidet: Es gibt `GE1` (Meier, seiner)
und `ge1` (han), `ph1` (sim, seiner) und `PH1` (mey). Ein reiner Textvergleich ohne
Beachtung der Schreibweise würde die falschen Kurse einsammeln.

## Verschlüsselung

Sobald `APP_CODE` gesetzt ist, schreibt `sync` **nur noch** `public/data/plan.enc.json` –
einen mit AES-256-GCM verschlüsselten Block. Der Schlüssel wird über PBKDF2-SHA256 mit
310.000 Runden aus dem Code abgeleitet. Der Klartext bleibt in `data/letzter-plan.json`
und verlässt das Gerät nie.

Die App kennt den Code **nicht**. Sie kann damit nur versuchen zu entschlüsseln; schlägt das
fehl, gibt es keine Rückmeldung außer „Code stimmt nicht". Ein Angreifer, der die Seite
aufruft oder den Quelltext liest, findet weder Daten noch Code. Nach dem ersten Entsperren
liegt der abgeleitete Schlüssel lokal im Browser, damit der Code nur einmal nötig ist.

Eigene Hausaufgaben und Notizen werden mit demselben Schlüssel geschützt und bleiben
ausschließlich auf dem Gerät.

## Veröffentlichen

Siehe [SETUP.md](SETUP.md). Kurz: Firebase Hosting liefert die Seite aus, ein GitHub-Ablauf
holt alle 30 Minuten den Plan, verschlüsselt ihn, verschickt bei Änderungen eine Mitteilung
und lädt das Ergebnis hoch. Als Vergleichsbasis lädt der Ablauf den zuletzt veröffentlichten
Stand von der eigenen Seite und entschlüsselt ihn – so weiß er auch ohne eigenen Speicher,
was sich verändert hat.

## Bekannte Grenzen

- Klausurtermine sperrt die Schule (HTTP 403).
- Der Plan ist meist nur zwei bis drei Wochen im Voraus veröffentlicht; weiter entfernte
  Wochen kommen leer zurück und werden als „noch nicht veröffentlicht" angezeigt.
- Push-Nachrichten aufs iPhone brauchen ein Hosting mit HTTPS und die Installation
  über „Zum Home-Bildschirm" – siehe offene Punkte.
