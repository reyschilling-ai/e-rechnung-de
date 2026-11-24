"""Schnelle Tests ohne externe Werkzeuge."""

from decimal import Decimal
from pathlib import Path

import pytest
import yaml
from lxml import etree

from erechnung import cii
from erechnung.modell import Datenfehler, aus_dict, laden

BEISPIELE = Path(__file__).parent.parent / "beispiele"


def _daten(name="kleinunternehmer.yaml"):
    return yaml.safe_load((BEISPIELE / name).read_text(encoding="utf-8"))


def test_summen_gemischte_steuersaetze():
    r = laden(BEISPIELE / "regelbesteuert.yaml")
    assert r.summe_netto == Decimal("1954.80")
    # 1875,00 × 19 % = 356,25 und 79,80 × 7 % = 5,586 → 5,59
    assert r.summe_steuer == Decimal("361.84")
    assert r.summe_brutto == Decimal("2316.64")
    assert {(g.kategorie, g.satz) for g in r.steuergruppen} == {("S", Decimal("19")), ("S", Decimal("7"))}


def test_kleinunternehmer_hinweis_und_kennung():
    r = laden(BEISPIELE / "kleinunternehmer.yaml")
    assert any("§ 19" in h for h in r.hinweise)
    xml = etree.fromstring(cii.erzeugen(r))
    ns = cii.NS
    assert xml.xpath("//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode/text()", namespaces=ns) == ["E"]
    # ohne USt-IdNr. muss die Steuernummer als Verkäuferkennung (BT-29) auftauchen
    assert xml.xpath("//ram:SellerTradeParty/ram:ID/text()", namespaces=ns) == ["12/345/67890"]


def test_faelligkeit_aus_zahlungsziel():
    r = laden(BEISPIELE / "kleinunternehmer.yaml")
    assert r.faellig_am.isoformat() == "2027-01-29"


@pytest.mark.parametrize(
    "aenderung, meldung",
    [
        (lambda d: d["kaeufer"].pop("email"), "kaeufer.email"),
        (lambda d: d["rechnung"].pop("leistungsdatum"), "leistungsdatum"),
        (lambda d: d["zahlung"].update(iban="DE00370400440532013000"), "Prüfsumme"),
        (lambda d: d["verkaeufer"].pop("steuernummer"), "Steuernummer oder USt-IdNr"),
        (lambda d: d["verkaeufer"].pop("telefon"), "telefon"),
        (lambda d: d.update(positionen=[]), "Mindestens eine Position"),
    ],
)
def test_pflichtangaben(aenderung, meldung):
    d = _daten()
    aenderung(d)
    with pytest.raises(Datenfehler, match=meldung):
        aus_dict(d)


def test_reverse_charge_braucht_ust_id_des_kunden():
    d = _daten("reverse_charge_eu.yaml")
    d["kaeufer"].pop("ust_id")
    with pytest.raises(Datenfehler, match="kaeufer.ust_id"):
        aus_dict(d)


def test_regulaer_ohne_steuersatz():
    d = _daten("regelbesteuert.yaml")
    d.pop("steuersatz")
    with pytest.raises(Datenfehler, match="steuersatz fehlt"):
        aus_dict(d)
