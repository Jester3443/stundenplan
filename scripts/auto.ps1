# Automatiklauf: holt den Plan, verschickt ggf. eine Mitteilung und
# veroeffentlicht die verschluesselten Daten. Wird von der Windows-
# Aufgabenplanung alle 30 Minuten gestartet.
# -Erzwingen ueberspringt die Zeitpruefung (fuer Tests von Hand).
param([switch]$Erzwingen)

$ErrorActionPreference = 'Continue'

$projekt = 'C:\Users\joffi\StundenplanApp'
$log = Join-Path $projekt 'data\auto.log'

# Nur an Schultagen und zu sinnvollen Zeiten arbeiten.
$jetzt = Get-Date
if (-not $Erzwingen) {
    if ($jetzt.DayOfWeek -in 'Saturday', 'Sunday') { exit 0 }
    if ($jetzt.Hour -lt 6 -or $jetzt.Hour -ge 18) { exit 0 }
}

Set-Location $projekt
New-Item -ItemType Directory -Force -Path (Join-Path $projekt 'data') | Out-Null

# Log klein halten
if ((Test-Path $log) -and (Get-Item $log).Length -gt 512KB) {
    Get-Content $log -Tail 200 | Set-Content $log -Encoding utf8
}

function Schreibe($text) {
    Add-Content -Path $log -Encoding utf8 -Value ("[{0}] {1}" -f (Get-Date -Format 'dd.MM. HH:mm'), $text)
}

Schreibe 'Lauf beginnt'

# 1) Plan holen (verschluesselt, wenn APP_CODE in der .env steht)
$sync = & node scripts\sync.mjs 4 2>&1
if ($LASTEXITCODE -ne 0) {
    Schreibe ("Sync fehlgeschlagen: " + (($sync | Select-Object -Last 3) -join ' | '))
    exit 1
}
$aenderungen = ($sync | Select-String 'Aenderung\(en\)' | Select-Object -First 1).ToString().Trim()
Schreibe ("Sync ok. " + $aenderungen)

# 2) Ohne Verschluesselung wird nichts veroeffentlicht.
if (-not (Test-Path 'public\data\plan.enc.json')) {
    Schreibe 'Kein APP_CODE gesetzt - Veroeffentlichung uebersprungen.'
    exit 0
}

# 3) Mitteilung verschicken, falls es Aenderungen gab
$push = & node scripts\push.mjs 2>&1
Schreibe ("Push: " + (($push | Select-Object -Last 1) -join ''))

# 4) Veroeffentlichen
$deploy = & "$env:APPDATA\npm\firebase.cmd" deploy --only hosting --project stundenplan-jasper 2>&1
if ($LASTEXITCODE -eq 0) {
    Schreibe 'Veroeffentlicht.'
} else {
    Schreibe ("Deploy fehlgeschlagen: " + (($deploy | Select-Object -Last 3) -join ' | '))
    exit 1
}
