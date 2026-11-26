# Verfahrensdokumentation Rechnungsausgang

Vorlage für Unternehmen, die ihre Ausgangsrechnungen mit dem Werkzeug „E-Rechnung“ (https://reyschilling-ai.github.io/e-rechnung-de/) schreiben und selbst archivieren. Alles in [eckigen Klammern] ersetzen Sie durch Ihre Angaben. Was auf Ihren Betrieb nicht zutrifft, streichen Sie. Die Vorlage ist kein Steuerrat; lassen Sie die fertige Fassung am besten von Ihrer Steuerberatung ansehen.

Stand: [Datum] · Version: [1.0] · Verantwortlich: [Name]

## 1. Allgemeine Beschreibung

**Unternehmen:** [Name, Anschrift, Steuernummer, ggf. USt-IdNr.]
**Tätigkeit:** [z. B. freiberufliche Trainings und Vorträge]
**Gewinnermittlung:** [Einnahmen-Überschuss-Rechnung / Bilanz]
**Umsatzsteuer:** [Kleinunternehmer nach § 19 UStG / regelbesteuert seit …]
**Beteiligte Personen:** [Wer schreibt Rechnungen, wer erfasst Zahlungen, wer archiviert, wer vertritt im Urlaub]
**Steuerberatung:** [Name oder „keine“]

Diese Dokumentation beschreibt, wie Ausgangsrechnungen entstehen, wie sie festgeschrieben, protokolliert und aufbewahrt werden und wie Korrekturen ablaufen.

## 2. Eingesetzte Software

| Programm | Zweck | Version / Stand |
|---|---|---|
| E-Rechnung (Browser-Anwendung, Open Source, MIT) | Rechnungen und Stornorechnungen schreiben, Zahlungseingänge erfassen, Archivpakete erzeugen | [Datum des ersten Einsatzes] |
| Browser | Ausführung der Anwendung, lokale Datenhaltung (IndexedDB) | [z. B. Firefox 140 auf Windows 11] |
| Archivspeicher | Aufbewahrung der Archivpakete | [siehe Abschnitt 6] |
| [Buchhaltung, z. B. EÜR-Programm] | [Übernahme der Einnahmen] | [ … ] |

Die Anwendung läuft vollständig im Browser auf [Gerät]. Rechnungs-, Kunden- und Bankdaten werden nicht an einen Server übertragen. Der Quellcode ist öffentlich einsehbar; die erzeugten E-Rechnungen werden vor der Ausgabe mit den offiziellen Prüfregeln für EN 16931 und XRechnung 3.0 geprüft.

## 3. Rechnungsstellung

1. Leistungen werden [nach Abschluss / monatlich] abgerechnet.
2. Die Rechnung wird in der Anwendung unter „Rechnung schreiben“ erfasst. Die Rechnungsnummer vergibt die Anwendung fortlaufend nach dem Schema [z. B. 2027-001].
3. Vor der Ausgabe prüft die Anwendung die Pflichtangaben nach § 14 UStG und bei E-Rechnungen die offiziellen Prüfregeln. Bei Fehlern wird keine Rechnung erzeugt.
4. Mit „Prüfen und PDF erstellen“ entsteht die Rechnung: bei Unternehmenskunden als E-Rechnung (ZUGFeRD-PDF mit eingebetteter XRechnung), bei Privatkunden als PDF.
5. Die Rechnung wird [per E-Mail an die Rechnungsadresse des Kunden] versendet. [Ggf.: Versandnachweis wird im E-Mail-Programm aufbewahrt.]

## 4. Festschreibung und Korrekturen

- Jede erstellte Rechnung ist sofort festgeschrieben. Die Anwendung bietet keine Möglichkeit, sie zu ändern oder zu löschen.
- Eine fehlerhafte Rechnung wird mit einer **Stornorechnung** aufgehoben (Schaltfläche „Storno“). Die Stornorechnung erhält eine eigene fortlaufende Nummer und verweist auf die ursprüngliche Rechnung. Bei E-Rechnungen ist sie ebenfalls eine geprüfte XRechnung (Rechnungsart 381).
- Danach wird bei Bedarf eine neue, richtige Rechnung erstellt (z. B. über „Kopie“).
- Zahlungseingänge werden unter „Rechnungen“ mit Datum und Betrag erfasst. Das Zurücksetzen einer erfassten Zahlung wird protokolliert.
- Lücken in den Rechnungsnummern zeigt die Anwendung an. Entstandene Lücken und ihr Grund werden hier festgehalten: [Datum, Nummernbereich, Grund]

## 5. Protokoll

Die Anwendung führt ein Protokoll aller Vorgänge (Rechnung erstellt, Stornorechnung erstellt, Zahlung erfasst, Zahlung zurückgesetzt, Archivpaket erstellt, Sicherung erstellt oder eingespielt). Jeder Eintrag enthält Zeitpunkt, Vorgang, die wesentlichen Angaben und die SHA-256-Prüfsumme der erzeugten PDF- und XML-Datei. Jeder Eintrag ist mit der Prüfsumme des vorherigen verkettet. Ändert jemand einen Eintrag nachträglich, löscht ihn oder schiebt einen ein, zeigt die Anwendung die Kette als fehlerhaft an. Das Protokoll ist in jedem Archivpaket enthalten.

## 6. Aufbewahrung

**Archivpaket:** Nach Ablauf jedes Monats, spätestens bis zum [10.] des Folgemonats, wird unter „Rechnungen > Archiv“ das Archivpaket des Vormonats heruntergeladen. Es enthält alle Rechnungen und Stornorechnungen des Monats als PDF und XML, das Rechnungsausgangsbuch (CSV mit Beschreibungsdatei index.xml), das vollständige Protokoll und eine Liste der SHA-256-Prüfsummen aller Dateien. Die Anwendung erinnert an fehlende Monate.

**Ablageorte:** Jedes Paket wird unverändert an zwei getrennten Orten gespeichert:
1. [z. B. Cloud-Speicher mit Versionsverlauf, Ordner „Rechnungsarchiv/2027“; nach Möglichkeit mit Aufbewahrungssperre gegen Löschen und Überschreiben]
2. [z. B. externe Festplatte, die nach dem Kopieren getrennt und an einem anderen Ort gelagert wird]

**Unveränderbarkeit:** Archivpakete werden nicht entpackt, umbenannt oder neu gepackt. [Zugriff auf den Archivordner hat nur …] Ob ein Paket unverändert ist, lässt sich jederzeit mit „Archivpaket prüfen“ in der Anwendung oder mit `sha256sum -c pruefsummen.sha256` im entpackten Paket nachweisen. Die Prüfung gleicht die Rechnungsdateien zusätzlich mit den beim Erstellen protokollierten Prüfsummen ab.

**Fristen:** Rechnungen werden 8 Jahre, Aufzeichnungen wie Rechnungsausgangsbuch und Protokoll 10 Jahre aufbewahrt, jeweils ab Ende des Kalenderjahres. Gelöscht wird erst nach Ablauf der Frist und frühestens nach [Rücksprache mit der Steuerberatung].

**E-Rechnungen:** Maßgeblich ist die XML-Datei (XRechnung). Sie liegt im Paket als eigene Datei und ist zusätzlich in der PDF eingebettet. Die PDF enthält keine darüber hinausgehenden steuerlich relevanten Angaben.

## 7. Datensicherung der Anwendung

Die Daten der Anwendung liegen im Speicher des Browsers auf [Gerät]. Zusätzlich zu den Archivpaketen wird [monatlich] eine Komplettsicherung heruntergeladen und unter [Ort] abgelegt. Die Sicherung dient der Wiederherstellung der Arbeitsdaten; maßgeblich für die Aufbewahrung sind die Archivpakete. Bei Verlust des Browserspeichers wird die letzte Komplettsicherung eingespielt; die Prüfsummenkette des Protokolls bleibt dabei erhalten.

## 8. Datenzugriff der Finanzverwaltung

Für eine Außenprüfung wird unter „Rechnungen > Archiv > Export für Betriebsprüfung“ ein Jahrespaket erzeugt: alle Belege des Jahres, das Rechnungsausgangsbuch als CSV mit index.xml nach dem Beschreibungsstandard der Finanzverwaltung, das Protokoll und die Prüfsummenliste. Zusätzlich werden die Archivpakete der Monate aus dem Archivspeicher bereitgestellt.

## 9. Internes Kontrollsystem

- Monatlich: Archivpaket herunterladen und an beiden Orten ablegen; in der Anwendung prüfen, dass die Prüfsummenkette intakt ist.
- [Quartalsweise / jährlich]: ein zufällig gewähltes Archivpaket mit „Archivpaket prüfen“ kontrollieren; Ergebnis hier notieren.
- Offene und überfällige Rechnungen werden [wöchentlich] in der Liste „Rechnungen“ kontrolliert.
- Änderungen an dieser Dokumentation werden mit Datum und Version unten nachgetragen.

## 10. Änderungen dieser Dokumentation

| Datum | Version | Änderung | Name |
|---|---|---|---|
| [ ] | 1.0 | Erstfassung | [ ] |

## Kontrollnachweise

| Datum | Kontrolle | Ergebnis | Name |
|---|---|---|---|
| [ ] | [z. B. Archivpaket 2027-01 geprüft] | [unverändert] | [ ] |
