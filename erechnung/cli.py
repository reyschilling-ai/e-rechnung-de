"""Kommandozeile: erechnung erstellen | pruefen | werkzeuge"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from . import cii, werkzeuge
from .modell import Datenfehler, laden


def _ausgabe_pruefung(titel: str, e: werkzeuge.Pruefergebnis) -> None:
    status = "GÜLTIG" if e.gueltig else "UNGÜLTIG"
    print(f"{titel}: {status}")
    for m in e.meldungen:
        print(f"  {m}")
    if e.bericht:
        print(f"  Prüfbericht: {e.bericht}")


def cmd_erstellen(args) -> int:
    rechnung = laden(args.daten)
    ordner = Path(args.ausgabe)
    ordner.mkdir(parents=True, exist_ok=True)
    basis = f"Rechnung_{rechnung.nummer}".replace("/", "-").replace(" ", "_")

    xml = ordner / f"{basis}_XRechnung.xml"
    xml.write_bytes(cii.erzeugen(rechnung))
    print(f"XRechnung geschrieben: {xml}")
    print(f"  Netto {rechnung.summe_netto} | USt {rechnung.summe_steuer} | Brutto {rechnung.summe_brutto} {rechnung.waehrung}")

    if args.ohne_pruefung:
        return 0

    ergebnis = werkzeuge.xml_pruefen(xml, ordner)
    _ausgabe_pruefung("KoSIT-Prüfung", ergebnis)
    if not ergebnis.gueltig:
        return 1

    if args.pdf:
        quelle = Path(args.pdf)
        with tempfile.TemporaryDirectory() as tmp:
            if quelle.suffix.lower() == ".docx":
                quelle = werkzeuge.docx_zu_pdfa(quelle, Path(tmp))
            zugferd = ordner / f"{basis}_ZUGFeRD.pdf"
            werkzeuge.pdf_kombinieren(quelle, xml, zugferd)
        print(f"ZUGFeRD-PDF geschrieben: {zugferd}")
        pdf_ergebnis = werkzeuge.pdf_pruefen(zugferd)
        _ausgabe_pruefung("Mustang-Prüfung", pdf_ergebnis)
        if not pdf_ergebnis.gueltig:
            return 1
    return 0


def cmd_pruefen(args) -> int:
    datei = Path(args.datei)
    if datei.suffix.lower() == ".pdf":
        e = werkzeuge.pdf_pruefen(datei)
        _ausgabe_pruefung("Mustang-Prüfung", e)
    else:
        e = werkzeuge.xml_pruefen(datei, Path(args.bericht) if args.bericht else None)
        _ausgabe_pruefung("KoSIT-Prüfung", e)
    return 0 if e.gueltig else 1


def cmd_werkzeuge(_args) -> int:
    ziel = werkzeuge.installieren()
    print(f"Werkzeuge bereit in {ziel}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="erechnung", description="E-Rechnungen (XRechnung/ZUGFeRD) erzeugen und prüfen")
    sub = p.add_subparsers(dest="befehl", required=True)

    e = sub.add_parser("erstellen", help="XRechnung (und optional ZUGFeRD-PDF) aus YAML/JSON erzeugen")
    e.add_argument("daten", help="Rechnungsdaten als .yaml oder .json")
    e.add_argument("--pdf", help="Sichtbare Rechnung als PDF/A oder .docx – ergibt eine ZUGFeRD-PDF")
    e.add_argument("-o", "--ausgabe", default="ausgabe", help="Zielordner (Standard: ./ausgabe)")
    e.add_argument("--ohne-pruefung", action="store_true", help="Nur XML erzeugen, nicht validieren")
    e.set_defaults(func=cmd_erstellen)

    v = sub.add_parser("pruefen", help="XRechnung-XML (KoSIT) oder ZUGFeRD-PDF (Mustang) prüfen")
    v.add_argument("datei")
    v.add_argument("--bericht", help="Ordner für den Prüfbericht")
    v.set_defaults(func=cmd_pruefen)

    w = sub.add_parser("werkzeuge", help="Prüfwerkzeuge herunterladen")
    w.set_defaults(func=cmd_werkzeuge)

    args = p.parse_args(argv)
    try:
        return args.func(args)
    except Datenfehler as fehler:
        print(f"Fehler in den Rechnungsdaten: {fehler}", file=sys.stderr)
        return 2
    except werkzeuge.Werkzeugfehler as fehler:
        print(f"Werkzeugfehler: {fehler}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
