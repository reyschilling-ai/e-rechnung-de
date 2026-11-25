"""Prüft die vom Browser-Code erzeugten PDFs mit Mustang (veraPDF + XRechnung-Regeln).
ZUGFeRD-PDFs müssen vollständig gültig sein. Reine PDFs dürfen nur die fehlenden
ZUGFeRD-Angaben bemängeln, aber keine PDF/A-Fehler haben.
Aufruf: python web/tests/pdf_pruefen.py <ordner>
"""
import sys
from pathlib import Path
from erechnung import werkzeuge

fehlgeschlagen = 0
for pdf in sorted(Path(sys.argv[1]).glob("*.pdf")):
    e = werkzeuge.pdf_pruefen(pdf)
    if pdf.name.startswith("zugferd"):
        ok = e.gueltig
    else:
        andere = [m for m in e.meldungen if "XMP Metadata" not in m and "No XML" not in m and "not valid ZUGFeRD" not in m]
        ok = not andere
        e.meldungen = andere
    print(("OK " if ok else "XX ") + pdf.name, *e.meldungen[:8], sep="\n   " if e.meldungen else "")
    fehlgeschlagen += not ok
sys.exit(1 if fehlgeschlagen else 0)
