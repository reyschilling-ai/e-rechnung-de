"""Erzeugt XRechnung 3.0 im CII-Format (UN/CEFACT Cross Industry Invoice)."""

from __future__ import annotations

from decimal import Decimal

from lxml import etree

from .modell import Partei, Rechnung

NS = {
    "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
    "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
    "qdt": "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
    "udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
}
XRECHNUNG_3 = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
PEPPOL_PROZESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"


def _el(eltern, tag: str, text=None, **attrib):
    praefix, name = tag.split(":")
    e = etree.SubElement(eltern, f"{{{NS[praefix]}}}{name}", {k: str(v) for k, v in attrib.items()})
    if text is not None:
        e.text = str(text)
    return e


def _zahl(d: Decimal) -> str:
    """Dezimalzahl ohne Exponent und ohne überflüssige Nullen (Prozentsätze, Mengen)."""
    s = format(d.normalize(), "f")
    return s


def _datum(eltern, tag: str, d):
    e = _el(eltern, tag)
    _el(e, "udt:DateTimeString", d.strftime("%Y%m%d"), format="102")


def _anschrift(eltern, p: Partei):
    a = _el(eltern, "ram:PostalTradeAddress")
    _el(a, "ram:PostcodeCode", p.anschrift.plz)
    _el(a, "ram:LineOne", p.anschrift.strasse)
    if p.anschrift.zusatz:
        _el(a, "ram:LineTwo", p.anschrift.zusatz)
    _el(a, "ram:CityName", p.anschrift.ort)
    _el(a, "ram:CountryID", p.anschrift.land)


def _partei(eltern, tag: str, p: Partei, mit_kontakt: bool):
    e = _el(eltern, tag)
    kennung = p.kennung or (p.steuernummer if mit_kontakt and not p.ust_id else None)
    if kennung:
        _el(e, "ram:ID", kennung)  # BT-29: nötig, wenn keine USt-IdNr. vorhanden ist (BR-CO-26)
    _el(e, "ram:Name", p.name)
    if mit_kontakt:
        k = _el(e, "ram:DefinedTradeContact")
        _el(k, "ram:PersonName", p.kontakt_name or p.name)
        t = _el(k, "ram:TelephoneUniversalCommunication")
        _el(t, "ram:CompleteNumber", p.telefon)
        m = _el(k, "ram:EmailURIUniversalCommunication")
        _el(m, "ram:URIID", p.email)
    _anschrift(e, p)
    u = _el(e, "ram:URIUniversalCommunication")
    _el(u, "ram:URIID", p.email, schemeID="EM")
    if p.steuernummer:
        _el(_el(e, "ram:SpecifiedTaxRegistration"), "ram:ID", p.steuernummer, schemeID="FC")
    if p.ust_id:
        _el(_el(e, "ram:SpecifiedTaxRegistration"), "ram:ID", p.ust_id, schemeID="VA")


def erzeugen(r: Rechnung) -> bytes:
    wurzel = etree.Element(f"{{{NS['rsm']}}}CrossIndustryInvoice", nsmap=NS)

    ctx = _el(wurzel, "rsm:ExchangedDocumentContext")
    _el(_el(ctx, "ram:BusinessProcessSpecifiedDocumentContextParameter"), "ram:ID", PEPPOL_PROZESS)
    _el(_el(ctx, "ram:GuidelineSpecifiedDocumentContextParameter"), "ram:ID", XRECHNUNG_3)

    dok = _el(wurzel, "rsm:ExchangedDocument")
    _el(dok, "ram:ID", r.nummer)
    _el(dok, "ram:TypeCode", "380")
    _datum(dok, "ram:IssueDateTime", r.datum)
    for h in r.hinweise:
        _el(_el(dok, "ram:IncludedNote"), "ram:Content", h)

    tx = _el(wurzel, "rsm:SupplyChainTradeTransaction")

    for p in r.positionen:
        pos = _el(tx, "ram:IncludedSupplyChainTradeLineItem")
        _el(_el(pos, "ram:AssociatedDocumentLineDocument"), "ram:LineID", p.nr)
        prod = _el(pos, "ram:SpecifiedTradeProduct")
        _el(prod, "ram:Name", p.bezeichnung)
        if p.beschreibung:
            _el(prod, "ram:Description", p.beschreibung)
        vereinb = _el(pos, "ram:SpecifiedLineTradeAgreement")
        _el(_el(vereinb, "ram:NetPriceProductTradePrice"), "ram:ChargeAmount", _zahl(p.einzelpreis))
        _el(_el(pos, "ram:SpecifiedLineTradeDelivery"), "ram:BilledQuantity", _zahl(p.menge), unitCode=p.einheit)
        abr = _el(pos, "ram:SpecifiedLineTradeSettlement")
        st = _el(abr, "ram:ApplicableTradeTax")
        _el(st, "ram:TypeCode", "VAT")
        _el(st, "ram:CategoryCode", p.kategorie)
        _el(st, "ram:RateApplicablePercent", _zahl(p.steuersatz))
        summe = _el(abr, "ram:SpecifiedTradeSettlementLineMonetarySummation")
        _el(summe, "ram:LineTotalAmount", p.netto)

    vereinb = _el(tx, "ram:ApplicableHeaderTradeAgreement")
    _el(vereinb, "ram:BuyerReference", r.kaeuferreferenz)
    _partei(vereinb, "ram:SellerTradeParty", r.verkaeufer, mit_kontakt=True)
    _partei(vereinb, "ram:BuyerTradeParty", r.kaeufer, mit_kontakt=False)
    if r.bestellnummer:
        _el(_el(vereinb, "ram:BuyerOrderReferencedDocument"), "ram:IssuerAssignedID", r.bestellnummer)

    lief = _el(tx, "ram:ApplicableHeaderTradeDelivery")
    if r.leistungsdatum:
        ev = _el(lief, "ram:ActualDeliverySupplyChainEvent")
        _datum(ev, "ram:OccurrenceDateTime", r.leistungsdatum)

    abr = _el(tx, "ram:ApplicableHeaderTradeSettlement")
    _el(abr, "ram:PaymentReference", r.nummer)
    _el(abr, "ram:InvoiceCurrencyCode", r.waehrung)
    zm = _el(abr, "ram:SpecifiedTradeSettlementPaymentMeans")
    _el(zm, "ram:TypeCode", "58")  # SEPA-Überweisung
    konto = _el(zm, "ram:PayeePartyCreditorFinancialAccount")
    _el(konto, "ram:IBANID", r.iban)
    _el(konto, "ram:AccountName", r.kontoinhaber)
    if r.bic:
        _el(_el(zm, "ram:PayeeSpecifiedCreditorFinancialInstitution"), "ram:BICID", r.bic)

    for g in r.steuergruppen:
        st = _el(abr, "ram:ApplicableTradeTax")
        _el(st, "ram:CalculatedAmount", g.steuer)
        _el(st, "ram:TypeCode", "VAT")
        if g.befreiungsgrund:
            _el(st, "ram:ExemptionReason", g.befreiungsgrund)
        _el(st, "ram:BasisAmount", g.basis)
        _el(st, "ram:CategoryCode", g.kategorie)
        if g.befreiungscode:
            _el(st, "ram:ExemptionReasonCode", g.befreiungscode)
        _el(st, "ram:RateApplicablePercent", _zahl(g.satz))

    if r.zeitraum_von and r.zeitraum_bis:
        zr = _el(abr, "ram:BillingSpecifiedPeriod")
        _datum(zr, "ram:StartDateTime", r.zeitraum_von)
        _datum(zr, "ram:EndDateTime", r.zeitraum_bis)

    zb = _el(abr, "ram:SpecifiedTradePaymentTerms")
    _el(zb, "ram:Description", r.zahlungsbedingungen)
    if r.faellig_am:
        _datum(zb, "ram:DueDateDateTime", r.faellig_am)

    s = _el(abr, "ram:SpecifiedTradeSettlementHeaderMonetarySummation")
    _el(s, "ram:LineTotalAmount", r.summe_netto)
    _el(s, "ram:TaxBasisTotalAmount", r.summe_netto)
    _el(s, "ram:TaxTotalAmount", r.summe_steuer, currencyID=r.waehrung)
    _el(s, "ram:GrandTotalAmount", r.summe_brutto)
    _el(s, "ram:DuePayableAmount", r.summe_brutto)

    return etree.tostring(wurzel, xml_declaration=True, encoding="UTF-8", pretty_print=True)
