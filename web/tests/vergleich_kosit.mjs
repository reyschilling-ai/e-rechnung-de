// Vergleicht die Browser-Prüfung (fontoxpath) mit den Berichten des KoSIT-Validators.
// Aufruf: node vergleich_kosit.mjs <ordner-mit-xml> <ordner-mit-kosit-berichten>
import fs from 'node:fs';
import path from 'node:path';
import { sync as parse } from 'slimdom-sax-parser';
import { Pruefer } from '../js/pruefung.js';

const [ordner, berichte] = process.argv.slice(2);
const regeln = JSON.parse(fs.readFileSync(new URL('../regeln/regeln.json', import.meta.url)));
const pruefer = new Pruefer(Object.entries(regeln).map(([name, r]) => ({ name, ...r })));
let abweichungen = 0;
for (const f of fs.readdirSync(ordner).filter((f) => f.endsWith('.xml') && !f.includes('-report'))) {
  const doc = parse(fs.readFileSync(path.join(ordner, f), 'utf8'));
  const t0 = Date.now();
  const e = pruefer.pruefen(doc);
  const ms = Date.now() - t0;
  const js = new Set(e.fehler.map((m) => m.id));
  const bericht = fs.readFileSync(path.join(berichte, f.replace(/\.xml$/, '-report.xml')), 'utf8');
  const kosit = new Set([...bericht.matchAll(/<rep:message[^>]*level="error"[^>]*code="([^"]+)"/g)].map((m) => m[1]));
  const gleich = js.size === kosit.size && [...js].every((x) => kosit.has(x));
  if (!gleich) abweichungen++;
  console.log(`${gleich ? 'OK ' : 'XX '} ${f.padEnd(40)} ${ms}ms  browser=[${[...js].sort()}]  kosit=[${[...kosit].sort()}]`);
}
process.exit(abweichungen ? 1 : 0);
