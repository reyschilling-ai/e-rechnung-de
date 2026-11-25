# Browser-Version

Statische Seite ohne Server und ohne Build-Schritt. Zum lokalen Ausprobieren genügt ein einfacher Webserver:

```bash
cd web
python -m http.server 8000   # dann http://localhost:8000 öffnen
```

## Aufbau

| Datei | Aufgabe |
|---|---|
| `js/modell.js` | Beträge (BigInt, centgenau), Pflichtangaben, Texte |
| `js/cii.js` | XRechnung 3.0 (CII) erzeugen und einlesen |
| `js/pruefung.js` | offizielle Prüfregeln mit fontoxpath ausführen |
| `js/pdf.js` | Rechnung als PDF/A-3b, optional mit eingebetteter XRechnung (ZUGFeRD, Profil XRECHNUNG) |
| `js/speicher.js` | IndexedDB, Sicherung |
| `js/app.js` | Oberfläche |
| `regeln/regeln.json` | Prüfregeln, erzeugt mit `regeln/extract_rules.py` aus der KoSIT-Konfiguration |
| `vendor/` | pdf-lib, fontkit, gebündeltes fontoxpath (`npm run vendor`) |

## Tests

```bash
cd web && npm ci && npm test
```

Die CI prüft zusätzlich die im Browser-Code erzeugten Dateien mit dem KoSIT-Validator und mit Mustang (veraPDF), vergleicht die Browser-Prüfung Fall für Fall mit KoSIT und spielt die Seite in Chromium einmal komplett durch (`tests/e2e.py`).

## Prüfregeln aktualisieren

Neue KoSIT-Konfiguration herunterladen, dann:

```bash
python regeln/extract_rules.py regeln/regeln.json \
  en16931 <konfig>/resources/cii/16b/xsl/EN16931-CII-validation.xsl \
  xrechnung <konfig>/resources/xrechnung/<version>/xsl/XRechnung-CII-validation.xsl
```

Danach müssen `tests/vergleich_kosit.mjs` und alle anderen Tests grün sein.
