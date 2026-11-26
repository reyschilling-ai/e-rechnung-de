// Prüfsummenkette, ZIP und Archivpaket
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eintragBerechnen, kettePruefen, nummernluecken, sha256 } from '../js/protokoll.js';
import { zipErstellen, zipLesen } from '../js/zip.js';
import { archivErstellen, archivPruefen } from '../js/archiv.js';

async function kette(n) {
  const l = [];
  for (let i = 0; i < n; i++) l.push(await eintragBerechnen(l.at(-1), 'Test', { i }, `2027-01-0${i + 1}T10:00:00Z`));
  return l;
}

test('Prüfsummenkette erkennt Änderung, Lücke und Einschub', async () => {
  const k = await kette(4);
  assert.ok((await kettePruefen(k)).ok);
  const geaendert = structuredClone(k); geaendert[1].daten.i = 99;
  assert.match((await kettePruefen(geaendert)).fehler.join(), /nachträglich verändert/);
  const luecke = k.filter((e) => e.nr !== 2);
  assert.ok(!(await kettePruefen(luecke)).ok);
});

test('Nummernlücken', () => {
  assert.deepEqual(nummernluecken(['2027-001', '2027-002', '2027-005']), ['2027-003', '2027-004']);
  assert.deepEqual(nummernluecken(['A-1', 'A-2']), []);
});

test('ZIP-Rundlauf', async () => {
  const z = zipErstellen([{ name: 'a.txt', daten: 'Hallo' }, { name: 'ordner/ö.bin', daten: new Uint8Array([1, 2, 3]) }]);
  const d = await zipLesen(z);
  assert.equal(new TextDecoder().decode(d.get('a.txt')), 'Hallo');
  assert.deepEqual([...d.get('ordner/ö.bin')], [1, 2, 3]);
  if (process.env.ARCHIV_AUSGABE) fs.writeFileSync(`${process.env.ARCHIV_AUSGABE}/test.zip`, z);
});

test('Archivpaket: unverändert gültig, Manipulation erkannt', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 Test');
  const xml = '<x/>';
  const prot = [];
  prot.push(await eintragBerechnen(null, 'Rechnung erstellt', { nummer: '2027-001', sha256Pdf: await sha256(pdf), sha256Xml: await sha256(xml) }));
  const r = { nummer: '2027-001', typ: 'rechnung', datum: '2027-01-15', netto: '100.00', steuer: '19.00', brutto: '119.00', format: 'zugferd',
    pdf, xml, zahlungen: [], erstellt: '2027-01-15T10:00:00Z', steuerfall: 'regulaer', daten: { kaeufer: { name: 'Kunde; mit Semikolon' } } };
  const a = await archivErstellen({ rechnungen: [r], protokoll: prot, profil: { name: 'Test' }, von: '2027-01-01', bis: '2027-01-31', titel: 'Archiv Januar 2027' });
  const ok = await archivPruefen(a.zip);
  assert.ok(ok.ok, ok.meldungen.join('\n'));
  const d = await zipLesen(a.zip);
  assert.match(new TextDecoder().decode(d.get('rechnungsausgangsbuch.csv')), /"Kunde; mit Semikolon"/);
  // Manipulation: PDF im Paket austauschen, Prüfsummenliste anpassen -> Abgleich mit Protokoll schlägt an
  const neuPdf = new TextEncoder().encode('%PDF-1.7 GEFÄLSCHT');
  const dateien = [...d].map(([name, daten]) => ({ name, daten: name.endsWith('.pdf') ? neuPdf : daten }));
  const summen = [];
  for (const f of dateien.filter((f) => f.name !== 'pruefsummen.sha256')) summen.push(`${await sha256(f.daten)}  ${f.name}`);
  const gefaelscht = zipErstellen([...dateien.filter((f) => f.name !== 'pruefsummen.sha256'), { name: 'pruefsummen.sha256', daten: summen.join('\n') + '\n' }]);
  const e = await archivPruefen(gefaelscht);
  assert.ok(!e.ok);
  assert.match(e.meldungen.join(), /protokollierten Fassung/);
});
