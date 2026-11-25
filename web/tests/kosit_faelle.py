"""Erzeugt gültige und absichtlich fehlerhafte XRechnungen (mit dem Python-Generator)
und lässt KoSIT dazu Berichte schreiben. Danach vergleicht tests/vergleich_kosit.mjs
die Browser-Prüfung mit diesen Berichten.
Aufruf: python web/tests/kosit_faelle.py <zielordner>
"""
import sys
from pathlib import Path
from lxml import etree
from erechnung import cii, werkzeuge
from erechnung.modell import laden

ziel = Path(sys.argv[1]); ziel.mkdir(parents=True, exist_ok=True)
NS = cii.NS
wurzel = Path(__file__).resolve().parents[2]
for f in (wurzel / "beispiele").glob("*.yaml"):
    (ziel / f"ok_{f.stem}.xml").write_bytes(cii.erzeugen(laden(f)))
basis = cii.erzeugen(laden(wurzel / "beispiele/regelbesteuert.yaml"))
x = lambda t, p: t.xpath(p, namespaces=NS)
def weg(p): return lambda t: [e.getparent().remove(e) for e in x(t, p)]
def setze(p, w): return lambda t: [setattr(e, "text", w) for e in x(t, p)[:1]]
FAELLE = {
    "ohne_kaeufermail": weg("//ram:BuyerTradeParty/ram:URIUniversalCommunication"),
    "falsche_summe": setze("//ram:GrandTotalAmount", "9999.00"),
    "ohne_buyerref": weg("//ram:BuyerReference"),
    "falsche_steuer": setze("//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CalculatedAmount", "1.00"),
    "ohne_telefon": weg("//ram:TelephoneUniversalCommunication"),
    "falsche_waehrung": setze("//ram:InvoiceCurrencyCode", "XXX"),
    "ohne_zahlungsbedingung": weg("//ram:SpecifiedTradePaymentTerms"),
    "kategorie_E_ohne_grund": lambda t: [setattr(e, "text", "E") for e in x(t, "//ram:CategoryCode")],
    "leeres_element": setze("//ram:LineTwo", ""),
    "falsche_einheit": lambda t: x(t, "//ram:BilledQuantity")[0].set("unitCode", "ZZZ"),
    "positionssumme": setze("//ram:LineTotalAmount", "1.00"),
    "falsche_iban": setze("//ram:IBANID", "DE00370400440532013000"),
    "ohne_leistungsdatum_und_zeitraum": weg("//ram:BillingSpecifiedPeriod"),
    "ohne_verkaeufer_steuer": weg("//ram:SellerTradeParty/ram:SpecifiedTaxRegistration"),
}
for name, fn in FAELLE.items():
    t = etree.fromstring(basis); fn(t)
    (ziel / f"bad_{name}.xml").write_bytes(etree.tostring(t, xml_declaration=True, encoding="UTF-8"))
for xml in sorted(ziel.glob("*.xml")):
    werkzeuge.xml_pruefen(xml, ziel / "kosit")
print(f"{len(list(ziel.glob('*.xml')))} Fälle geprüft")
