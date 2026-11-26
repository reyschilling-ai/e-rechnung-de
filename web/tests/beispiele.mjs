// Testrechnungen mit erfundenen Daten (spiegeln die YAML-Beispiele im Repo).
const verkaeufer = {
  name: 'Erika Mustermann', strasse: 'Musterweg 1', plz: '12345', ort: 'Musterstadt', land: 'DE',
  email: 'rechnung@erika-mustermann.example', telefon: '+49 123 456789', steuernummer: '12/345/67890',
};
const basis = { iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', zielTage: 14, waehrung: 'EUR' };

export const BEISPIELE = {
  kleinunternehmer: {
    ...basis, nummer: '2027-001', datum: '2027-01-15', leistungsdatum: '2027-01-14', kaeuferreferenz: 'PO-4711',
    verkaeufer,
    kaeufer: { name: 'Beispiel Beratung GmbH', strasse: 'Hauptstraße 10', plz: '60311', ort: 'Frankfurt am Main', land: 'DE',
      email: 'eingangsrechnungen@beispiel-beratung.example' },
    positionen: [
      { bezeichnung: 'Workshop "KI im Büroalltag"', menge: '1', einheit: 'DAY', einzelpreis: '900,00', steuerfall: 'kleinunternehmer' },
      { bezeichnung: 'Reisekostenpauschale', menge: '1', einheit: 'LS', einzelpreis: '85,50', steuerfall: 'kleinunternehmer' },
    ],
  },
  regelbesteuert: {
    ...basis, bic: '', zielTage: 30, nummer: '2027-002', datum: '2027-02-01', zeitraumVon: '2027-01-01', zeitraumBis: '2027-01-31',
    bestellnummer: '4500012345',
    verkaeufer: { ...verkaeufer, ustId: 'DE123456789' },
    kaeufer: { name: 'Beispiel Pharma AG', strasse: 'Industriestraße 5', zusatz: 'Gebäude B', plz: '70173', ort: 'Stuttgart',
      land: 'DE', email: 'invoices@beispiel-pharma.example' },
    positionen: [
      { bezeichnung: 'Beratung Pharmakovigilanz', beschreibung: 'Unterstützung bei der Inspektionsvorbereitung', menge: '12,5',
        einheit: 'HUR', einzelpreis: '150', steuerfall: 'regulaer', steuersatz: '19' },
      { bezeichnung: 'Fachbuch "Beispiel"', menge: '2', einheit: 'C62', einzelpreis: '39.90', steuerfall: 'regulaer', steuersatz: '7' },
    ],
  },
  reverse_charge: {
    ...basis, bic: '', nummer: '2027-003', datum: '2027-03-10', leistungsdatum: '2027-03-09', kaeuferreferenz: 'Projekt Alpha',
    verkaeufer: { ...verkaeufer, steuernummer: '', ustId: 'DE123456789' },
    kaeufer: { name: 'Beispiel Consulting GmbH', strasse: 'Ringstraße 1', plz: '1010', ort: 'Wien', land: 'AT',
      email: 'rechnungen@beispiel-consulting.example', ustId: 'ATU12345678' },
    positionen: [{ bezeichnung: 'Online-Training "GVP-Grundlagen"', menge: '1', einheit: 'LS', einzelpreis: '1200', steuerfall: 'reverse_charge' }],
  },
};

// Stornorechnung zur Regelbesteuerten Beispielrechnung
export const STORNO = {
  ...BEISPIELE.regelbesteuert, typ: 'storno', nummer: '2027-004', datum: '2027-02-10',
  bezug: { nummer: '2027-002', datum: '2027-02-01' },
};
