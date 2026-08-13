# Stand der Einrichtung

## ✅ Fertig – läuft ohne deinen PC

- App live: **<https://stundenplan-jasper.web.app>**
- Cloud-Automatik: GitHub Actions ruft **alle 15 Minuten** (Mo–Fr, 6–18 Uhr)
  den Plan ab, verschlüsselt ihn und veröffentlicht ihn. Kostenlos, unbegrenzt.
  Repository: <https://github.com/Jester3443/stundenplan>
- Zugangsdaten liegen im verschlüsselten Secret-Speicher von GitHub
- Die App holt die Daten direkt aus der Cloud – dein PC kann aus sein
- Die alte PC-Aufgabe („Stundenplan Sync") ist gelöscht
- Keine E-Mail-Adresse im Einsatz

## 📱 Deine letzten zwei Schritte (am iPhone)

1. **Installieren:** Safari → `stundenplan-jasper.web.app` → Teilen →
   **Zum Home-Bildschirm** → Hinzufügen. Vom Home-Bildschirm öffnen,
   Zugangscode eingeben (nur dieses eine Mal).
2. **Push aktivieren:** Unten auf **Mitteilungen** tippen → erlauben →
   **Anmeldung kopieren** → den Text an Claude geben (oder selbst am PC
   ausführen: `gh secret set PUSH_SUBSCRIPTION --repo Jester3443/stundenplan`
   und den Text einfügen).

Danach kommen Entfall, Raumwechsel und neue Lehrer-Hausaufgaben als
Push-Nachricht aufs iPhone – egal ob App oder PC an sind.

## Nachschlagen

- **Läuft die Cloud?** <https://github.com/Jester3443/stundenplan/actions> –
  grüne Häkchen = alles gut. Lauf von Hand starten: dort „Stundenplan abrufen"
  → „Run workflow".
- **Code ändern/neu veröffentlichen:** Änderungen committen und pushen; die
  App-Oberfläche wird mit `firebase deploy --only hosting` veröffentlicht.
- **Zugangscode ändern:** Neuen Wert in `.env` (Zeile `APP_CODE=`) UND als
  GitHub-Secret `APP_CODE` setzen; auf dem iPhone einmal neu eingeben.
- **Push-Anmeldung erneuern** (falls Mitteilungen irgendwann ausbleiben):
  in der App auf „Mitteilungen" tippen und den neuen Text wieder als Secret
  `PUSH_SUBSCRIPTION` hinterlegen.
