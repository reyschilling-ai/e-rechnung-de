// XRechnung 3.0 im CII-Format erzeugen und einlesen (gleicher Aufbau wie erechnung/cii.py).

import { berechnen, centText, dezText, hinweiseFuer, zahlungsbedingungen, faelligAm, STEUERFAELLE } from './modell.js';

export const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
};
export const XRECHNUNG_3 = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const PEPPOL = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const d102 = (iso) => iso.replace(/-/g, '');
export const istStorno = (r) => r.typ === 'storno';

class Schreiber {
  constructor() { this.teile = []; this.tiefe = 0; }
  auf(tag, attr = {}) { this.zeile(`<${tag}${this.attr(attr)}>`); this.tiefe++; return this; }
  zu(tag) { this.tiefe--; this.zeile(`</${tag}>`); return this; }
  el(tag, text, attr = {}) {
    if (text === null || text === undefined || text === '') return this;
    this.zeile(`<${tag}${this.attr(attr)}>${esc(text)}</${tag}>`); return this;
  }
  datum(tag, iso) {
    if (!iso) return this;
    this.auf(tag).el('udt:DateTimeString', d102(iso), { format: '102' }).zu(tag); return this;
  }
  attr(a) { return Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join(''); }
  zeile(s) { this.teile.push('  '.repeat(this.tiefe) + s); }
  text() { return this.teile.join('\n') + '\n'; }
}

function partei(w, tag, p, { kontakt }) {
  w.auf(tag);
  const kennung = p.kennung || (kontakt && !p.ustId ? p.steuernummer : null);
  w.el('ram:ID', kennung);
  w.el('ram:Name', p.name);
  if (kontakt) {
    w.auf('ram:DefinedTradeContact').el('ram:PersonName', p.kontaktName || p.name);
    w.auf('ram:TelephoneUniversalCommunication').el('ram:CompleteNumber', p.telefon).zu('ram:TelephoneUniversalCommunication');
    w.auf('ram:EmailURIUniversalCommunication').el('ram:URIID', p.email).zu('ram:EmailURIUniversalCommunication');
    w.zu('ram:DefinedTradeContact');
  }
  w.auf('ram:PostalTradeAddress')
    .el('ram:PostcodeCode', p.plz).el('ram:LineOne', p.strasse).el('ram:LineTwo', p.zusatz)
    .el('ram:CityName', p.ort).el('ram:CountryID', (p.land || 'DE').toUpperCase())
    .zu('ram:PostalTradeAddress');
  if (p.email) w.auf('ram:URIUniversalCommunication').el('ram:URIID', p.email, { schemeID: 'EM' }).zu('ram:URIUniversalCommunication');
  if (p.steuernummer && kontakt) w.auf('ram:SpecifiedTaxRegistration').el('ram:ID', p.steuernummer, { schemeID: 'FC' }).zu('ram:SpecifiedTaxRegistration');
  if (p.ustId) w.auf('ram:SpecifiedTaxRegistration').el('ram:ID', p.ustId.replace(/\s/g, ''), { schemeID: 'VA' }).zu('ram:SpecifiedTaxRegistration');
  w.zu(tag);
}

export function erzeugen(r) {
  const b = berechnen(r);
  const wae = r.waehrung || 'EUR';
  const w = new Schreiber();
  w.zeile('<?xml version="1.0" encoding="UTF-8"?>');
  w.auf('rsm:CrossIndustryInvoice', Object.fromEntries(Object.entries(NS).map(([k, v]) => [`xmlns:${k}`, v])));
  w.auf('rsm:ExchangedDocumentContext')
    .auf('ram:BusinessProcessSpecifiedDocumentContextParameter').el('ram:ID', PEPPOL).zu('ram:BusinessProcessSpecifiedDocumentContextParameter')
    .auf('ram:GuidelineSpecifiedDocumentContextParameter').el('ram:ID', XRECHNUNG_3).zu('ram:GuidelineSpecifiedDocumentContextParameter')
    .zu('rsm:ExchangedDocumentContext');
  w.auf('rsm:ExchangedDocument').el('ram:ID', r.nummer).el('ram:TypeCode', istStorno(r) ? '381' : '380').datum('ram:IssueDateTime', r.datum);
  for (const h of hinweiseFuer(r)) w.auf('ram:IncludedNote').el('ram:Content', h).zu('ram:IncludedNote');
  w.zu('rsm:ExchangedDocument');

  w.auf('rsm:SupplyChainTradeTransaction');
  for (const p of b.positionen) {
    w.auf('ram:IncludedSupplyChainTradeLineItem');
    w.auf('ram:AssociatedDocumentLineDocument').el('ram:LineID', p.nr).zu('ram:AssociatedDocumentLineDocument');
    w.auf('ram:SpecifiedTradeProduct').el('ram:Name', p.bezeichnung).el('ram:Description', p.beschreibung).zu('ram:SpecifiedTradeProduct');
    w.auf('ram:SpecifiedLineTradeAgreement').auf('ram:NetPriceProductTradePrice').el('ram:ChargeAmount', dezText(p.preisD))
      .zu('ram:NetPriceProductTradePrice').zu('ram:SpecifiedLineTradeAgreement');
    w.auf('ram:SpecifiedLineTradeDelivery').el('ram:BilledQuantity', dezText(p.mengeD), { unitCode: p.einheit || 'C62' }).zu('ram:SpecifiedLineTradeDelivery');
    w.auf('ram:SpecifiedLineTradeSettlement')
      .auf('ram:ApplicableTradeTax').el('ram:TypeCode', 'VAT').el('ram:CategoryCode', p.kategorie).el('ram:RateApplicablePercent', dezText(p.satzD)).zu('ram:ApplicableTradeTax')
      .auf('ram:SpecifiedTradeSettlementLineMonetarySummation').el('ram:LineTotalAmount', centText(p.netto)).zu('ram:SpecifiedTradeSettlementLineMonetarySummation')
      .zu('ram:SpecifiedLineTradeSettlement');
    w.zu('ram:IncludedSupplyChainTradeLineItem');
  }

  w.auf('ram:ApplicableHeaderTradeAgreement').el('ram:BuyerReference', r.kaeuferreferenz || 'n/a');
  partei(w, 'ram:SellerTradeParty', r.verkaeufer, { kontakt: true });
  partei(w, 'ram:BuyerTradeParty', r.kaeufer, { kontakt: false });
  if (r.bestellnummer) w.auf('ram:BuyerOrderReferencedDocument').el('ram:IssuerAssignedID', r.bestellnummer).zu('ram:BuyerOrderReferencedDocument');
  w.zu('ram:ApplicableHeaderTradeAgreement');

  w.auf('ram:ApplicableHeaderTradeDelivery');
  if (r.leistungsdatum) w.auf('ram:ActualDeliverySupplyChainEvent').datum('ram:OccurrenceDateTime', r.leistungsdatum).zu('ram:ActualDeliverySupplyChainEvent');
  w.zu('ram:ApplicableHeaderTradeDelivery');

  w.auf('ram:ApplicableHeaderTradeSettlement').el('ram:PaymentReference', r.nummer).el('ram:InvoiceCurrencyCode', wae);
  if (istStorno(r)) {
    // Stornorechnung: Erstattung bzw. Verrechnung; keine Zahlung an den Rechnungssteller
    w.auf('ram:SpecifiedTradeSettlementPaymentMeans').el('ram:TypeCode', r.zahlungsartStorno || '1')
      .el('ram:Information', 'Erstattung oder Verrechnung des stornierten Betrags').zu('ram:SpecifiedTradeSettlementPaymentMeans');
  } else {
    w.auf('ram:SpecifiedTradeSettlementPaymentMeans').el('ram:TypeCode', '58')
      .auf('ram:PayeePartyCreditorFinancialAccount').el('ram:IBANID', String(r.iban).replace(/\s/g, '').toUpperCase())
      .el('ram:AccountName', r.kontoinhaber || r.verkaeufer.name).zu('ram:PayeePartyCreditorFinancialAccount');
    if (r.bic) w.auf('ram:PayeeSpecifiedCreditorFinancialInstitution').el('ram:BICID', r.bic.replace(/\s/g, '')).zu('ram:PayeeSpecifiedCreditorFinancialInstitution');
    w.zu('ram:SpecifiedTradeSettlementPaymentMeans');
  }
  for (const g of b.steuern) {
    w.auf('ram:ApplicableTradeTax').el('ram:CalculatedAmount', centText(g.steuer)).el('ram:TypeCode', 'VAT')
      .el('ram:ExemptionReason', g.grund).el('ram:BasisAmount', centText(g.basis)).el('ram:CategoryCode', g.kategorie)
      .el('ram:ExemptionReasonCode', g.code).el('ram:RateApplicablePercent', dezText(g.satz)).zu('ram:ApplicableTradeTax');
  }
  if (r.zeitraumVon && r.zeitraumBis) {
    w.auf('ram:BillingSpecifiedPeriod').datum('ram:StartDateTime', r.zeitraumVon).datum('ram:EndDateTime', r.zeitraumBis).zu('ram:BillingSpecifiedPeriod');
  }
  w.auf('ram:SpecifiedTradePaymentTerms').el('ram:Description', zahlungsbedingungen(r)).datum('ram:DueDateDateTime', faelligAm(r)).zu('ram:SpecifiedTradePaymentTerms');
  w.auf('ram:SpecifiedTradeSettlementHeaderMonetarySummation')
    .el('ram:LineTotalAmount', centText(b.netto)).el('ram:TaxBasisTotalAmount', centText(b.netto))
    .el('ram:TaxTotalAmount', centText(b.steuer), { currencyID: wae })
    .el('ram:GrandTotalAmount', centText(b.brutto)).el('ram:DuePayableAmount', centText(b.brutto))
    .zu('ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  if (istStorno(r) && r.bezug?.nummer) {
    w.auf('ram:InvoiceReferencedDocument').el('ram:IssuerAssignedID', r.bezug.nummer);
    if (r.bezug.datum) w.auf('ram:FormattedIssueDateTime').el('qdt:DateTimeString', d102(r.bezug.datum), { format: '102' }).zu('ram:FormattedIssueDateTime');
    w.zu('ram:InvoiceReferencedDocument');
  }
  w.zu('ram:ApplicableHeaderTradeSettlement');
  w.zu('rsm:SupplyChainTradeTransaction');
  w.zu('rsm:CrossIndustryInvoice');
  return w.text();
}

// ---------- Einlesen ----------
const KAT_ZU_FALL = { S: 'regulaer', E: 'kleinunternehmer', AE: 'reverse_charge' };

function q(knoten, pfad) {
  // pfad: "ram:A/ram:B" – einfache Kindnavigation ohne XPath-Bibliothek
  let aktuelle = [knoten];
  for (const teil of pfad.split('/')) {
    const [pfx, name] = teil.split(':');
    const ns = NS[pfx];
    aktuelle = aktuelle.flatMap((k) => [...k.childNodes].filter((c) => c.nodeType === 1 && c.localName === name && c.namespaceURI === ns));
  }
  return aktuelle;
}
const t = (k, p) => (q(k, p)[0]?.textContent || '').trim();
const datumAus = (k, p) => {
  const s = t(k, p + '/udt:DateTimeString');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
};

function parteiAus(k) {
  if (!k) return {};
  const adr = q(k, 'ram:PostalTradeAddress')[0];
  const regs = q(k, 'ram:SpecifiedTaxRegistration/ram:ID');
  const kontakt = q(k, 'ram:DefinedTradeContact')[0];
  return {
    name: t(k, 'ram:Name'),
    strasse: adr ? t(adr, 'ram:LineOne') : '', zusatz: adr ? t(adr, 'ram:LineTwo') : '',
    plz: adr ? t(adr, 'ram:PostcodeCode') : '', ort: adr ? t(adr, 'ram:CityName') : '',
    land: adr ? t(adr, 'ram:CountryID') : 'DE',
    email: t(k, 'ram:URIUniversalCommunication/ram:URIID') || (kontakt ? t(kontakt, 'ram:EmailURIUniversalCommunication/ram:URIID') : ''),
    telefon: kontakt ? t(kontakt, 'ram:TelephoneUniversalCommunication/ram:CompleteNumber') : '',
    kontaktName: kontakt ? t(kontakt, 'ram:PersonName') : '',
    steuernummer: regs.find((r) => r.getAttribute('schemeID') === 'FC')?.textContent.trim() || '',
    ustId: regs.find((r) => r.getAttribute('schemeID') === 'VA')?.textContent.trim() || '',
  };
}

export function einlesen(xmlText, parser = new DOMParser()) {
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const wurzel = doc.documentElement;
  if (!wurzel || wurzel.localName !== 'CrossIndustryInvoice' || wurzel.namespaceURI !== NS.rsm) {
    throw new Error('Das ist keine XRechnung im CII-Format (UBL wird noch nicht unterstützt).');
  }
  const tx = q(wurzel, 'rsm:SupplyChainTradeTransaction')[0];
  const ag = q(tx, 'ram:ApplicableHeaderTradeAgreement')[0];
  const st = q(tx, 'ram:ApplicableHeaderTradeSettlement')[0];
  const dok = q(wurzel, 'rsm:ExchangedDocument')[0];
  const konto = q(st, 'ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount')[0];
  const positionen = q(tx, 'ram:IncludedSupplyChainTradeLineItem').map((p) => {
    const kat = t(p, 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode');
    const menge = q(p, 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity')[0];
    return {
      bezeichnung: t(p, 'ram:SpecifiedTradeProduct/ram:Name'),
      beschreibung: t(p, 'ram:SpecifiedTradeProduct/ram:Description'),
      menge: menge?.textContent.trim() || '1', einheit: menge?.getAttribute('unitCode') || 'C62',
      einzelpreis: t(p, 'ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount'),
      steuerfall: KAT_ZU_FALL[kat] || 'regulaer',
      steuersatz: t(p, 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent'),
    };
  });
  const bekannteHinweise = [/§ 19/, /Reverse Charge/];
  const ref = t(ag, 'ram:BuyerReference');
  const bezugDok = q(st, 'ram:InvoiceReferencedDocument')[0];
  const bezugDatum = bezugDok ? t(bezugDok, 'ram:FormattedIssueDateTime/qdt:DateTimeString') : '';
  return {
    typ: t(dok, 'ram:TypeCode') === '381' ? 'storno' : 'rechnung',
    bezug: bezugDok ? { nummer: t(bezugDok, 'ram:IssuerAssignedID'),
      datum: /^\d{8}$/.test(bezugDatum) ? `${bezugDatum.slice(0, 4)}-${bezugDatum.slice(4, 6)}-${bezugDatum.slice(6, 8)}` : '' } : null,
    nummer: t(dok, 'ram:ID'), datum: datumAus(dok, 'ram:IssueDateTime'),
    leistungsdatum: datumAus(q(tx, 'ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent')[0] || tx, 'ram:OccurrenceDateTime'),
    zeitraumVon: datumAus(q(st, 'ram:BillingSpecifiedPeriod')[0] || st, 'ram:StartDateTime'),
    zeitraumBis: datumAus(q(st, 'ram:BillingSpecifiedPeriod')[0] || st, 'ram:EndDateTime'),
    kaeuferreferenz: ref === 'n/a' ? '' : ref,
    bestellnummer: t(ag, 'ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID'),
    waehrung: t(st, 'ram:InvoiceCurrencyCode') || 'EUR',
    verkaeufer: parteiAus(q(ag, 'ram:SellerTradeParty')[0]),
    kaeufer: parteiAus(q(ag, 'ram:BuyerTradeParty')[0]),
    iban: konto ? t(konto, 'ram:IBANID') : '', kontoinhaber: konto ? t(konto, 'ram:AccountName') : '',
    bic: t(st, 'ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID'),
    zahlungsbedingungen: t(st, 'ram:SpecifiedTradePaymentTerms/ram:Description'),
    faelligAm: datumAus(q(st, 'ram:SpecifiedTradePaymentTerms')[0] || st, 'ram:DueDateDateTime'),
    hinweise: q(dok, 'ram:IncludedNote/ram:Content').map((n) => n.textContent.trim())
      .filter((h) => !bekannteHinweise.some((re) => re.test(h))),
    positionen,
  };
}

export { STEUERFAELLE };
