// Archivpakete für den eigenen Speicher und Datenexport für die Betriebsprüfung.

import { centText, datumDe } from './modell.js';
import { kettePruefen, sha256 } from './protokoll.js';
import { zipErstellen, zipLesen } from './zip.js';

const cent = (s) => BigInt(String(s).replace('.', '').replace(/^(-?)0+(?=\d)/, '$1'));
const betragDe = (c) => centText(c).replace('.', ',');
const csvFeld = (v) => {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const dateiBasis = (nr) => String(nr).replace(/[^\w.-]+/g, '_');

const SPALTEN = [
  ['Rechnungsnummer', 'AlphaNumeric'], ['Belegart', 'AlphaNumeric'], ['Rechnungsdatum', 'Date'],
  ['Leistungsdatum', 'Date'], ['Leistung_bis', 'Date'], ['Kunde', 'AlphaNumeric'], ['Kunde_Land', 'AlphaNumeric'],
  ['Kunde_UStIdNr', 'AlphaNumeric'], ['Steuerfall', 'AlphaNumeric'], ['Netto', 'Numeric'], ['Umsatzsteuer', 'Numeric'],
  ['Brutto', 'Numeric'], ['Waehrung', 'AlphaNumeric'], ['Bezug_Rechnung', 'AlphaNumeric'], ['Faellig_am', 'Date'],
  ['Zahlungseingang_Datum', 'Date'], ['Zahlungseingang_Betrag', 'Numeric'], ['Format', 'AlphaNumeric'],
  ['Erstellt_am', 'AlphaNumeric'], ['SHA256_XML', 'AlphaNumeric'], ['SHA256_PDF', 'AlphaNumeric'],
];

export function ausgangsbuchCsv(rechnungen) {
  const zeilen = [SPALTEN.map(([n]) => n).join(';')];
  for (const r of [...rechnungen].sort((a, b) => (a.datum + a.nummer).localeCompare(b.datum + b.nummer))) {
    const d = r.daten || {};
    const vz = r.typ === 'storno' ? -1n : 1n;
    const bezahlt = (r.zahlungen || []).reduce((s, z) => s + cent(z.betrag), 0n);
    const letzte = (r.zahlungen || []).at(-1);
    zeilen.push([
      r.nummer, r.typ === 'storno' ? 'Stornorechnung' : 'Rechnung', datumDe(r.datum),
      datumDe(d.leistungsdatum || d.zeitraumVon || ''), datumDe(d.zeitraumBis || ''), d.kaeufer?.name, d.kaeufer?.land,
      d.kaeufer?.ustId, r.steuerfall, betragDe(vz * cent(r.netto)), betragDe(vz * cent(r.steuer)), betragDe(vz * cent(r.brutto)),
      d.waehrung || 'EUR', r.bezug?.nummer || '', datumDe(r.faelligAm || ''), letzte ? datumDe(letzte.datum) : '',
      bezahlt ? betragDe(bezahlt) : '', r.format === 'zugferd' ? 'ZUGFeRD/XRechnung' : 'PDF', r.erstellt,
      r.sha256Xml || '', r.sha256Pdf || '',
    ].map(csvFeld).join(';'));
  }
  return '﻿' + zeilen.join('\r\n') + '\r\n';
}

function indexXml({ name, ort, von, bis }) {
  const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const spalten = SPALTEN.slice(1).map(([n, typ]) => `        <VariableColumn><Name>${n}</Name>${
    typ === 'Numeric' ? '<Numeric><Accuracy>2</Accuracy></Numeric>' : typ === 'Date' ? '<Date><Format>DD.MM.YYYY</Format></Date>' : '<AlphaNumeric/>'}</VariableColumn>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">
<DataSet>
  <Version>1.0</Version>
  <DataSupplier>
    <Name>${x(name)}</Name>
    <Location>${x(ort)}</Location>
    <Comment>Rechnungsausgangsbuch aus e-rechnung-de (https://github.com/reyschilling-ai/e-rechnung-de)</Comment>
  </DataSupplier>
  <Media>
    <Name>Rechnungsausgang ${x(datumDe(von))} bis ${x(datumDe(bis))}</Name>
    <Table>
      <URL>rechnungsausgangsbuch.csv</URL>
      <Name>Rechnungsausgangsbuch</Name>
      <Description>Ausgangsrechnungen und Stornorechnungen; Beträge von Stornorechnungen negativ</Description>
      <Validity><Range><From>${x(datumDe(von))}</From><To>${x(datumDe(bis))}</To></Range></Validity>
      <UTF8/>
      <DecimalSymbol>,</DecimalSymbol>
      <DigitGroupingSymbol>.</DigitGroupingSymbol>
      <Range><From>2</From></Range>
      <VariableLength>
        <ColumnDelimiter>;</ColumnDelimiter>
        <RecordDelimiter>&#13;&#10;</RecordDelimiter>
        <TextEncapsulator>"</TextEncapsulator>
        <VariablePrimaryKey><Name>Rechnungsnummer</Name><AlphaNumeric/></VariablePrimaryKey>
${spalten}
      </VariableLength>
    </Table>
  </Media>
</DataSet>
`;
}

function liesmich({ titel, von, bis, anzahl, kette, jetzt }) {
  return `${titel}
Zeitraum: ${datumDe(von)} bis ${datumDe(bis)}
Erstellt: ${jetzt}
Rechnungen und Stornorechnungen: ${anzahl}

Inhalt
- rechnungen/: jede Rechnung als PDF (bei E-Rechnungen ZUGFeRD mit eingebetteter XRechnung) und als XRechnung-XML
- rechnungsausgangsbuch.csv mit index.xml: Liste aller Belege im Zeitraum, maschinell auswertbar (Beschreibungsstandard der Finanzverwaltung)
- protokoll.json: vollständiges Änderungsprotokoll mit SHA-256-Prüfsummenkette (${kette.anzahl} Einträge, Kette ${kette.ok ? 'intakt' : 'FEHLERHAFT'})
- pruefsummen.sha256: SHA-256-Prüfsumme jeder Datei in diesem Paket

So bewahren Sie das Paket auf
1. Speichern Sie die ZIP-Datei unverändert. Nicht entpacken und neu packen, nichts umbenennen.
2. Halten Sie zwei Kopien an getrennten Orten, z. B. eine externe Festplatte und einen Cloud-Speicher mit Versionsverlauf.
   Ideal ist ein Speicher, der Dateien gegen Löschen und Überschreiben sperrt (Aufbewahrungssperre, WORM).
3. Aufbewahrungsfrist: Rechnungen 8 Jahre, Aufzeichnungen wie das Ausgangsbuch 10 Jahre, jeweils ab Ende des Kalenderjahres.
4. Ob ein Paket unverändert ist, zeigt das Werkzeug unter Rechnungen > Archiv > „Archivpaket prüfen“.
   Ohne das Werkzeug: sha256sum -c pruefsummen.sha256 (Linux/macOS) im entpackten Ordner.

Hinweis: Das Werkzeug unterstützt eine GoBD-konforme Arbeitsweise. Ob Ihr gesamter Ablauf den GoBD genügt,
hängt auch davon ab, wo und wie Sie diese Pakete aufbewahren. Beschreiben Sie das in Ihrer Verfahrensdokumentation.
`;
}

/**
 * @param rechnungen  Rechnungen des Zeitraums (mit pdf, xml)
 * @param protokoll   alle Protokolleinträge
 */
export async function archivErstellen({ rechnungen, protokoll, profil, von, bis, titel, jetzt = new Date() }) {
  const kette = await kettePruefen(protokoll);
  const dateien = [];
  for (const r of [...rechnungen].sort((a, b) => a.nummer.localeCompare(b.nummer))) {
    const basis = `rechnungen/${dateiBasis(r.nummer)}`;
    if (r.pdf) dateien.push({ name: `${basis}.pdf`, daten: new Uint8Array(r.pdf) });
    if (r.xml) dateien.push({ name: `${basis}.xml`, daten: r.xml });
  }
  dateien.push({ name: 'rechnungsausgangsbuch.csv', daten: ausgangsbuchCsv(rechnungen) });
  dateien.push({ name: 'index.xml', daten: indexXml({ name: profil.name, ort: [profil.plz, profil.ort].filter(Boolean).join(' '), von, bis }) });
  dateien.push({ name: 'protokoll.json', daten: JSON.stringify({ format: 'e-rechnung-de-protokoll', version: 1, pruefung: kette, eintraege: [...protokoll].sort((a, b) => a.nr - b.nr) }, null, 1) });
  dateien.push({ name: 'LIESMICH.txt', daten: liesmich({ titel, von, bis, anzahl: rechnungen.length, kette, jetzt: jetzt.toISOString() }) });
  const enc = new TextEncoder();
  const summen = [];
  for (const d of dateien) {
    const bytes = typeof d.daten === 'string' ? enc.encode(d.daten) : d.daten;
    summen.push(`${await sha256(bytes)}  ${d.name}`);
  }
  dateien.push({ name: 'pruefsummen.sha256', daten: summen.join('\n') + '\n' });
  const zip = zipErstellen(dateien, jetzt);
  return { zip, sha256: await sha256(zip), anzahlDateien: dateien.length, kette };
}

export async function archivPruefen(bytes) {
  const ergebnis = { ok: true, meldungen: [], rechnungen: 0 };
  const fehler = (m) => { ergebnis.ok = false; ergebnis.meldungen.push(m); };
  let dateien;
  try { dateien = await zipLesen(bytes); } catch (e) { fehler(e.message); return ergebnis; }
  const liste = dateien.get('pruefsummen.sha256');
  if (!liste) { fehler('pruefsummen.sha256 fehlt – das ist kein Archivpaket dieses Werkzeugs'); return ergebnis; }
  const erwartet = new Map(new TextDecoder().decode(liste).trim().split('\n').map((z) => {
    const [h, ...n] = z.split('  ');
    return [n.join('  '), h];
  }));
  for (const [name, hash] of erwartet) {
    const d = dateien.get(name);
    if (!d) { fehler(`Datei fehlt: ${name}`); continue; }
    if (await sha256(d) !== hash) fehler(`Datei verändert: ${name}`);
  }
  for (const name of dateien.keys()) {
    if (name !== 'pruefsummen.sha256' && !erwartet.has(name)) fehler(`Unbekannte zusätzliche Datei: ${name}`);
  }
  ergebnis.rechnungen = [...erwartet.keys()].filter((n) => n.startsWith('rechnungen/') && n.endsWith('.pdf')).length;
  const prot = dateien.get('protokoll.json');
  if (prot) {
    const p = JSON.parse(new TextDecoder().decode(prot));
    const kette = await kettePruefen(p.eintraege || []);
    if (!kette.ok) kette.fehler.forEach((f) => fehler(`Protokoll: ${f}`));
    // Rechnungsdateien gegen die beim Erstellen protokollierten Prüfsummen abgleichen
    const erstellt = new Map((p.eintraege || []).filter((e) => e.aktion === 'Rechnung erstellt').map((e) => [e.daten.nummer, e.daten]));
    for (const [name, d] of dateien) {
      const m = /^rechnungen\/(.+)\.(pdf|xml)$/.exec(name);
      if (!m) continue;
      const eintrag = [...erstellt.values()].find((e) => dateiBasis(e.nummer) === m[1]);
      if (!eintrag) { fehler(`${name}: im Protokoll nicht als erstellt verzeichnet`); continue; }
      const soll = m[2] === 'pdf' ? eintrag.sha256Pdf : eintrag.sha256Xml;
      if (soll && soll !== await sha256(d)) fehler(`${name}: weicht von der beim Erstellen protokollierten Fassung ab`);
    }
    ergebnis.protokollEintraege = kette.anzahl;
  } else fehler('protokoll.json fehlt');
  if (ergebnis.ok) ergebnis.meldungen.push('Alle Dateien sind unverändert, das Protokoll ist lückenlos und stimmt mit den Rechnungen überein.');
  return ergebnis;
}
