---
name: e-rechnung
description: Wandelt eine deutsche Rechnung (Word, PDF oder Angaben im Chat) in eine geprüfte E-Rechnung um, also XRechnung-XML und ZUGFeRD-PDF. Für Anfragen wie "mach daraus eine E-Rechnung", "XRechnung erstellen" oder "ZUGFeRD".
---

# E-Rechnung aus einer bestehenden Rechnung

Dieser Skill nutzt das Repo `e-rechnung-de`. Das Ergebnis ist eine E-Rechnung, die den offiziellen KoSIT-Validator und Mustang besteht. Steuerliche Beratung leistet der Skill nicht.

## Ablauf

1. **Werkzeug bereitstellen.** Ist das Kommando `erechnung` noch nicht installiert, klone das Repo und führe `pip install -e .` aus. Danach `erechnung werkzeuge` aufrufen; das braucht Java ab Version 11.

2. **Rechnung lesen.** Lies die Vorlage vollständig, bei Word-Dateien auch Kopf- und Fußzeilen sowie Textfelder, denn dort stehen oft Steuernummer, IBAN und Absender. `python-docx` übersieht Textfelder; lies im Zweifel `word/document.xml` und `word/footer*.xml` direkt aus.

3. **YAML-Datei füllen.** Nimm als Vorlage das Beispiel aus `beispiele/`, das zum Steuerfall passt:
   - Hinweis auf § 19 UStG → `steuerfall: kleinunternehmer`
   - Hinweis auf Reverse Charge oder § 13b UStG und ein Kunde im EU-Ausland → `steuerfall: reverse_charge`
   - sonst `steuerfall: regulaer` mit dem Steuersatz je Position

   Beträge stehen netto und mit Punkt als Dezimalzeichen, Datumsangaben im Format `JJJJ-MM-TT`. Übernimm nur, was in der Vorlage steht. Steuernummer, IBAN und Adressen dürfen nicht erraten werden.

4. **Fehlende Pflichtangaben erfragen**, bevor du erzeugst. Typischerweise fehlen:
   - `kaeufer.email`: die E-Mail-Adresse, unter der der Kunde Rechnungen empfängt. Sie steht fast nie auf einer Word-Rechnung. Frag danach und setze keine Platzhalter-Adresse in eine Rechnung, die verschickt werden soll.
   - `rechnung.kaeuferreferenz`: Bestell- oder PO-Nummer des Kunden, bei Behörden die Leitweg-ID. Fehlt sie, ist `n/a` erlaubt; weise darauf hin.
   - `verkaeufer.telefon`, falls die Vorlage keins enthält

   Ist niemand zum Fragen da, erzeuge mit einem klar markierten Platzhalter wie `PLATZHALTER@kunde.invalid`, nenne die Datei als Entwurf und sag, was ersetzt werden muss.

5. **Erzeugen und prüfen.**
   ```bash
   erechnung erstellen rechnung.yaml --pdf vorlage.docx -o ausgabe
   ```
   Liegt eine PDF statt einer Word-Datei vor, muss sie PDF/A sein. Sonst die Word-Datei nehmen oder um eine PDF/A-Version bitten. Bei „UNGÜLTIG“ zuerst die Meldungen lesen: Die Regel-ID (z. B. `BR-DE-15`) nennt das fehlende oder falsche Feld. Daten korrigieren, neu erzeugen und niemals eine ungültige Datei ausliefern.

6. **Abgleich.** Vergleiche Summen, Rechnungsnummer, Datum und IBAN im XML mit der sichtbaren Vorlage. Bei einer Abweichung gilt das XML rechtlich, deshalb müssen beide übereinstimmen.

7. **Ausliefern.** Gib die ZUGFeRD-PDF als Hauptdatei zurück, dazu das XRechnung-XML und den Prüfbericht. Nenne in ein bis zwei Sätzen den gewählten Steuerfall und die Annahmen, die du getroffen hast.

## Hinweise für die Antwort

- Kleinunternehmer (§ 34a UStDV) und Kleinbetragsrechnungen bis 250 € brutto sind von der Pflicht zur E-Rechnung ausgenommen. Erwähne das kurz, wenn es zutrifft; freiwillig darf man trotzdem E-Rechnungen schicken.
- Gutschriften, Rabatte auf Rechnungsebene und andere Zahlungsarten als SEPA-Überweisung unterstützt das Werkzeug nicht. Sag das offen, statt sie nachzubauen.
