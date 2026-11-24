"""Einlesen und Prüfen der Rechnungsdaten (YAML/JSON) sowie Betragsberechnung."""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import yaml

ZWEI = Decimal("0.01")

# Steuerfälle: Schlüssel in der YAML-Datei -> (UNTDID-5305-Kategorie, Standardsatz, Befreiungsgrund, VATEX-Code)
STEUERFAELLE = {
    "regulaer": ("S", None, None, None),
    "kleinunternehmer": ("E", Decimal("0"), "Kleinunternehmer gemäß § 19 Abs. 1 UStG", None),
    "reverse_charge": (
        "AE",
        Decimal("0"),
        "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)",
        "VATEX-EU-AE",
    ),
}

# Lesbare Einheiten -> UN/ECE Rec. 20
EINHEITEN = {
    "stueck": "C62",
    "stück": "C62",
    "stunde": "HUR",
    "stunden": "HUR",
    "tag": "DAY",
    "tage": "DAY",
    "pauschal": "LS",
    "monat": "MON",
    "monate": "MON",
    "kilometer": "KMT",
}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
IBAN_RE = re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$")


class Datenfehler(ValueError):
    """Fehlende oder widersprüchliche Angaben in den Rechnungsdaten."""


def betrag(wert) -> Decimal:
    return Decimal(str(wert)).quantize(ZWEI, rounding=ROUND_HALF_UP)


def datum(wert, feld: str) -> dt.date:
    if isinstance(wert, dt.date):
        return wert
    try:
        return dt.date.fromisoformat(str(wert))
    except ValueError as e:
        raise Datenfehler(f"{feld}: Datum im Format JJJJ-MM-TT erwartet, erhalten: {wert!r}") from e


def iban_pruefen(iban: str) -> str:
    iban = iban.replace(" ", "").upper()
    if not IBAN_RE.match(iban):
        raise Datenfehler(f"IBAN hat kein gültiges Format: {iban}")
    zahl = "".join(str(int(c, 36)) for c in iban[4:] + iban[:4])
    if int(zahl) % 97 != 1:
        raise Datenfehler(f"IBAN-Prüfsumme stimmt nicht: {iban}")
    return iban


@dataclass
class Anschrift:
    strasse: str
    plz: str
    ort: str
    land: str = "DE"
    zusatz: str | None = None


@dataclass
class Partei:
    name: str
    anschrift: Anschrift
    email: str
    ust_id: str | None = None
    steuernummer: str | None = None
    kontakt_name: str | None = None
    telefon: str | None = None
    kennung: str | None = None


@dataclass
class Position:
    nr: str
    bezeichnung: str
    menge: Decimal
    einheit: str
    einzelpreis: Decimal
    steuerfall: str
    steuersatz: Decimal
    beschreibung: str | None = None

    @property
    def netto(self) -> Decimal:
        return betrag(self.menge * self.einzelpreis)

    @property
    def kategorie(self) -> str:
        return STEUERFAELLE[self.steuerfall][0]


@dataclass
class Steuergruppe:
    kategorie: str
    satz: Decimal
    basis: Decimal
    befreiungsgrund: str | None
    befreiungscode: str | None

    @property
    def steuer(self) -> Decimal:
        return betrag(self.basis * self.satz / 100)


@dataclass
class Rechnung:
    nummer: str
    datum: dt.date
    verkaeufer: Partei
    kaeufer: Partei
    positionen: list[Position]
    iban: str
    bic: str | None
    kontoinhaber: str
    zahlungsbedingungen: str
    faellig_am: dt.date | None = None
    leistungsdatum: dt.date | None = None
    zeitraum_von: dt.date | None = None
    zeitraum_bis: dt.date | None = None
    kaeuferreferenz: str = "n/a"
    bestellnummer: str | None = None
    waehrung: str = "EUR"
    hinweise: list[str] = field(default_factory=list)

    @property
    def summe_netto(self) -> Decimal:
        return sum((p.netto for p in self.positionen), Decimal("0.00"))

    @property
    def steuergruppen(self) -> list[Steuergruppe]:
        gruppen: dict[tuple[str, Decimal], Steuergruppe] = {}
        for p in self.positionen:
            schluessel = (p.kategorie, p.steuersatz)
            if schluessel not in gruppen:
                _, _, grund, code = STEUERFAELLE[p.steuerfall]
                gruppen[schluessel] = Steuergruppe(p.kategorie, p.steuersatz, Decimal("0.00"), grund, code)
            gruppen[schluessel].basis += p.netto
        return list(gruppen.values())

    @property
    def summe_steuer(self) -> Decimal:
        return sum((g.steuer for g in self.steuergruppen), Decimal("0.00"))

    @property
    def summe_brutto(self) -> Decimal:
        return self.summe_netto + self.summe_steuer


def _partei(d: dict, rolle: str) -> Partei:
    if not isinstance(d, dict):
        raise Datenfehler(f"Abschnitt '{rolle}' fehlt")
    for pflicht in ("name", "anschrift", "email"):
        if not d.get(pflicht):
            raise Datenfehler(f"{rolle}.{pflicht} fehlt")
    a = d["anschrift"]
    for pflicht in ("strasse", "plz", "ort"):
        if not a.get(pflicht):
            raise Datenfehler(f"{rolle}.anschrift.{pflicht} fehlt")
    if not EMAIL_RE.match(str(d["email"])):
        raise Datenfehler(f"{rolle}.email ist keine gültige E-Mail-Adresse: {d['email']}")
    return Partei(
        name=str(d["name"]),
        anschrift=Anschrift(
            strasse=str(a["strasse"]),
            plz=str(a["plz"]),
            ort=str(a["ort"]),
            land=str(a.get("land", "DE")).upper(),
            zusatz=a.get("zusatz"),
        ),
        email=str(d["email"]),
        ust_id=(str(d["ust_id"]).replace(" ", "") if d.get("ust_id") else None),
        steuernummer=(str(d["steuernummer"]) if d.get("steuernummer") else None),
        kontakt_name=d.get("kontakt_name"),
        telefon=(str(d["telefon"]) if d.get("telefon") else None),
        kennung=(str(d["kennung"]) if d.get("kennung") else None),
    )


def aus_dict(d: dict) -> Rechnung:
    r = d.get("rechnung") or {}
    if not r.get("nummer"):
        raise Datenfehler("rechnung.nummer fehlt")
    if not r.get("datum"):
        raise Datenfehler("rechnung.datum fehlt")

    verkaeufer = _partei(d.get("verkaeufer"), "verkaeufer")
    kaeufer = _partei(d.get("kaeufer"), "kaeufer")
    v = d["verkaeufer"]
    if not (verkaeufer.ust_id or verkaeufer.steuernummer):
        raise Datenfehler("verkaeufer: Steuernummer oder USt-IdNr. ist Pflicht (§ 14 Abs. 4 UStG)")
    if not verkaeufer.kontakt_name:
        verkaeufer.kontakt_name = verkaeufer.name
    if not verkaeufer.telefon:
        raise Datenfehler("verkaeufer.telefon fehlt (in XRechnung Pflicht, BT-42)")

    standard_fall = d.get("steuerfall", "regulaer")
    positionen = []
    for i, p in enumerate(d.get("positionen") or [], start=1):
        fall = p.get("steuerfall", standard_fall)
        if fall not in STEUERFAELLE:
            raise Datenfehler(f"Position {i}: unbekannter Steuerfall '{fall}' (erlaubt: {', '.join(STEUERFAELLE)})")
        standardsatz = STEUERFAELLE[fall][1]
        if standardsatz is None:
            if "steuersatz" not in p and "steuersatz" not in d:
                raise Datenfehler(f"Position {i}: steuersatz fehlt (z. B. 19 oder 7)")
            satz = Decimal(str(p.get("steuersatz", d.get("steuersatz"))))
            if satz <= 0:
                raise Datenfehler(f"Position {i}: regulärer Steuerfall braucht einen Satz > 0")
        else:
            satz = standardsatz
        einheit_roh = str(p.get("einheit", "stueck"))
        einheit = EINHEITEN.get(einheit_roh.lower(), einheit_roh)
        if not p.get("bezeichnung"):
            raise Datenfehler(f"Position {i}: bezeichnung fehlt")
        if "einzelpreis" not in p:
            raise Datenfehler(f"Position {i}: einzelpreis fehlt")
        positionen.append(
            Position(
                nr=str(p.get("nr", i)),
                bezeichnung=str(p["bezeichnung"]),
                beschreibung=p.get("beschreibung"),
                menge=Decimal(str(p.get("menge", 1))),
                einheit=einheit,
                einzelpreis=Decimal(str(p["einzelpreis"])),
                steuerfall=fall,
                steuersatz=satz,
            )
        )
    if not positionen:
        raise Datenfehler("Mindestens eine Position ist nötig")

    faelle = {p.steuerfall for p in positionen}
    if "reverse_charge" in faelle:
        if not kaeufer.ust_id:
            raise Datenfehler("Reverse Charge: kaeufer.ust_id ist Pflicht")
        if not verkaeufer.ust_id:
            raise Datenfehler("Reverse Charge: verkaeufer.ust_id ist Pflicht")
    if "kleinunternehmer" in faelle and len(faelle) > 1:
        raise Datenfehler("Kleinunternehmer-Positionen lassen sich nicht mit anderen Steuerfällen mischen")

    z = d.get("zahlung") or {}
    if not z.get("iban"):
        raise Datenfehler("zahlung.iban fehlt")
    ziel_tage = z.get("ziel_tage")
    rechnungsdatum = datum(r["datum"], "rechnung.datum")
    faellig = datum(z["faellig_am"], "zahlung.faellig_am") if z.get("faellig_am") else None
    if faellig is None and ziel_tage is not None:
        faellig = rechnungsdatum + dt.timedelta(days=int(ziel_tage))
    bedingungen = z.get("bedingungen")
    if not bedingungen:
        bedingungen = (
            f"Zahlbar innerhalb von {ziel_tage} Tagen ohne Abzug." if ziel_tage is not None else "Zahlbar sofort ohne Abzug."
        )

    lz = r.get("leistungszeitraum") or {}
    leistungsdatum = datum(r["leistungsdatum"], "rechnung.leistungsdatum") if r.get("leistungsdatum") else None
    von = datum(lz["von"], "leistungszeitraum.von") if lz.get("von") else None
    bis = datum(lz["bis"], "leistungszeitraum.bis") if lz.get("bis") else None
    if not leistungsdatum and not (von and bis):
        raise Datenfehler("rechnung.leistungsdatum oder rechnung.leistungszeitraum (von/bis) ist Pflicht (§ 14 Abs. 4 Nr. 6 UStG)")
    if von and bis and von > bis:
        raise Datenfehler("leistungszeitraum: 'von' liegt nach 'bis'")

    hinweise = list(d.get("hinweise") or [])
    if "kleinunternehmer" in faelle and not any("19" in h for h in hinweise):
        hinweise.insert(0, "Als Kleinunternehmer im Sinne von § 19 Abs. 1 UStG wird Umsatzsteuer nicht berechnet.")
    if "reverse_charge" in faelle and not any("13b" in h or "Reverse" in h for h in hinweise):
        hinweise.insert(0, "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).")

    return Rechnung(
        nummer=str(r["nummer"]),
        datum=rechnungsdatum,
        verkaeufer=verkaeufer,
        kaeufer=kaeufer,
        positionen=positionen,
        iban=iban_pruefen(str(z["iban"])),
        bic=(str(z["bic"]).replace(" ", "") if z.get("bic") else None),
        kontoinhaber=str(z.get("kontoinhaber", v["name"])),
        zahlungsbedingungen=str(bedingungen),
        faellig_am=faellig,
        leistungsdatum=leistungsdatum,
        zeitraum_von=von,
        zeitraum_bis=bis,
        kaeuferreferenz=str(r.get("kaeuferreferenz") or "n/a"),
        bestellnummer=(str(r["bestellnummer"]) if r.get("bestellnummer") else None),
        waehrung=str(r.get("waehrung", "EUR")),
        hinweise=hinweise,
    )


def laden(pfad: str | Path) -> Rechnung:
    pfad = Path(pfad)
    text = pfad.read_text(encoding="utf-8")
    daten = json.loads(text) if pfad.suffix.lower() == ".json" else yaml.safe_load(text)
    if not isinstance(daten, dict):
        raise Datenfehler(f"{pfad}: erwartet wird eine YAML- oder JSON-Struktur")
    return aus_dict(daten)
