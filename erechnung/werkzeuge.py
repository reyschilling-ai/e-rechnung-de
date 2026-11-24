"""Download und Aufruf der externen Prüf- und Erzeugungswerkzeuge.

- KoSIT-Validator + XRechnung-Konfiguration (offizielle Prüfung, Apache 2.0)
- Mustang CLI (ZUGFeRD-PDF erzeugen und prüfen, Apache 2.0)
- LibreOffice (optional, nur für DOCX -> PDF/A)

Die Werkzeuge werden nicht mit diesem Repo verteilt, sondern beim ersten Lauf
heruntergeladen und per SHA-256 geprüft.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

DOWNLOADS = {
    "validator": (
        "https://github.com/itplr-kosit/validator/releases/download/v1.5.0/validator-1.5.0-distribution.zip",
        "ac78fb3e89d6daa81770049b004bd1408cad81100b885dd1d8da2cd169bd679f",
    ),
    "xrechnung-konfig": (
        "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/"
        "release-2025-07-10/validator-configuration-xrechnung_3.0.2_2025-07-10.zip",
        "9dd3dc77919eaae5a7265f475179ae5dec889c221585def0b918e716426bc396",
    ),
    "mustang": (
        "https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.16.2/Mustang-CLI-2.16.2.jar",
        "0841a69a004e31bce53343b1931f14126412bc079b04575b6275f584c54a1acd",
    ),
}


class Werkzeugfehler(RuntimeError):
    pass


def verzeichnis() -> Path:
    basis = os.environ.get("ERECHNUNG_WERKZEUGE")
    if basis:
        return Path(basis)
    return Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "e-rechnung-de"


def _sha256(pfad: Path) -> str:
    h = hashlib.sha256()
    with pfad.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _laden(name: str, ziel: Path) -> Path:
    url, sha = DOWNLOADS[name]
    datei = ziel / url.rsplit("/", 1)[1]
    if datei.exists() and _sha256(datei) == sha:
        return datei
    print(f"Lade {name} …")
    tmp = datei.with_suffix(datei.suffix + ".part")
    with urllib.request.urlopen(url) as antwort, tmp.open("wb") as f:
        shutil.copyfileobj(antwort, f)
    if _sha256(tmp) != sha:
        tmp.unlink()
        raise Werkzeugfehler(f"Prüfsumme von {name} stimmt nicht – Download verworfen ({url})")
    tmp.rename(datei)
    return datei


def installieren() -> Path:
    if not shutil.which("java"):
        raise Werkzeugfehler("Java (ab Version 11) wird benötigt, ist aber nicht installiert")
    ziel = verzeichnis()
    ziel.mkdir(parents=True, exist_ok=True)
    for name, unterordner in (("validator", "validator"), ("xrechnung-konfig", "konfig")):
        archiv = _laden(name, ziel)
        ordner = ziel / unterordner
        marker = ordner / ".sha256"
        if not (marker.exists() and marker.read_text() == DOWNLOADS[name][1]):
            shutil.rmtree(ordner, ignore_errors=True)
            with zipfile.ZipFile(archiv) as z:
                z.extractall(ordner)
            marker.write_text(DOWNLOADS[name][1])
    _laden("mustang", ziel)
    return ziel


def _validator_jar(ziel: Path) -> Path:
    treffer = sorted((ziel / "validator").glob("validationtool-*-standalone.jar"))
    treffer = [t for t in treffer if "java8" not in t.name]
    if not treffer:
        raise Werkzeugfehler("KoSIT-Validator nicht gefunden – bitte 'erechnung werkzeuge' ausführen")
    return treffer[0]


def _mustang_jar(ziel: Path) -> Path:
    jar = ziel / DOWNLOADS["mustang"][0].rsplit("/", 1)[1]
    if not jar.exists():
        raise Werkzeugfehler("Mustang nicht gefunden – bitte 'erechnung werkzeuge' ausführen")
    return jar


def _java(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["java", *args], capture_output=True, text=True)


@dataclass
class Pruefergebnis:
    gueltig: bool
    meldungen: list[str] = field(default_factory=list)
    bericht: Path | None = None


def xml_pruefen(xml: Path, berichtsordner: Path | None = None) -> Pruefergebnis:
    """Prüft eine XRechnung mit dem offiziellen KoSIT-Validator."""
    ziel = installieren()
    ausgabe = berichtsordner or Path(tempfile.mkdtemp(prefix="kosit-"))
    ausgabe.mkdir(parents=True, exist_ok=True)
    konfig = ziel / "konfig"
    _java(
        "-jar", str(_validator_jar(ziel)),
        "-s", str(konfig / "scenarios.xml"), "-r", str(konfig),
        "-o", str(ausgabe), "-h", str(xml),
    )
    bericht_xml = ausgabe / f"{xml.stem}-report.xml"
    if not bericht_xml.exists():
        raise Werkzeugfehler("KoSIT-Validator hat keinen Bericht erzeugt")
    baum = etree.parse(str(bericht_xml))
    ns = {"rep": "http://www.xoev.de/de/validator/varl/1"}
    gueltig = bool(baum.xpath("//rep:assessment/rep:accept", namespaces=ns))
    meldungen = [
        f"[{m.get('level')}] {m.get('code') or ''} {' '.join(m.itertext()).strip()}".strip()
        for m in baum.xpath("//rep:message", namespaces=ns)
        if m.get("level") in ("error", "warning")
    ]
    html = ausgabe / f"{xml.stem}-report.html"
    return Pruefergebnis(gueltig, meldungen, html if html.exists() else bericht_xml)


def pdf_kombinieren(pdf: Path, xml: Path, ziel_pdf: Path) -> None:
    """Bettet das XML als ZUGFeRD-Profil XRECHNUNG in eine PDF/A-3 ein."""
    ziel = installieren()
    ziel_pdf.unlink(missing_ok=True)
    ergebnis = _java(
        "-jar", str(_mustang_jar(ziel)), "--action", "combine",
        "--source", str(pdf), "--source-xml", str(xml), "--out", str(ziel_pdf),
        "--format", "zf", "--version", "2", "--profile", "X",
        "--attachments", "", "--disable-file-logging",
    )
    if not ziel_pdf.exists():
        raise Werkzeugfehler(
            "Mustang konnte die PDF nicht erzeugen. Ist die Eingabe eine PDF/A (Word: 'PDF/A-kompatibel', "
            f"LibreOffice: Export als PDF/A)?\n{ergebnis.stdout[-2000:]}{ergebnis.stderr[-2000:]}"
        )


def pdf_pruefen(pdf: Path) -> Pruefergebnis:
    """Prüft eine ZUGFeRD-PDF (PDF/A-3, eingebettetes XML, EN 16931 und XRechnung-Regeln) mit Mustang."""
    ziel = installieren()
    ergebnis = _java("-jar", str(_mustang_jar(ziel)), "--action", "validate", "--source", str(pdf), "--disable-file-logging")
    ausgabe = ergebnis.stdout + ergebnis.stderr
    xml_start = ausgabe.find("<validation")
    meldungen: list[str] = []
    gueltig = False
    if xml_start >= 0:
        try:
            baum = etree.fromstring(ausgabe[xml_start: ausgabe.rfind("</validation>") + len("</validation>")].encode())
            gueltig = baum.find("summary") is not None and baum.find("summary").get("status") == "valid"
            for e in baum.iter("error", "warning"):
                meldungen.append(f"[{e.tag}] {(e.text or '').strip()}")
        except etree.XMLSyntaxError:
            meldungen.append("Mustang-Ausgabe nicht lesbar")
    else:
        meldungen.append(ausgabe[-2000:])
    return Pruefergebnis(gueltig, meldungen)


def docx_zu_pdfa(docx: Path, ordner: Path) -> Path:
    """Wandelt eine Word-Datei mit LibreOffice in eine PDF/A-3 um."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise Werkzeugfehler("LibreOffice nicht gefunden. Alternative: in Word 'Speichern unter → PDF' mit Option 'PDF/A-kompatibel'.")
    filter_ = 'pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"3"}}'
    subprocess.run([soffice, "--headless", "--convert-to", filter_, "--outdir", str(ordner), str(docx)],
                   capture_output=True, check=False)
    pdf = ordner / (docx.stem + ".pdf")
    if not pdf.exists():
        raise Werkzeugfehler(f"LibreOffice konnte {docx.name} nicht umwandeln")
    return pdf
