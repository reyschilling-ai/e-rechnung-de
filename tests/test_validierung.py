"""Prüfung aller Beispiele mit dem offiziellen KoSIT-Validator und Mustang.

Läuft nur, wenn Java vorhanden ist. Lädt die Werkzeuge beim ersten Mal herunter.
"""

import shutil
from pathlib import Path

import pytest

from erechnung import cii, werkzeuge
from erechnung.modell import laden

BEISPIELE = Path(__file__).parent.parent / "beispiele"

pytestmark = pytest.mark.skipif(not shutil.which("java"), reason="Java nicht installiert")


@pytest.mark.parametrize("datei", sorted(BEISPIELE.glob("*.yaml")), ids=lambda p: p.stem)
def test_beispiel_ist_gueltige_xrechnung(datei, tmp_path):
    xml = tmp_path / f"{datei.stem}.xml"
    xml.write_bytes(cii.erzeugen(laden(datei)))
    ergebnis = werkzeuge.xml_pruefen(xml, tmp_path)
    assert ergebnis.gueltig, "\n".join(ergebnis.meldungen)


@pytest.mark.skipif(not (shutil.which("soffice") or shutil.which("libreoffice")), reason="LibreOffice nicht installiert")
def test_zugferd_pdf_aus_docx(tmp_path):
    xml = tmp_path / "r.xml"
    xml.write_bytes(cii.erzeugen(laden(BEISPIELE / "kleinunternehmer.yaml")))
    pdf = werkzeuge.docx_zu_pdfa(BEISPIELE / "kleinunternehmer.docx", tmp_path)
    ziel = tmp_path / "zugferd.pdf"
    werkzeuge.pdf_kombinieren(pdf, xml, ziel)
    ergebnis = werkzeuge.pdf_pruefen(ziel)
    assert ergebnis.gueltig, "\n".join(ergebnis.meldungen)


def test_normale_pdf_wird_abgelehnt(tmp_path):
    pytest.importorskip("reportlab")
    from reportlab.pdfgen import canvas

    pdf = tmp_path / "normal.pdf"
    c = canvas.Canvas(str(pdf))
    c.drawString(100, 750, "Keine E-Rechnung")
    c.save()
    assert not werkzeuge.pdf_pruefen(pdf).gueltig
