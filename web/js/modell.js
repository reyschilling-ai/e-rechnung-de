// Rechnungsdaten, Pflichtangaben und Beträge. Rechnet mit BigInt (Cent-genau, kaufmännisch gerundet).

export const STEUERFAELLE = {
  regulaer: { kategorie: 'S', label: 'Regelbesteuert', satz: null, grund: null, code: null },
  kleinunternehmer: { kategorie: 'E', label: 'Kleinunternehmer (§ 19 UStG)', satz: '0',
    grund: 'Kleinunternehmer gemäß § 19 Abs. 1 UStG', code: null },
  reverse_charge: { kategorie: 'AE', label: 'Reverse Charge (EU-Kunde)', satz: '0',
    grund: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)', code: 'VATEX-EU-AE' },
};

export const EINHEITEN = {
  C62: 'Stück', HUR: 'Stunde', DAY: 'Tag', MON: 'Monat', LS: 'Pauschal', KMT: 'Kilometer',
};

export const HINWEIS_KLEINUNTERNEHMER = 'Als Kleinunternehmer im Sinne von § 19 Abs. 1 UStG wird Umsatzsteuer nicht berechnet.';
export const HINWEIS_REVERSE_CHARGE = 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).';

// ---------- Dezimalarithmetik ----------
const SKALA = 4; // interne Nachkommastellen für Mengen, Preise, Sätze

export function dez(wert) {
  // "1.234,56" oder "1234.56" oder Zahl -> BigInt mit SKALA Nachkommastellen
  if (wert === null || wert === undefined || wert === '') return null;
  let s = String(wert).trim().replace(/\s/g, '');
  if (/,\d+$/.test(s) || (s.includes(',') && !s.includes('.'))) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  let [ganz, frac = ''] = s.split('.');
  if (frac.length > SKALA) {
    const rund = BigInt(frac[SKALA]) >= 5n;
    frac = frac.slice(0, SKALA);
    let v = BigInt(ganz + frac) + (rund ? 1n : 0n);
    return neg ? -v : v;
  }
  const v = BigInt(ganz + frac.padEnd(SKALA, '0'));
  return neg ? -v : v;
}

function rundeAuf(wert, vonSkala, aufSkala) {
  const teiler = 10n ** BigInt(vonSkala - aufSkala);
  const neg = wert < 0n;
  let a = neg ? -wert : wert;
  let q = a / teiler;
  if ((a % teiler) * 2n >= teiler) q += 1n;
  return neg ? -q : q;
}

// Cent-Betrag (BigInt, Skala 2) -> "123.45"
export function centText(c) {
  const neg = c < 0n;
  const a = (neg ? -c : c).toString().padStart(3, '0');
  return (neg ? '-' : '') + a.slice(0, -2) + '.' + a.slice(-2);
}

// Skala-4-Wert -> kürzeste Dezimaldarstellung ("12.5", "19", "0")
export function dezText(v) {
  const neg = v < 0n;
  let a = (neg ? -v : v).toString().padStart(SKALA + 1, '0');
  let g = a.slice(0, -SKALA), f = a.slice(-SKALA).replace(/0+$/, '');
  return (neg ? '-' : '') + g + (f ? '.' + f : '');
}

export function euro(c, waehrung = 'EUR') {
  const t = centText(c);
  const [g, f] = t.replace('-', '').split('.');
  const mitPunkt = g.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (c < 0n ? '-' : '') + mitPunkt + ',' + f + (waehrung === 'EUR' ? ' €' : ' ' + waehrung);
}

export function zahlDe(v) {
  return dezText(v).replace('.', ',');
}

// ---------- Prüfungen ----------
export function ibanGueltig(iban) {
  const s = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const umgestellt = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of umgestellt) {
    const z = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of z) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

export const emailGueltig = (e) => /^[^@\s]+@([^@.\s]+\.)+[^@.\s]+$/.test(String(e || '').trim());

export function datumPlus(iso, tage) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(tage));
  return d.toISOString().slice(0, 10);
}

export function datumDe(iso) {
  if (!iso) return '';
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

// ---------- Berechnung ----------
// rechnung: { positionen: [{bezeichnung, menge, einheit, einzelpreis, steuerfall, steuersatz}], ... }
export function berechnen(rechnung) {
  const positionen = rechnung.positionen.map((p, i) => {
    const menge = dez(p.menge ?? 1);
    const preis = dez(p.einzelpreis);
    const fall = STEUERFAELLE[p.steuerfall] ? p.steuerfall : 'regulaer';
    const satz = STEUERFAELLE[fall].satz !== null ? dez(STEUERFAELLE[fall].satz) : dez(p.steuersatz);
    const netto = (typeof menge === 'bigint' && typeof preis === 'bigint') ? rundeAuf(menge * preis, 8, 2) : null;
    return { ...p, nr: String(i + 1), mengeD: menge, preisD: preis, satzD: satz, steuerfall: fall,
      kategorie: STEUERFAELLE[fall].kategorie, netto };
  });
  const gruppen = new Map();
  for (const p of positionen) {
    if (p.netto === null || typeof p.satzD !== 'bigint') continue;
    const k = p.kategorie + '|' + p.satzD;
    if (!gruppen.has(k)) {
      const f = STEUERFAELLE[p.steuerfall];
      gruppen.set(k, { kategorie: p.kategorie, satz: p.satzD, basis: 0n, grund: f.grund, code: f.code });
    }
    gruppen.get(k).basis += p.netto;
  }
  const steuern = [...gruppen.values()].map((g) => ({ ...g, steuer: rundeAuf(g.basis * g.satz, 8, 2) }));
  const netto = positionen.reduce((s, p) => s + (p.netto ?? 0n), 0n);
  const steuer = steuern.reduce((s, g) => s + g.steuer, 0n);
  return { positionen, steuern, netto, steuer, brutto: netto + steuer };
}

// Pflichtangaben prüfen. eRechnung=true prüft zusätzlich, was XRechnung verlangt.
export function pflichtangaben(r, { eRechnung }) {
  const f = [];
  const v = r.verkaeufer || {}, k = r.kaeufer || {};
  const fehlt = (bed, text) => { if (!bed) f.push(text); };
  fehlt(r.nummer, 'Rechnungsnummer fehlt');
  fehlt(r.datum, 'Rechnungsdatum fehlt');
  fehlt(r.leistungsdatum || (r.zeitraumVon && r.zeitraumBis), 'Leistungsdatum oder Leistungszeitraum fehlt (§ 14 Abs. 4 Nr. 6 UStG)');
  if (r.zeitraumVon && r.zeitraumBis && r.zeitraumVon > r.zeitraumBis) f.push('Leistungszeitraum: „von“ liegt nach „bis“');
  fehlt(v.name, 'Meine Daten: Name fehlt');
  fehlt(v.strasse && v.plz && v.ort, 'Meine Daten: Anschrift unvollständig');
  fehlt(v.steuernummer || v.ustId, 'Meine Daten: Steuernummer oder USt-IdNr. fehlt (§ 14 Abs. 4 UStG)');
  fehlt(k.name, 'Kunde: Name fehlt');
  fehlt(k.strasse && k.plz && k.ort, 'Kunde: Anschrift unvollständig');
  if (!r.positionen.length) f.push('Mindestens eine Position ist nötig');
  r.positionen.forEach((p, i) => {
    if (!String(p.bezeichnung || '').trim()) f.push(`Position ${i + 1}: Bezeichnung fehlt`);
    const pr = dez(p.einzelpreis), m = dez(p.menge ?? 1);
    if (typeof pr !== 'bigint') f.push(`Position ${i + 1}: Einzelpreis ist keine Zahl`);
    if (typeof m !== 'bigint') f.push(`Position ${i + 1}: Menge ist keine Zahl`);
    if (p.steuerfall === 'regulaer' && !(dez(p.steuersatz) > 0n)) f.push(`Position ${i + 1}: Steuersatz fehlt`);
  });
  const faelle = new Set(r.positionen.map((p) => p.steuerfall));
  if (faelle.has('kleinunternehmer') && faelle.size > 1) f.push('Kleinunternehmer-Positionen lassen sich nicht mit anderen Steuerfällen mischen');
  if (faelle.has('reverse_charge')) {
    fehlt(k.ustId, 'Reverse Charge: USt-IdNr. des Kunden fehlt');
    fehlt(v.ustId, 'Reverse Charge: eigene USt-IdNr. fehlt');
  }
  if (r.iban || eRechnung) {
    fehlt(ibanGueltig(r.iban), 'IBAN fehlt oder ist ungültig');
  }
  if (eRechnung) {
    fehlt(emailGueltig(v.email), 'Meine Daten: gültige E-Mail-Adresse fehlt (Pflicht in XRechnung)');
    fehlt(String(v.telefon || '').replace(/\D/g, '').length >= 3, 'Meine Daten: Telefonnummer fehlt (Pflicht in XRechnung)');
    fehlt(emailGueltig(k.email), 'Kunde: E-Mail-Adresse für den Rechnungseingang fehlt (Pflicht in XRechnung)');
  }
  return f;
}

export function hinweiseFuer(r) {
  const h = [...(r.hinweise || [])].filter(Boolean);
  const faelle = new Set(r.positionen.map((p) => p.steuerfall));
  if (faelle.has('kleinunternehmer') && !h.some((x) => x.includes('§ 19'))) h.unshift(HINWEIS_KLEINUNTERNEHMER);
  if (faelle.has('reverse_charge') && !h.some((x) => /Reverse Charge|13b/.test(x))) h.unshift(HINWEIS_REVERSE_CHARGE);
  return h;
}

export function zahlungsbedingungen(r) {
  if (r.zahlungsbedingungen) return r.zahlungsbedingungen;
  if (r.zielTage !== undefined && r.zielTage !== '' && r.zielTage !== null) {
    return Number(r.zielTage) === 0 ? 'Zahlbar sofort ohne Abzug.' : `Zahlbar innerhalb von ${r.zielTage} Tagen ohne Abzug.`;
  }
  return 'Zahlbar sofort ohne Abzug.';
}

export function faelligAm(r) {
  if (r.faelligAm) return r.faelligAm;
  if (r.datum && r.zielTage !== undefined && r.zielTage !== '' && r.zielTage !== null) return datumPlus(r.datum, r.zielTage);
  return null;
}
