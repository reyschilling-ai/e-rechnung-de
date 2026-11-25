// Sichtbare Rechnung als PDF/A-3b. Mit XML wird daraus eine ZUGFeRD-Rechnung (Profil XRECHNUNG).
// Bibliotheken werden übergeben, damit derselbe Code im Browser und in Node-Tests läuft.

import { berechnen, centText, datumDe, euro, EINHEITEN, faelligAm, hinweiseFuer, zahlDe, zahlungsbedingungen, STEUERFAELLE } from './modell.js';

const MM = 72 / 25.4;
const A4 = [210 * MM, 297 * MM];
const RAND_L = 25 * MM, RAND_R = 20 * MM;
const BREITE = A4[0] - RAND_L - RAND_R;
const FUSS_H = 24 * MM;

const FARBE_TEXT = [0.13, 0.15, 0.18];
const FARBE_GRAU = [0.42, 0.45, 0.5];
const FARBE_LINIE = [0.82, 0.84, 0.87];

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function xmp({ titel, autor, producer, creator, datumIso, mitZugferd }) {
  const zf = mitZugferd ? `
  <rdf:Description xmlns:zf="urn:zugferd:pdfa:CrossIndustryDocument:invoice:2p0#" rdf:about="">
   <zf:ConformanceLevel>XRECHNUNG</zf:ConformanceLevel>
   <zf:DocumentType>INVOICE</zf:DocumentType>
   <zf:DocumentFileName>xrechnung.xml</zf:DocumentFileName>
   <zf:Version>2p0</zf:Version>
  </rdf:Description>
  <rdf:Description xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#" rdf:about="">
   <pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
    <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
    <pdfaSchema:namespaceURI>urn:zugferd:pdfa:CrossIndustryDocument:invoice:2p0#</pdfaSchema:namespaceURI>
    <pdfaSchema:prefix>zf</pdfaSchema:prefix>
    <pdfaSchema:property><rdf:Seq>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the ZUGFeRD XML schema</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The selected ZUGFeRD profile completeness</pdfaProperty:description></rdf:li>
    </rdf:Seq></pdfaSchema:property>
   </rdf:li></rdf:Bag></pdfaExtension:schemas>
  </rdf:Description>` : '';
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" rdf:about="">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" rdf:about="">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(titel)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlEsc(autor)}</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
  <rdf:Description xmlns:pdf="http://ns.adobe.com/pdf/1.3/" rdf:about="">
   <pdf:Producer>${xmlEsc(producer)}</pdf:Producer>
  </rdf:Description>
  <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" rdf:about="">
   <xmp:CreatorTool>${xmlEsc(creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${datumIso}</xmp:CreateDate>
   <xmp:ModifyDate>${datumIso}</xmp:ModifyDate>
   <xmp:MetadataDate>${datumIso}</xmp:MetadataDate>
  </rdf:Description>${zf}
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// Einzelpreis: zwei Nachkommastellen, bei Bedarf bis zu vier
function preisText(preisD, waehrung) {
  if (preisD % 100n === 0n) return euro(preisD / 100n, waehrung);
  const t = zahlDe(preisD);
  const [g, f = ''] = t.split(',');
  return `${g.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${f.padEnd(2, '0')}${waehrung === 'EUR' ? ' €' : ' ' + waehrung}`;
}

function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''); }

async function dokumentId(daten) {
  const c = globalThis.crypto;
  const h = await c.subtle.digest('SHA-256', daten);
  return hex(new Uint8Array(h).slice(0, 16));
}

// Text in Zeilen umbrechen, die in "breite" passen
function umbrechen(text, font, groesse, breite) {
  const zeilen = [];
  for (const absatz of String(text ?? '').split(/\r?\n/)) {
    let zeile = '';
    for (const wort of absatz.split(/\s+/).filter(Boolean)) {
      const probe = zeile ? zeile + ' ' + wort : wort;
      if (font.widthOfTextAtSize(probe, groesse) <= breite) { zeile = probe; continue; }
      if (zeile) zeilen.push(zeile);
      // überlanges Wort hart trennen
      let rest = wort;
      while (font.widthOfTextAtSize(rest, groesse) > breite) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), groesse) > breite) n--;
        zeilen.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      zeile = rest;
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

/**
 * @param libs  { PDFLib, fontkit }
 * @param r     Rechnungsdaten
 * @param opt   { xml?: string, logo?: {bytes, typ:'png'|'jpg'}, schriften: {normal, fett}, icc: Uint8Array, jetzt?: Date, titelZusatz?: string }
 */
export async function pdfErzeugen(libs, r, opt) {
  const { PDFDocument, PDFName, PDFString, PDFHexString, rgb } = libs.PDFLib;
  const jetzt = opt.jetzt || new Date();
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(libs.fontkit);
  const normal = await doc.embedFont(opt.schriften.normal, { subset: true });
  const fett = await doc.embedFont(opt.schriften.fett, { subset: true });
  const b = berechnen(r);
  const v = r.verkaeufer, k = r.kaeufer;
  const farbe = (c) => rgb(...c);
  const mitSteuerSpalte = b.steuern.length > 1 || b.steuern.some((g) => g.kategorie === 'S');

  let logo = null;
  if (opt.logo?.bytes) {
    logo = opt.logo.typ === 'png' ? await doc.embedPng(opt.logo.bytes) : await doc.embedJpg(opt.logo.bytes);
  }

  const seiten = [];
  let seite, y;
  const neueSeite = () => {
    seite = doc.addPage(A4);
    seiten.push(seite);
    y = A4[1] - 20 * MM;
  };
  const text = (s, x, yy, { font = normal, groesse = 9.5, f = FARBE_TEXT, rechts = false } = {}) => {
    s = String(s ?? '');
    const xx = rechts ? x - font.widthOfTextAtSize(s, groesse) : x;
    seite.drawText(s, { x: xx, y: yy, size: groesse, font, color: farbe(f) });
  };
  const linie = (y1, x1 = RAND_L, x2 = A4[0] - RAND_R, f = FARBE_LINIE, dicke = 0.6) =>
    seite.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, thickness: dicke, color: farbe(f) });

  // ---------- Seite 1: Kopf ----------
  neueSeite();
  if (logo) {
    const maxB = 55 * MM, maxH = 22 * MM;
    const s = Math.min(maxB / logo.width, maxH / logo.height);
    seite.drawImage(logo, { x: A4[0] - RAND_R - logo.width * s, y: A4[1] - 15 * MM - logo.height * s,
      width: logo.width * s, height: logo.height * s });
  } else {
    text(v.name, A4[0] - RAND_R, A4[1] - 22 * MM, { font: fett, groesse: 13, rechts: true });
  }

  // Anschriftfeld nach DIN 5008 (Form B): 45 mm von oben, 20 mm von links
  const feldOben = A4[1] - 45 * MM;
  const absender = [v.name, v.strasse, `${v.plz} ${v.ort}`].filter(Boolean).join(' · ');
  text(absender, RAND_L, feldOben - 12 * MM, { groesse: 7, f: FARBE_GRAU });
  let ya = feldOben - 17.7 * MM - 4 * MM;
  const anschrift = [k.name, k.kontaktName ? `z. Hd. ${k.kontaktName}` : null, k.strasse, k.zusatz,
    `${(k.land && k.land !== 'DE') ? k.land + '-' : ''}${k.plz} ${k.ort}`].filter(Boolean);
  for (const z of anschrift) { text(z, RAND_L, ya, { groesse: 10.5 }); ya -= 5 * MM; }

  // Informationsblock rechts
  const info = [
    ['Rechnungsnummer', r.nummer],
    ['Rechnungsdatum', datumDe(r.datum)],
    r.leistungsdatum ? ['Leistungsdatum', datumDe(r.leistungsdatum)] : null,
    (r.zeitraumVon && r.zeitraumBis) ? ['Leistungszeitraum', `${datumDe(r.zeitraumVon)} – ${datumDe(r.zeitraumBis)}`] : null,
    r.kaeuferreferenz ? ['Ihre Referenz', r.kaeuferreferenz] : null,
    r.bestellnummer ? ['Bestellnummer', r.bestellnummer] : null,
    k.ustId ? ['Ihre USt-IdNr.', k.ustId] : null,
  ].filter(Boolean);
  let yi = feldOben - 2 * MM;
  const xInfo = 125 * MM;
  for (const [l, w] of info) {
    text(l, xInfo, yi, { groesse: 8, f: FARBE_GRAU });
    text(w, A4[0] - RAND_R, yi, { groesse: 9, rechts: true });
    yi -= 5 * MM;
  }

  y = Math.min(ya, yi) - 12 * MM;
  text(`Rechnung ${r.nummer}`, RAND_L, y, { font: fett, groesse: 15 });
  y -= 10 * MM;
  if (r.anschreiben) {
    for (const z of umbrechen(r.anschreiben, normal, 9.5, BREITE)) { text(z, RAND_L, y); y -= 4.6 * MM; }
    y -= 3 * MM;
  }

  // ---------- Positionen ----------
  const sp = {
    pos: RAND_L, bez: RAND_L + 10 * MM,
    menge: RAND_L + (mitSteuerSpalte ? 108 : 120) * MM, preis: RAND_L + (mitSteuerSpalte ? 133 : 145) * MM,
    ust: RAND_L + 146 * MM, gesamt: A4[0] - RAND_R,
  };
  const bezBreite = sp.menge - 20 * MM - sp.bez;
  const tabellenKopf = () => {
    text('Pos.', sp.pos, y, { font: fett, groesse: 8, f: FARBE_GRAU });
    text('Leistung', sp.bez, y, { font: fett, groesse: 8, f: FARBE_GRAU });
    text('Menge', sp.menge, y, { font: fett, groesse: 8, f: FARBE_GRAU, rechts: true });
    text('Einzelpreis', sp.preis, y, { font: fett, groesse: 8, f: FARBE_GRAU, rechts: true });
    if (mitSteuerSpalte) text('USt.', sp.ust, y, { font: fett, groesse: 8, f: FARBE_GRAU, rechts: true });
    text('Betrag', sp.gesamt, y, { font: fett, groesse: 8, f: FARBE_GRAU, rechts: true });
    y -= 2.5 * MM; linie(y, RAND_L, A4[0] - RAND_R, FARBE_TEXT, 0.8); y -= 5 * MM;
  };
  const platz = (h) => { if (y - h < FUSS_H + 12 * MM) { neueSeite(); y -= 5 * MM; tabellenKopf(); } };
  tabellenKopf();
  for (const p of b.positionen) {
    const zeilen = umbrechen(p.bezeichnung, normal, 9.5, bezBreite);
    const beschr = p.beschreibung ? umbrechen(p.beschreibung, normal, 8, bezBreite) : [];
    platz(zeilen.length * 4.6 * MM + beschr.length * 3.8 * MM + 3 * MM);
    const einheit = EINHEITEN[p.einheit] || p.einheit || '';
    text(p.nr, sp.pos, y);
    text(`${zahlDe(p.mengeD)} ${einheit}`.trim(), sp.menge, y, { rechts: true });
    text(preisText(p.preisD, r.waehrung), sp.preis, y, { rechts: true });
    if (mitSteuerSpalte) text(`${zahlDe(p.satzD)} %`, sp.ust, y, { rechts: true });
    text(euro(p.netto, r.waehrung), sp.gesamt, y, { rechts: true });
    let letzteGrundlinie = y;
    for (const z of zeilen) { text(z, sp.bez, y); letzteGrundlinie = y; y -= 4.6 * MM; }
    for (const z of beschr) { text(z, sp.bez, y + 0.6 * MM, { groesse: 8, f: FARBE_GRAU }); letzteGrundlinie = y + 0.6 * MM; y -= 3.8 * MM; }
    const linienY = letzteGrundlinie - 2.4 * MM;
    linie(linienY);
    y = linienY - 4.6 * MM;
  }

  // ---------- Summen ----------
  platz(12 * MM + b.steuern.length * 5 * MM);
  y -= 0.5 * MM;
  const xl = RAND_L + 95 * MM;
  const summe = (l, w, fettDruck = false) => {
    text(l, xl, y, { font: fettDruck ? fett : normal, groesse: fettDruck ? 10.5 : 9.5 });
    text(w, sp.gesamt, y, { font: fettDruck ? fett : normal, groesse: fettDruck ? 10.5 : 9.5, rechts: true });
    y -= 5.2 * MM;
  };
  const nurSteuerfrei = b.steuern.every((g) => g.kategorie !== 'S');
  if (!nurSteuerfrei) summe('Summe netto', euro(b.netto, r.waehrung));
  for (const g of b.steuern) {
    if (g.kategorie === 'S') summe(`Umsatzsteuer ${zahlDe(g.satz)} % auf ${euro(g.basis, r.waehrung)}`, euro(g.steuer, r.waehrung));
  }
  linie(y + 3.2 * MM, xl, A4[0] - RAND_R, FARBE_TEXT, 0.8);
  y -= 0.8 * MM;
  summe('Rechnungsbetrag', euro(b.brutto, r.waehrung), true);
  y -= 4 * MM;

  // ---------- Hinweise und Zahlung ----------
  const absatz = (s, opts = {}) => {
    for (const z of umbrechen(s, opts.font || normal, opts.groesse || 9, BREITE)) {
      platz(5 * MM); text(z, RAND_L, y, { groesse: opts.groesse || 9, font: opts.font || normal, f: opts.f || FARBE_TEXT }); y -= 4.4 * MM;
    }
    y -= 1.5 * MM;
  };
  for (const h of hinweiseFuer(r)) absatz(h);
  const faellig = faelligAm(r);
  absatz(zahlungsbedingungen(r) + (faellig ? ` Fällig am ${datumDe(faellig)}.` : ''));
  if (r.iban) {
    absatz(`Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer ${r.nummer} auf folgendes Konto: ` +
      `${r.kontoinhaber || v.name}, IBAN ${String(r.iban).replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()}` +
      (r.bic ? `, BIC ${r.bic}` : '') + '.');
  }
  if (r.schlusstext) absatz(r.schlusstext);

  // ---------- Fußzeile auf allen Seiten ----------
  const spalten = [
    [v.name, v.strasse, `${v.plz} ${v.ort}`],
    [v.telefon ? `Tel. ${v.telefon}` : null, v.email, v.web].filter(Boolean),
    [v.steuernummer ? `Steuernummer ${v.steuernummer}` : null, v.ustId ? `USt-IdNr. ${v.ustId}` : null,
      r.iban ? `IBAN ${String(r.iban).replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()}` : null].filter(Boolean),
  ];
  seiten.forEach((s, i) => {
    seite = s;
    linie(FUSS_H, RAND_L, A4[0] - RAND_R);
    const breite = BREITE / 3;
    spalten.forEach((zeilen, j) => {
      let yf = FUSS_H - 5 * MM;
      for (const z of zeilen) { text(z, RAND_L + j * breite, yf, { groesse: 7, f: FARBE_GRAU }); yf -= 3.4 * MM; }
    });
    if (seiten.length > 1) text(`Seite ${i + 1} von ${seiten.length}`, A4[0] - RAND_R, 6 * MM, { groesse: 7, f: FARBE_GRAU, rechts: true });
  });

  // ---------- PDF/A-3 ----------
  const titel = `Rechnung ${r.nummer}`;
  const producer = 'e-rechnung-de (pdf-lib)';
  const creator = 'e-rechnung-de';
  const datumIso = jetzt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  doc.setTitle(titel);
  doc.setAuthor(v.name);
  doc.setProducer(producer);
  doc.setCreator(creator);
  doc.setCreationDate(jetzt);
  doc.setModificationDate(jetzt);
  doc.setLanguage('de-DE');

  const ctx = doc.context;
  const metadaten = ctx.stream(new TextEncoder().encode(xmp({ titel, autor: v.name, producer, creator, datumIso, mitZugferd: !!opt.xml })),
    { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(metadaten));

  const icc = ctx.flateStream(opt.icc, { N: 3 });
  const intent = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: ctx.register(icc) });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));

  if (opt.xml) {
    const xmlBytes = new TextEncoder().encode(opt.xml);
    const datumPdf = PDFString.fromDate(jetzt);
    const datei = ctx.flateStream(xmlBytes, { Type: 'EmbeddedFile', Subtype: 'text/xml',
      Params: { Size: xmlBytes.length, ModDate: datumPdf, CreationDate: datumPdf } });
    const dateiRef = ctx.register(datei);
    const spec = ctx.register(ctx.obj({
      Type: 'Filespec', F: PDFString.of('xrechnung.xml'), UF: PDFHexString.fromText('xrechnung.xml'),
      Desc: PDFString.of('Rechnungsdaten im Format XRechnung (ZUGFeRD-Profil XRECHNUNG)'),
      AFRelationship: 'Alternative', EF: { F: dateiRef, UF: dateiRef },
    }));
    doc.catalog.set(PDFName.of('Names'), ctx.obj({ EmbeddedFiles: { Names: [PDFString.of('xrechnung.xml'), spec] } }));
    doc.catalog.set(PDFName.of('AF'), ctx.obj([spec]));
  }

  const idQuelle = new TextEncoder().encode(`${r.nummer}|${datumIso}|${v.name}|${centText(b.brutto)}`);
  const id = await dokumentId(idQuelle);
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);

  return doc.save({ useObjectStreams: false });
}
