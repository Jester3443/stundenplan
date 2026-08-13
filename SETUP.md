# Was noch zu tun ist

Stand: App ist live auf **<https://stundenplan-jasper.web.app>**.
Ziel: Aktualisierung alle 15 Minuten aus der Cloud – dein PC kann aus sein.

## Schon erledigt

- ✅ Firebase-Projekt `stundenplan-jasper`, App veröffentlicht
- ✅ Cloud-Ablauf fertig geschrieben (`.github/workflows/sync.yml`):
  alle 15 Min an Schultagen (Mo–Fr, 6–18 Uhr), Plan holen → verschlüsseln →
  veröffentlichen → bei Änderungen Push. Kostenlos, ohne Limit.
- ✅ Keine E-Mail im Spiel: Als technischer Kontakt dient die App-Adresse selbst
- ✅ GitHub-Werkzeug (`gh`) auf dem PC installiert
- ✅ Übergangsweise aktualisiert dein PC noch selbst (Aufgabe „Stundenplan Sync",
  alle 30 Min solange er an ist) – fliegt raus, sobald die Cloud läuft

## Deine drei Schritte

### 1. Zugangscode – nochmal, er ist nicht gespeichert worden

```
notepad C:\Users\joffi\StundenplanApp\.env
```

Bei `APP_CODE=` deinen Code eintragen und **mit Strg+S speichern** (beim letzten
Mal ist genau das schiefgegangen – die Zeile war leer). Fenster erst danach schließen.

### 2. GitHub-Konto anlegen (einmalig, kostenlos, ~3 Minuten)

1. <https://github.com/signup> im Browser öffnen
2. **Private** E-Mail-Adresse verwenden (nicht die Firmen-Mail)
3. Benutzername und Passwort frei wählen, Bestätigungsmail anklicken

Das Konto kann nur du anlegen – alles danach übernehme ich.

### 3. Mir einmal Zugriff geben

Sag mir Bescheid, wenn das Konto steht. Dann starte ich `gh auth login` –
es erscheint ein 8-stelliger Code, den du auf der angezeigten GitHub-Seite
eingibst und bestätigst. Ab da richte ich alles Weitere selbst ein:
Repository, Geheimnisse, Cloud-Ablauf, Umstellung der App, Abschalten der
PC-Aufgabe.

## Danach: iPhone (wie gehabt)

1. **Safari** → `stundenplan-jasper.web.app` → Teilen → **Zum Home-Bildschirm**
2. Vom Home-Bildschirm öffnen, Zugangscode eingeben
3. Unten auf **Mitteilungen** tippen, erlauben, Text kopieren und mir geben –
   ich hinterlege ihn als Geheimnis in der Cloud

## Antworten auf deine Fragen

**Kostet das was?** Nein. GitHub Actions ist für öffentliche Repositories
unbegrenzt kostenlos, Firebase Hosting bleibt im Gratis-Tarif. Deine 2–10 €
bleiben bei dir. „Öffentlich" heißt: Der *Programmcode* ist einsehbar –
deine Zugangsdaten liegen im verschlüsselten Secret-Speicher, dein Stundenplan
ist AES-verschlüsselt, und die Protokolle geben keine Inhalte aus.

**Muss die App im Hintergrund laufen?** Nein. Die Push-Nachricht schickt Apple
aufs iPhone, die App kann dabei komplett zu sein. Öffnest du sie, holt sie sich
den frischen Stand von selbst.
