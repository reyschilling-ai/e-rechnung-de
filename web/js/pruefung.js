// Führt die offiziellen Schematron-Regeln (EN 16931 + XRechnung, aus der KoSIT-Konfiguration
// extrahiert) mit fontoxpath aus. Läuft im Browser und in Node.

import {
  evaluateXPath,
  evaluateXPathToNodes,
  evaluateXPathToBoolean,
  registerXQueryModule,
} from '../vendor/fontoxpath.js';

const HILFSFUNKTIONEN = `
module namespace u = "utils";
declare function u:decimalOrZero($element) as xs:decimal {
  if (boolean($element)) then xs:decimal($element) else 0
};
declare function u:mod97($s as xs:string) as xs:integer {
  fold-left(string-to-codepoints($s), 0, function($acc, $cp) { ($acc * 10 + ($cp - 48)) mod 97 })
};
declare function u:slack($exp as xs:decimal, $val as xs:decimal, $slack as xs:decimal) as xs:boolean {
  xs:decimal($exp + $slack) >= $val and xs:decimal($exp - $slack) <= $val
};
`;

let modulRegistriert = false;

function teileUnion(muster) {
  const teile = [];
  let tiefe = 0, zitat = null, start = 0;
  for (let i = 0; i < muster.length; i++) {
    const c = muster[i];
    if (zitat) { if (c === zitat) zitat = null; continue; }
    if (c === '"' || c === "'") zitat = c;
    else if (c === '[' || c === '(') tiefe++;
    else if (c === ']' || c === ')') tiefe--;
    else if (c === '|' && tiefe === 0) { teile.push(muster.slice(start, i).trim()); start = i + 1; }
  }
  teile.push(muster.slice(start).trim());
  return teile;
}

// XSLT-Match-Muster -> Ausdruck, der alle passenden Elemente liefert
function musterAlsAusdruck(muster) {
  return teileUnion(muster).map((t) => (t.startsWith('/') ? t : '//' + t)).join(' | ');
}

function ELEMENT(n) { return n && n.nodeType === 1; }

export class Pruefer {
  constructor(regelwerke) {
    // regelwerke: [{name, namespaces, globals, patterns}]
    this.regelwerke = regelwerke;
    if (!modulRegistriert) {
      registerXQueryModule(HILFSFUNKTIONEN);
      modulRegistriert = true;
    }
  }

  pruefen(dokument) {
    const meldungen = [];
    for (const rw of this.regelwerke) {
      const nsResolver = (p) => rw.namespaces[p] ?? null;
      const opts = { namespaceResolver: nsResolver, language: evaluateXPath.XPATH_3_1_LANGUAGE,
        moduleImports: { u: 'utils' } };
      // Variablen werden als let-Ausdrücke eingebettet. Werte über JavaScript durchzureichen
      // verändert Typen (leere Knotenmengen würden zu XPath-Arrays).
      const globale = rw.globals.filter((g) => g.select);
      const mitVariablen = (ausdruck, lokale = []) => {
        const benoetigt = new Set();
        const sammeln = (text) => {
          for (const g of globale) {
            if (!benoetigt.has(g.name) && new RegExp('\\$' + g.name.replace(/[-.]/g, '\\$&') + '(?![\\w.-])').test(text)) {
              benoetigt.add(g.name);
              sammeln(g.select);
            }
          }
        };
        sammeln(ausdruck + ' ' + lokale.map((l) => l.select).join(' '));
        const teile = [];
        if (benoetigt.size) {
          teile.push('$__wurzel := root(.)');
          for (const g of globale) if (benoetigt.has(g.name)) teile.push(`$${g.name} := $__wurzel ! (${g.select})`);
        }
        for (const l of lokale) teile.push(`$${l.name} := (${l.select})`);
        return teile.length ? `let ${teile.join(', ')} return (${ausdruck})` : ausdruck;
      };
      for (const [, regeln] of Object.entries(rw.patterns)) {
        const vergeben = new Set();
        for (const regel of regeln) {
          let knoten;
          try {
            knoten = evaluateXPathToNodes(mitVariablen(musterAlsAusdruck(regel.context)), dokument, null, {}, opts);
          } catch (e) {
            meldungen.push({ id: 'INTERN', flag: 'fatal', text: `Regelkontext nicht auswertbar: ${regel.context} (${e.message})` });
            continue;
          }
          for (const k of knoten) {
            if (!ELEMENT(k) || vergeben.has(k)) continue;
            vergeben.add(k);
            for (const a of regel.asserts) {
              let ok;
              try {
                ok = evaluateXPathToBoolean(mitVariablen(a.test, regel.lets), k, null, {}, opts);
              } catch (e) {
                meldungen.push({ id: a.id || 'INTERN', flag: 'fatal', text: `Regel nicht auswertbar (${e.message})`, regelwerk: rw.name });
                continue;
              }
              const verletzt = a.report ? ok : !ok;
              if (verletzt) meldungen.push({ id: a.id, flag: a.flag, text: a.text, regelwerk: rw.name, pfad: pfadVon(k) });
            }
          }
        }
      }
    }
    const fehler = meldungen.filter((m) => m.flag === 'fatal' || m.flag === 'error');
    return { gueltig: fehler.length === 0, fehler, hinweise: meldungen.filter((m) => !fehler.includes(m)) };
  }
}

function pfadVon(k) {
  const teile = [];
  while (k && k.nodeType === 1) {
    teile.unshift(k.localName);
    k = k.parentNode;
  }
  return '/' + teile.join('/');
}
