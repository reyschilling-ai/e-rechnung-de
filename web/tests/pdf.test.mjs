// Erzeugt PDFs aus den Beispielen (mit und ohne XML) für die Prüfung mit Mustang/veraPDF.
// Aufruf: PDF_AUSGABE=/pfad node --test tests/pdf.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as PDFLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { erzeugen } from '../js/cii.js';
import { pdfErzeugen } from '../js/pdf.js';
import { BEISPIELE, STORNO } from './beispiele.mjs';

const lies = (p) => new Uint8Array(fs.readFileSync(new URL(p, import.meta.url)));
const opt = { schriften: { normal: lies('../assets/LiberationSans-Regular.ttf'), fett: lies('../assets/LiberationSans-Bold.ttf') },
  icc: lies('../assets/sRGB.icc'), jetzt: new Date('2027-01-15T10:00:00Z') };
const ziel = process.env.PDF_AUSGABE || fs.mkdtempSync('/tmp/pdf-');

for (const [name, r] of Object.entries({ ...BEISPIELE, storno: STORNO })) {
  test(`${name}: ZUGFeRD-PDF und reine PDF`, async () => {
    const xml = erzeugen(r);
    const mit = await pdfErzeugen({ PDFLib, fontkit }, r, { ...opt, xml });
    const ohne = await pdfErzeugen({ PDFLib, fontkit }, r, opt);
    fs.mkdirSync(ziel, { recursive: true });
    fs.writeFileSync(path.join(ziel, `zugferd_${name}.pdf`), mit);
    fs.writeFileSync(path.join(ziel, `nurpdf_${name}.pdf`), ohne);
    assert.ok(mit.length > 5000);
    const geladen = await PDFLib.PDFDocument.load(mit);
    assert.equal(geladen.getTitle(), `${r.typ === 'storno' ? 'Stornorechnung' : 'Rechnung'} ${r.nummer}`);
  });
}

test('lange Rechnung bricht auf mehrere Seiten um', async () => {
  const r = structuredClone(BEISPIELE.regelbesteuert);
  r.positionen = Array.from({ length: 45 }, (_, i) => ({ bezeichnung: `Leistung Nummer ${i + 1} mit einem etwas längeren Text, der umbrechen muss`,
    beschreibung: i % 3 === 0 ? 'Zusatzbeschreibung zur Position' : '', menge: '1', einheit: 'HUR', einzelpreis: '99.5', steuerfall: 'regulaer', steuersatz: '19' }));
  const pdf = await pdfErzeugen({ PDFLib, fontkit }, r, { ...opt, xml: erzeugen(r) });
  fs.writeFileSync(path.join(ziel, 'zugferd_lang.pdf'), pdf);
  const geladen = await PDFLib.PDFDocument.load(pdf);
  assert.ok(geladen.getPageCount() >= 2);
});
