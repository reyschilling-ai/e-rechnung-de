// Kerntests: Berechnung, XML-Erzeugung, Prüfung im Browser-Regelwerk, Einlesen (Rundlauf).
// Aufruf: node --test tests/  (schreibt die erzeugten XML zusätzlich nach $XML_AUSGABE, falls gesetzt)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sync as parse } from 'slimdom-sax-parser';
import { berechnen, pflichtangaben, ibanGueltig, euro } from '../js/modell.js';
import { erzeugen, einlesen } from '../js/cii.js';
import { Pruefer } from '../js/pruefung.js';
import { BEISPIELE, STORNO } from './beispiele.mjs';

const regeln = JSON.parse(fs.readFileSync(new URL('../regeln/regeln.json', import.meta.url)));
const pruefer = new Pruefer(Object.entries(regeln).map(([name, r]) => ({ name, ...r })));
const parser = { parseFromString: (s) => parse(s) };

test('Summen mit gemischten Steuersätzen (kaufmännisch gerundet)', () => {
  const b = berechnen(BEISPIELE.regelbesteuert);
  assert.equal(b.netto, 195480n);
  assert.equal(b.steuer, 36184n); // 356,25 + 5,586 -> 5,59
  assert.equal(b.brutto, 231664n);
  assert.equal(euro(b.brutto), '2.316,64 €');
});

test('IBAN-Prüfziffer', () => {
  assert.ok(ibanGueltig('DE89 3704 0044 0532 0130 00'));
  assert.ok(!ibanGueltig('DE00370400440532013000'));
});

for (const [name, r] of Object.entries({ ...BEISPIELE, storno: STORNO })) {
  test(`${name}: Pflichtangaben vollständig, offizielle Regeln bestanden, Rundlauf`, () => {
    assert.deepEqual(pflichtangaben(r, { eRechnung: true }), []);
    const xml = erzeugen(r);
    if (process.env.XML_AUSGABE) {
      fs.mkdirSync(process.env.XML_AUSGABE, { recursive: true });
      fs.writeFileSync(path.join(process.env.XML_AUSGABE, `js_${name}.xml`), xml);
    }
    const e = pruefer.pruefen(parse(xml));
    assert.deepEqual(e.fehler, []);
    const zurueck = einlesen(xml, parser);
    assert.equal(erzeugen({ ...zurueck, zielTage: undefined }), xml);
  });
}

test('fehlende Käufer-E-Mail wird vor dem Erzeugen gemeldet', () => {
  const r = structuredClone(BEISPIELE.kleinunternehmer);
  delete r.kaeufer.email;
  assert.ok(pflichtangaben(r, { eRechnung: true }).some((f) => f.includes('E-Mail-Adresse für den Rechnungseingang')));
  assert.deepEqual(pflichtangaben(r, { eRechnung: false }), []);
});

test('Browser-Regelwerk meldet falsche IBAN wie KoSIT als Warnung (BR-DE-19)', () => {
  const xml = erzeugen(BEISPIELE.kleinunternehmer).replace('DE89370400440532013000', 'DE00370400440532013000');
  const e = pruefer.pruefen(parse(xml));
  assert.ok(e.gueltig);
  assert.ok(e.hinweise.some((m) => m.id === 'BR-DE-19'));
});
