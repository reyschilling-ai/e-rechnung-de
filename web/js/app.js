import { berechnen, pflichtangaben, euro, dez, datumDe, faelligAm, centText, EINHEITEN, emailGueltig, ibanGueltig } from './modell.js';
import { erzeugen, einlesen } from './cii.js';
import * as db from './speicher.js';

// ---------------- Hilfen ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const heute = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cent = (s) => BigInt(String(s).replace('.', '').replace(/^(-?)0+(?=\d)/, '$1'));

function meldung(text, dauer = 3500) {
  $$('.meldung').forEach((alt) => alt.remove());
  const m = document.createElement('div');
  m.className = 'meldung'; m.textContent = text; m.setAttribute('role', 'status');
  document.body.append(m);
  setTimeout(() => m.remove(), dauer);
}

function herunterladen(daten, name, typ) {
  const blob = daten instanceof Blob ? daten : new Blob([daten], { type: typ });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const dateiname = (nr, endung) => `Rechnung_${String(nr).replace(/[^\w.-]+/g, '_')}.${endung}`;

function formWerte(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.type === 'file' || el.type === 'radio') continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  return o;
}
function formSetzen(form, werte) {
  for (const el of form.elements) {
    if (!el.name || el.type === 'file' || el.type === 'radio' || !(el.name in werte)) continue;
    if (el.type === 'checkbox') el.checked = !!werte[el.name]; else el.value = werte[el.name] ?? '';
  }
}

// ---------------- Zustand ----------------
const zustand = { profil: {}, kunden: [], rechnungen: [] };
const STANDARD_PROFIL = { land: 'DE', steuerfall: 'regulaer', steuersatz: '19', zielTage: '14', naechsteNummer: '1', stellen: '3', praefix: `${new Date().getFullYear()}-` };

async function laden() {
  zustand.profil = { ...STANDARD_PROFIL, ...(await db.einstellung('profil', {})) };
  zustand.kunden = (await db.alle('kunden')).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  zustand.rechnungen = (await db.alle('rechnungen')).sort((a, b) => (b.datum + b.nummer).localeCompare(a.datum + a.nummer));
}

// ---------------- Tabs ----------------
function zeigeTab(name) {
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const s of $$('.tab')) s.hidden = s.id !== `tab-${name}`;
  if (name === 'liste') zeichneListe();
  if (name === 'kunden') zeichneKunden();
  history.replaceState(null, '', `#${name}`);
}

// ---------------- Rechnung schreiben ----------------
const formR = $('#form-rechnung');

function nummerVorschlag() {
  const p = zustand.profil;
  const n = Math.max(1, Number(p.naechsteNummer) || 1);
  const stellen = Math.min(8, Math.max(1, Number(p.stellen) || 3));
  let kandidat, i = n;
  const vergeben = new Set(zustand.rechnungen.map((r) => r.nummer));
  do { kandidat = `${p.praefix || ''}${String(i).padStart(stellen, '0')}`; i++; } while (vergeben.has(kandidat));
  return kandidat;
}

// Preis für das Eingabefeld: deutsches Komma, mindestens zwei Nachkommastellen
function preisAnzeige(wert) {
  const d = dez(wert);
  if (typeof d !== 'bigint') return wert ? String(wert) : '';
  const t = (Number(d) / 10000).toFixed(4).replace(/(\.\d\d\d?)0+$/, '$1').replace(/(\.\d\d)0$/, '$1');
  return t.replace('.', ',');
}

function positionZeile(p = {}) {
  const div = document.createElement('div');
  div.className = 'position';
  div.innerHTML = `
    <span class="nr"></span>
    <div class="bez">
      <input name="bezeichnung" placeholder="Leistung" aria-label="Bezeichnung">
      <textarea name="beschreibung" rows="1" placeholder="Beschreibung (optional)" aria-label="Beschreibung"></textarea>
    </div>
    <input name="menge" class="zahl" inputmode="decimal" aria-label="Menge">
    <select name="einheit" aria-label="Einheit">${Object.entries(EINHEITEN).map(([c, l]) => `<option value="${c}">${l}</option>`).join('')}</select>
    <input name="einzelpreis" class="zahl" inputmode="decimal" placeholder="0,00" aria-label="Einzelpreis netto">
    <select name="steuersatz" class="satz" aria-label="Steuersatz"><option value="19">19 %</option><option value="7">7 %</option></select>
    <button type="button" class="weg" title="Position entfernen" aria-label="Position entfernen">×</button>`;
  $('[name=bezeichnung]', div).value = p.bezeichnung || '';
  $('[name=beschreibung]', div).value = p.beschreibung || '';
  $('[name=menge]', div).value = p.menge ? String(p.menge).replace('.', ',') : '1';
  $('[name=einheit]', div).value = EINHEITEN[p.einheit] ? p.einheit : 'C62';
  $('[name=einzelpreis]', div).value = preisAnzeige(p.einzelpreis);
  const satz = String(p.steuersatz || zustand.profil.steuersatz || '19').replace(/\.0+$/, '');
  if (!['19', '7'].includes(satz)) $('[name=steuersatz]', div).insertAdjacentHTML('beforeend', `<option value="${esc(satz)}">${esc(satz)} %</option>`);
  $('[name=steuersatz]', div).value = satz;
  $('.weg', div).addEventListener('click', () => { div.remove(); nummeriere(); aktualisiere(); });
  return div;
}

function nummeriere() {
  const kopf = $('#positionen .position-kopf');
  if (!kopf) $('#positionen').insertAdjacentHTML('afterbegin', '<div class="position-kopf"><span></span><span>Leistung</span><span>Menge</span><span>Einheit</span><span>Einzelpreis netto</span><span>USt.</span><span></span></div>');
  $$('#positionen .position').forEach((p, i) => { $('.nr', p).textContent = i + 1; });
}

function positionenLesen() {
  return $$('#positionen .position').map((d) => ({
    bezeichnung: $('[name=bezeichnung]', d).value.trim(), beschreibung: $('[name=beschreibung]', d).value.trim(),
    menge: $('[name=menge]', d).value.trim() || '1', einheit: $('[name=einheit]', d).value,
    einzelpreis: $('[name=einzelpreis]', d).value.trim(), steuersatz: $('[name=steuersatz]', d).value,
  })).filter((p) => p.bezeichnung || p.einzelpreis);
}

function rechnungAusFormular() {
  const w = formWerte(formR);
  const p = zustand.profil;
  const steuerfall = w.steuerfall || 'regulaer';
  return {
    nummer: w.nummer, datum: w.datum, leistungsdatum: w.leistungsdatum,
    zeitraumVon: w.zeitraumVon, zeitraumBis: w.zeitraumBis,
    kaeuferreferenz: w.kaeuferreferenz, bestellnummer: w.bestellnummer, zielTage: w.zielTage, waehrung: 'EUR',
    verkaeufer: { name: p.name, kontaktName: p.kontaktName, strasse: p.strasse, plz: p.plz, ort: p.ort, land: p.land || 'DE',
      email: p.email, telefon: p.telefon, web: p.web, steuernummer: p.steuernummer, ustId: p.ustId },
    kaeufer: { name: w['k.name'], strasse: w['k.strasse'], zusatz: w['k.zusatz'], plz: w['k.plz'], ort: w['k.ort'],
      land: (w['k.land'] || 'DE').toUpperCase(), email: w['k.email'], ustId: w['k.ustId'] },
    iban: p.iban, bic: p.bic, kontoinhaber: p.kontoinhaber,
    hinweise: (w.hinweisText || '').split(/\n+/).map((s) => s.trim()).filter(Boolean),
    anschreiben: w.anschreiben, schlusstext: w.schlusstext,
    positionen: positionenLesen().map((x) => ({ ...x, steuerfall })),
    _steuerfall: steuerfall,
  };
}

function formatGewaehlt() { return $('input[name=format]:checked').value; }

let entwurfTimer;
function aktualisiere() {
  const r = rechnungAusFormular();
  const regulaer = r._steuerfall === 'regulaer';
  $$('#positionen .position').forEach((d) => d.classList.toggle('ohne-satz', !regulaer));
  // Beträge je Zeile
  $$('#positionen .position').forEach((d) => {
    let el = $('.betrag', d);
    if (!el) { el = document.createElement('span'); el.className = 'betrag'; }
    const m = dez($('[name=menge]', d).value || '1'), pr = dez($('[name=einzelpreis]', d).value);
    d.dataset.betrag = typeof m === 'bigint' && typeof pr === 'bigint' ? euro(berechnen({ positionen: [{ menge: $('[name=menge]', d).value || '1', einzelpreis: $('[name=einzelpreis]', d).value, steuerfall: 'kleinunternehmer' }] }).netto) : '';
    $('[name=einzelpreis]', d).title = d.dataset.betrag ? `Zeilenbetrag: ${d.dataset.betrag}` : '';
  });
  const b = berechnen(r);
  const zeilen = [];
  if (b.steuern.some((g) => g.kategorie === 'S')) {
    zeilen.push(['Netto', euro(b.netto)]);
    for (const g of b.steuern) if (g.kategorie === 'S') zeilen.push([`USt. ${(Number(g.satz) / 10000).toLocaleString('de-DE')} %`, euro(g.steuer)]);
  }
  $('#summen').innerHTML = zeilen.map(([l, w]) => `<dt>${l}</dt><dd>${w}</dd>`).join('') +
    `<dt class="gesamt">Rechnungsbetrag</dt><dd class="gesamt">${euro(b.brutto)}</dd>`;
  clearTimeout(entwurfTimer);
  entwurfTimer = setTimeout(entwurfSpeichern, 600);
}

async function entwurfSpeichern() {
  const w = formWerte(formR);
  await db.setzeEinstellung('entwurf', { ...w, positionen: positionenLesen(), format: formatGewaehlt(), kundeId: $('#kunde-auswahl').value });
}

function formularFuellen(e = {}) {
  const p = zustand.profil;
  formSetzen(formR, {
    nummer: e.nummer || nummerVorschlag(), datum: e.datum || heute(), zielTage: e.zielTage ?? p.zielTage ?? '14',
    leistungsdatum: e.leistungsdatum ?? '', zeitraumVon: e.zeitraumVon ?? '', zeitraumBis: e.zeitraumBis ?? '',
    kaeuferreferenz: e.kaeuferreferenz ?? '', bestellnummer: e.bestellnummer ?? '',
    steuerfall: e.steuerfall || p.steuerfall || 'regulaer',
    'k.name': e['k.name'] ?? '', 'k.strasse': e['k.strasse'] ?? '', 'k.zusatz': e['k.zusatz'] ?? '', 'k.plz': e['k.plz'] ?? '',
    'k.ort': e['k.ort'] ?? '', 'k.land': e['k.land'] || 'DE', 'k.email': e['k.email'] ?? '', 'k.ustId': e['k.ustId'] ?? '',
    anschreiben: e.anschreiben ?? '', hinweisText: e.hinweisText ?? '', schlusstext: e.schlusstext ?? (p.schlusstext || ''),
  });
  $('#kunde-auswahl').value = e.kundeId || '';
  $(`input[name=format][value=${e.format === 'pdf' ? 'pdf' : 'zugferd'}]`).checked = true;
  $('#positionen').innerHTML = '';
  const pos = e.positionen?.length ? e.positionen : [{}];
  for (const x of pos) $('#positionen').append(positionZeile(x));
  nummeriere();
  $('#pruefliste').innerHTML = '';
  aktualisiere();
}

function kundenAuswahlFuellen() {
  const sel = $('#kunde-auswahl');
  const wert = sel.value;
  sel.innerHTML = '<option value="">– neuer Kunde –</option>' +
    zustand.kunden.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}${k.ort ? ' · ' + esc(k.ort) : ''}</option>`).join('');
  sel.value = zustand.kunden.some((k) => k.id === wert) ? wert : '';
}

function kundeInFormular(k) {
  formSetzen(formR, { 'k.name': k.name, 'k.strasse': k.strasse, 'k.zusatz': k.zusatz, 'k.plz': k.plz, 'k.ort': k.ort,
    'k.land': k.land || 'DE', 'k.email': k.email, 'k.ustId': k.ustId, kaeuferreferenz: k.kaeuferreferenz || '' });
  if (k.ustId && (k.land || 'DE') !== 'DE' && formR.steuerfall.value === 'regulaer') formR.steuerfall.value = 'reverse_charge';
  aktualisiere();
}

// ---------------- Prüfen und Erzeugen ----------------
let bibliotheken = null;
async function libs() {
  if (bibliotheken) return bibliotheken;
  $('#status-laden').textContent = 'Lade Prüfregeln und PDF-Werkzeuge …';
  const skript = (src) => new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src, onload: res, onerror: () => rej(new Error(`${src} nicht ladbar`)) });
    document.head.append(s);
  });
  const bytes = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const [{ Pruefer }, regeln] = await Promise.all([import('./pruefung.js'), fetch('regeln/regeln.json').then((r) => r.json()), skript('vendor/pdf-lib.min.js'), skript('vendor/fontkit.umd.min.js')]);
  const [normal, fett, icc, { pdfErzeugen }] = await Promise.all([bytes('assets/LiberationSans-Regular.ttf'), bytes('assets/LiberationSans-Bold.ttf'), bytes('assets/sRGB.icc'), import('./pdf.js')]);
  bibliotheken = {
    pruefer: new Pruefer(Object.entries(regeln).map(([name, r]) => ({ name, ...r }))),
    pdf: { PDFLib: window.PDFLib, fontkit: window.fontkit }, schriften: { normal, fett }, icc, pdfErzeugen,
  };
  $('#status-laden').textContent = '';
  return bibliotheken;
}

function zeigePruefung(html, art) {
  $('#pruefliste').innerHTML = `<div class="kasten ${art}">${html}</div>`;
}

async function pruefen({ fuerXml = false } = {}) {
  const r = rechnungAusFormular();
  const eRechnung = fuerXml || formatGewaehlt() === 'zugferd';
  const fehler = pflichtangaben(r, { eRechnung });
  if (!fehler.length && zustand.rechnungen.some((x) => x.nummer === r.nummer) && !fuerXml) fehler.push(`Rechnungsnummer ${r.nummer} ist schon vergeben`);
  $$('input[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (fehler.length) {
    zeigePruefung(`<strong>Bitte ergänzen:</strong><ul>${fehler.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`, 'schlecht');
    if (fehler.some((f) => f.startsWith('Meine Daten'))) zeigePruefung($('#pruefliste .kasten').innerHTML + '<p>Ihre eigenen Angaben pflegen Sie unter <a href="#profil" data-tab-link="profil">Meine Daten</a>.</p>', 'schlecht');
    return null;
  }
  const L = await libs();
  let xml = null, hinweise = [];
  if (eRechnung) {
    xml = erzeugen(r);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const e = L.pruefer.pruefen(doc);
    hinweise = e.hinweise;
    if (!e.gueltig) {
      zeigePruefung(`<strong>Die offiziellen Prüfregeln melden Fehler:</strong><ul>${e.fehler.map((m) => `<li><code>${esc(m.id)}</code> ${esc(m.text)}</li>`).join('')}</ul>`, 'schlecht');
      return null;
    }
  }
  return { r, xml, hinweise, L };
}

function hinweisListe(h) {
  return h.length ? `<p>Hinweise der Prüfregeln (kein Hindernis):</p><ul>${h.map((m) => `<li><code>${esc(m.id)}</code> ${esc(m.text)}</li>`).join('')}</ul>` : '';
}

async function erstellen() {
  const knopf = $('#erstellen');
  knopf.disabled = true;
  try {
    const p = await pruefen();
    if (!p) return;
    const { r, xml, hinweise, L } = p;
    let logo = null;
    if (zustand.profil.logo) {
      const roh = atob(zustand.profil.logo.daten);
      logo = { typ: zustand.profil.logo.typ, bytes: Uint8Array.from(roh, (c) => c.charCodeAt(0)) };
    }
    const pdf = await L.pdfErzeugen(L.pdf, r, { xml, logo, schriften: L.schriften, icc: L.icc });
    herunterladen(new Blob([pdf], { type: 'application/pdf' }), dateiname(r.nummer, 'pdf'));

    // Kunde merken
    let kundeId = $('#kunde-auswahl').value || null;
    if ($('#kunde-merken').checked) {
      const alt = zustand.kunden.find((k) => k.id === kundeId) || zustand.kunden.find((k) => k.name === r.kaeufer.name);
      const k = { ...(alt || { id: db.neueId(), erstellt: new Date().toISOString() }), ...r.kaeufer, kaeuferreferenz: r.kaeuferreferenz || alt?.kaeuferreferenz || '' };
      await db.speichere('kunden', k);
      kundeId = k.id;
    }
    const b = berechnen(r);
    const eintrag = {
      id: db.neueId(), nummer: r.nummer, datum: r.datum, faelligAm: faelligAm(r), kundeId, kunde: r.kaeufer.name,
      netto: centText(b.netto), steuer: centText(b.steuer), brutto: centText(b.brutto), format: xml ? 'zugferd' : 'pdf',
      daten: { ...r, _steuerfall: undefined }, steuerfall: r._steuerfall, xml, pdf, zahlungen: [], erstellt: new Date().toISOString(),
    };
    await db.speichere('rechnungen', eintrag);
    // Nummernkreis weiterzählen
    const vorschlag = nummerVorschlag();
    if (r.nummer === vorschlag) {
      zustand.profil.naechsteNummer = String(Number(zustand.profil.naechsteNummer || 1) + 1);
      await db.setzeEinstellung('profil', zustand.profil);
    }
    await laden();
    kundenAuswahlFuellen();
    zeigePruefung(`<strong>${xml ? 'E-Rechnung' : 'PDF'} ${esc(r.nummer)} erstellt</strong> und in „Rechnungen“ abgelegt.` +
      (xml ? ' Die XRechnung hat alle offiziellen Prüfregeln bestanden.' : '') + hinweisListe(hinweise), hinweise.length ? 'warn' : 'gut');
    const meldungAlt = $('#pruefliste').innerHTML;
    formularFuellen({ steuerfall: r._steuerfall, format: xml ? 'zugferd' : 'pdf' });
    $('#pruefliste').innerHTML = meldungAlt;
    await db.setzeEinstellung('entwurf', null);
  } catch (e) {
    console.error(e);
    zeigePruefung(`<strong>Das hat nicht geklappt:</strong> ${esc(e.message)}`, 'schlecht');
  } finally {
    knopf.disabled = false;
  }
}

async function nurXml() {
  const p = await pruefen({ fuerXml: true });
  if (!p) return;
  herunterladen(p.xml, dateiname(p.r.nummer, 'xml'), 'application/xml');
  zeigePruefung('<strong>XRechnung heruntergeladen.</strong> Sie hat alle offiziellen Prüfregeln bestanden.' + hinweisListe(p.hinweise), p.hinweise.length ? 'warn' : 'gut');
}

async function xmlImportieren(datei) {
  try {
    const e = einlesen(await datei.text());
    const profilLeer = !zustand.profil.name;
    if (e.verkaeufer?.name && (profilLeer || confirm(`Absenderdaten aus der Datei übernehmen?\n\n${e.verkaeufer.name}\n\n„Abbrechen“ behält Ihre gespeicherten Daten.`))) {
      Object.assign(zustand.profil, Object.fromEntries(Object.entries({ ...e.verkaeufer, iban: e.iban, bic: e.bic, kontoinhaber: e.kontoinhaber }).filter(([, v]) => v)));
      await db.setzeEinstellung('profil', zustand.profil);
      profilFuellen();
    }
    const fall = e.positionen[0]?.steuerfall || zustand.profil.steuerfall;
    const k = e.kaeufer;
    formularFuellen({
      'k.name': k.name, 'k.strasse': k.strasse, 'k.zusatz': k.zusatz, 'k.plz': k.plz, 'k.ort': k.ort, 'k.land': k.land, 'k.email': k.email, 'k.ustId': k.ustId,
      kaeuferreferenz: e.kaeuferreferenz, bestellnummer: e.bestellnummer, steuerfall: fall,
      hinweisText: e.hinweise.join('\n'), positionen: e.positionen,
    });
    const vorhanden = zustand.kunden.find((x) => x.name === k.name);
    if (vorhanden) $('#kunde-auswahl').value = vorhanden.id;
    zeigeTab('rechnung');
    meldung(`Rechnung ${e.nummer || ''} als Vorlage geladen. Nummer und Datum sind neu gesetzt.`);
  } catch (err) {
    meldung(`Einlesen fehlgeschlagen: ${err.message}`, 6000);
  }
}

// ---------------- Rechnungsliste ----------------
function status(r) {
  const bezahlt = (r.zahlungen || []).reduce((s, z) => s + cent(z.betrag), 0n);
  if (bezahlt >= cent(r.brutto)) return { key: 'bezahlt', text: `bezahlt ${datumDe(r.zahlungen.at(-1).datum)}`, bezahlt };
  if (r.faelligAm && r.faelligAm < heute()) return { key: 'ueberfaellig', text: bezahlt > 0n ? 'teilbezahlt, überfällig' : 'überfällig', bezahlt };
  return { key: 'offen', text: bezahlt > 0n ? 'teilbezahlt' : 'offen', bezahlt };
}

function zeichneListe() {
  const jahre = [...new Set(zustand.rechnungen.map((r) => r.datum.slice(0, 4)))].sort().reverse();
  const selJ = $('#filter-jahr');
  const alt = selJ.value;
  selJ.innerHTML = '<option value="">alle Jahre</option>' + jahre.map((j) => `<option>${j}</option>`).join('');
  selJ.value = jahre.includes(alt) ? alt : (jahre[0] || '');
  const jahr = selJ.value, st = $('#filter-status').value;
  const liste = zustand.rechnungen.filter((r) => (!jahr || r.datum.startsWith(jahr)) && (!st || status(r).key === st));

  const imJahr = zustand.rechnungen.filter((r) => !jahr || r.datum.startsWith(jahr));
  let offen = 0n, ueber = 0n, umsatz = 0n, eingang = 0n;
  for (const r of zustand.rechnungen) {
    const s = status(r);
    if (s.key !== 'bezahlt') { offen += cent(r.brutto) - s.bezahlt; if (s.key === 'ueberfaellig') ueber += cent(r.brutto) - s.bezahlt; }
    for (const z of r.zahlungen || []) if (!jahr || z.datum.startsWith(jahr)) eingang += cent(z.betrag);
  }
  for (const r of imJahr) umsatz += cent(r.brutto);
  $('#kennzahlen').innerHTML = [
    ['Offen (alle Jahre)', euro(offen)], ['davon überfällig', euro(ueber)],
    [`Rechnungsbetrag ${jahr || 'gesamt'}`, euro(umsatz)], [`Zahlungseingang ${jahr || 'gesamt'}`, euro(eingang)],
  ].map(([l, w]) => `<div class="kennzahl"><span>${l}</span><strong>${w}</strong></div>`).join('');

  $('#liste-leer').hidden = zustand.rechnungen.length > 0;
  $('#tabelle-rechnungen').innerHTML = liste.length ? `<thead><tr><th>Nr.</th><th>Datum</th><th>Kunde</th><th class="zahl">Betrag</th><th>Fällig</th><th>Status</th><th></th></tr></thead><tbody>` +
    liste.map((r) => {
      const s = status(r);
      return `<tr data-id="${esc(r.id)}">
        <td><strong>${esc(r.nummer)}</strong><br><span class="marke-format">${r.format === 'zugferd' ? 'E-Rechnung' : 'PDF'}</span></td>
        <td>${datumDe(r.datum)}</td><td>${esc(r.kunde)}</td><td class="zahl">${euro(cent(r.brutto))}</td>
        <td>${datumDe(r.faelligAm) || '–'}</td><td><span class="marke-status ${s.key}">${esc(s.text)}</span></td>
        <td class="aktionen">
          <button class="knopf-klein" data-aktion="pdf">PDF</button>
          ${r.xml ? '<button class="knopf-klein" data-aktion="xml">XML</button>' : ''}
          ${s.key !== 'bezahlt' ? '<button class="knopf-klein" data-aktion="zahlung">Zahlung</button>' : '<button class="knopf-klein" data-aktion="zahlung-weg" title="Zahlungen zurücksetzen">↺</button>'}
          <button class="knopf-klein" data-aktion="vorlage" title="Als Vorlage für eine neue Rechnung">Kopie</button>
          <button class="knopf-klein gefahr" data-aktion="loeschen" title="Löschen">✕</button>
        </td></tr>`;
    }).join('') + '</tbody>' : '';
}

async function listenAktion(aktion, id) {
  const r = zustand.rechnungen.find((x) => x.id === id);
  if (!r) return;
  if (aktion === 'pdf') herunterladen(new Blob([r.pdf], { type: 'application/pdf' }), dateiname(r.nummer, 'pdf'));
  if (aktion === 'xml') herunterladen(r.xml, dateiname(r.nummer, 'xml'), 'application/xml');
  if (aktion === 'zahlung') {
    const d = $('#dialog-zahlung');
    const offen = cent(r.brutto) - status(r).bezahlt;
    $('#zahlung-info').textContent = `Rechnung ${r.nummer} · ${r.kunde} · offen ${euro(offen)}`;
    formSetzen($('#form-zahlung'), { datum: heute(), betrag: centText(offen).replace('.', ',') });
    d.returnValue = '';
    d.showModal();
    d.onclose = async () => {
      if (d.returnValue !== 'ok') return;
      const w = formWerte($('#form-zahlung'));
      const b = dez(w.betrag);
      if (typeof b !== 'bigint' || !w.datum) { meldung('Bitte Datum und Betrag angeben.'); return; }
      r.zahlungen = [...(r.zahlungen || []), { datum: w.datum, betrag: centText(b / 100n) }];
      await db.speichere('rechnungen', r);
      zeichneListe();
      meldung(`Zahlung zu ${r.nummer} erfasst.`);
    };
  }
  if (aktion === 'zahlung-weg' && confirm(`Erfasste Zahlungen zu Rechnung ${r.nummer} zurücksetzen?`)) {
    r.zahlungen = []; await db.speichere('rechnungen', r); zeichneListe();
  }
  if (aktion === 'vorlage') {
    const d = r.daten, k = d.kaeufer;
    formularFuellen({
      'k.name': k.name, 'k.strasse': k.strasse, 'k.zusatz': k.zusatz, 'k.plz': k.plz, 'k.ort': k.ort, 'k.land': k.land, 'k.email': k.email, 'k.ustId': k.ustId,
      kundeId: r.kundeId || '', kaeuferreferenz: d.kaeuferreferenz, bestellnummer: '', steuerfall: r.steuerfall || d.positionen[0]?.steuerfall,
      zielTage: d.zielTage, anschreiben: d.anschreiben, hinweisText: (d.hinweise || []).join('\n'), schlusstext: d.schlusstext,
      positionen: d.positionen, format: r.format,
    });
    zeigeTab('rechnung');
    meldung(`Kopie von ${r.nummer} angelegt. Bitte Leistungsdatum prüfen.`);
  }
  if (aktion === 'loeschen' && confirm(`Rechnung ${r.nummer} endgültig aus der Liste löschen?\n\nVersendete Rechnungen müssen Sie 8 Jahre aufbewahren. Laden Sie die PDF vorher herunter, falls Sie sie nicht anderweitig gespeichert haben.`)) {
    await db.loesche('rechnungen', r.id); await laden(); zeichneListe();
  }
}

// ---------------- Kunden ----------------
const formK = $('#form-kunde');
let kundeBearbeitet = null;

function zeichneKunden() {
  $('#kunden-leer').hidden = zustand.kunden.length > 0;
  $('#tabelle-kunden').innerHTML = zustand.kunden.length ? '<thead><tr><th>Name</th><th>Ort</th><th>E-Mail Rechnungseingang</th><th class="zahl">Rechnungen</th><th class="zahl">Summe</th></tr></thead><tbody>' +
    zustand.kunden.map((k) => {
      const rs = zustand.rechnungen.filter((r) => r.kundeId === k.id);
      const summe = rs.reduce((s, r) => s + cent(r.brutto), 0n);
      return `<tr class="waehlbar" data-id="${esc(k.id)}"><td><strong>${esc(k.name)}</strong></td><td>${esc([k.plz, k.ort].filter(Boolean).join(' '))}${k.land && k.land !== 'DE' ? ' (' + esc(k.land) + ')' : ''}</td>
        <td>${k.email ? esc(k.email) : '<span class="klein">fehlt</span>'}</td><td class="zahl">${rs.length}</td><td class="zahl">${euro(summe)}</td></tr>`;
    }).join('') + '</tbody>' : '';
}

function kundeBearbeiten(k) {
  kundeBearbeitet = k;
  formK.hidden = false;
  formK.reset();
  formSetzen(formK, k || { land: 'DE' });
  $('#kunde-form-titel').textContent = k ? k.name : 'Neuer Kunde';
  $('#kunde-loeschen').hidden = !k;
  $('#kunde-rechnung').hidden = !k;
  formK.name.focus();
}

// ---------------- Meine Daten ----------------
const formP = $('#form-profil');

function profilFuellen() {
  formSetzen(formP, zustand.profil);
  const lv = $('#logo-vorschau');
  if (zustand.profil.logo) {
    lv.src = `data:image/${zustand.profil.logo.typ === 'png' ? 'png' : 'jpeg'};base64,${zustand.profil.logo.daten}`;
    lv.hidden = false; $('#logo-entfernen').hidden = false;
  } else { lv.hidden = true; $('#logo-entfernen').hidden = true; }
}

// Meine Daten werden bei jeder Eingabe gespeichert, damit Profil-Datei und Sicherung
// immer den aktuellen Stand enthalten. Ungültige Angaben werden markiert, aber nicht verworfen.
async function profilUebernehmen() {
  const w = formWerte(formP);
  formP.iban.toggleAttribute('aria-invalid', !!w.iban && !ibanGueltig(w.iban));
  formP.email.toggleAttribute('aria-invalid', !!w.email && !emailGueltig(w.email));
  if (formP.iban.hasAttribute('aria-invalid')) formP.iban.setAttribute('aria-invalid', 'true');
  if (formP.email.hasAttribute('aria-invalid')) formP.email.setAttribute('aria-invalid', 'true');
  zustand.profil = { ...zustand.profil, ...w, iban: w.iban.replace(/\s/g, '').toUpperCase() };
  await db.setzeEinstellung('profil', zustand.profil);
  if (!formR.nummer.value || formR.nummer.value === formR.nummer.dataset.vorschlag) {
    formR.nummer.value = nummerVorschlag();
    formR.nummer.dataset.vorschlag = formR.nummer.value;
  }
}

let profilTimer;
function profilAutomatisch() {
  clearTimeout(profilTimer);
  profilTimer = setTimeout(profilUebernehmen, 400);
}

async function profilSpeichern() {
  clearTimeout(profilTimer);
  await profilUebernehmen();
  const w = formWerte(formP);
  if (w.iban && !ibanGueltig(w.iban)) { meldung('Gespeichert, aber die IBAN ist ungültig. Bitte prüfen.'); return; }
  if (w.email && !emailGueltig(w.email)) { meldung('Gespeichert, aber die E-Mail-Adresse ist ungültig.'); return; }
  meldung('Meine Daten gespeichert.');
}

async function letzteSicherungAnzeigen() {
  const d = await db.einstellung('letzteSicherung');
  $('#letzte-sicherung').textContent = d ? `Letzte Sicherung: ${datumDe(d.slice(0, 10))}` : 'Noch keine Sicherung erstellt.';
  const tage = d ? (Date.now() - new Date(d)) / 864e5 : Infinity;
  const banner = $('#banner');
  if (zustand.rechnungen.length && tage > 30) {
    banner.hidden = false;
    banner.innerHTML = `Ihre Rechnungen liegen nur in diesem Browser${d ? ` und wurden seit ${Math.floor(tage)} Tagen nicht gesichert` : ' und wurden noch nie gesichert'}. <a href="#profil" data-tab-link="profil">Jetzt sichern</a>`;
  } else banner.hidden = true;
}

// ---------------- Start ----------------
async function start() {
  await laden();
  if (db.istFluechtig()) {
    $('#banner').hidden = false;
    $('#banner').textContent = 'Dieser Browser erlaubt keine dauerhafte Speicherung. Ihre Eingaben gehen beim Schließen verloren.';
  }
  kundenAuswahlFuellen();
  profilFuellen();
  const entwurf = await db.einstellung('entwurf');
  formularFuellen(entwurf || {});
  formR.nummer.dataset.vorschlag = nummerVorschlag();

  // Ereignisse
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => zeigeTab(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const l = e.target.closest('[data-tab-link]');
    if (l) { e.preventDefault(); zeigeTab(l.dataset.tabLink); }
  });
  formR.addEventListener('input', aktualisiere);
  formR.addEventListener('change', aktualisiere);
  $$('input[name=format]').forEach((r) => r.addEventListener('change', () => { $('#pruefliste').innerHTML = ''; entwurfSpeichern(); }));
  $('#position-neu').addEventListener('click', () => {
    const z = positionZeile({});
    $('#positionen').append(z); nummeriere(); aktualisiere(); $('[name=bezeichnung]', z).focus();
  });
  $('#kunde-auswahl').addEventListener('change', (e) => {
    const k = zustand.kunden.find((x) => x.id === e.target.value);
    if (k) kundeInFormular(k);
    else formSetzen(formR, { 'k.name': '', 'k.strasse': '', 'k.zusatz': '', 'k.plz': '', 'k.ort': '', 'k.land': 'DE', 'k.email': '', 'k.ustId': '', kaeuferreferenz: '' });
  });
  $('#erstellen').addEventListener('click', erstellen);
  $('#nur-xml').addEventListener('click', nurXml);
  $('#formular-leeren').addEventListener('click', async () => {
    if (!confirm('Formular leeren? Der Entwurf geht verloren.')) return;
    await db.setzeEinstellung('entwurf', null);
    formularFuellen({});
  });
  $('#import-xml').addEventListener('change', (e) => { if (e.target.files[0]) xmlImportieren(e.target.files[0]); e.target.value = ''; });

  $('#filter-jahr').addEventListener('change', zeichneListe);
  $('#filter-status').addEventListener('change', zeichneListe);
  $('#tabelle-rechnungen').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aktion]');
    if (b) listenAktion(b.dataset.aktion, b.closest('tr').dataset.id);
  });

  $('#kunde-neu').addEventListener('click', () => kundeBearbeiten(null));
  $('#tabelle-kunden').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) kundeBearbeiten(zustand.kunden.find((k) => k.id === tr.dataset.id));
  });
  formK.addEventListener('submit', async (e) => {
    e.preventDefault();
    const w = formWerte(formK);
    if (!w.name) { meldung('Bitte einen Namen angeben.'); return; }
    if (w.email && !emailGueltig(w.email)) { meldung('Die E-Mail-Adresse ist ungültig.'); return; }
    const k = { ...(kundeBearbeitet || { id: db.neueId(), erstellt: new Date().toISOString() }), ...w, land: (w.land || 'DE').toUpperCase() };
    await db.speichere('kunden', k);
    await laden(); kundenAuswahlFuellen(); zeichneKunden(); kundeBearbeiten(k);
    meldung('Kunde gespeichert.');
  });
  $('#kunde-loeschen').addEventListener('click', async () => {
    if (!kundeBearbeitet || !confirm(`${kundeBearbeitet.name} aus der Kundenliste löschen? Bestehende Rechnungen bleiben erhalten.`)) return;
    await db.loesche('kunden', kundeBearbeitet.id);
    await laden(); kundenAuswahlFuellen(); zeichneKunden(); formK.hidden = true;
  });
  $('#kunde-rechnung').addEventListener('click', () => {
    if (!kundeBearbeitet) return;
    $('#kunde-auswahl').value = kundeBearbeitet.id;
    kundeInFormular(kundeBearbeitet);
    zeigeTab('rechnung');
  });

  formP.addEventListener('submit', (e) => { e.preventDefault(); profilSpeichern(); });
  formP.addEventListener('input', profilAutomatisch);
  formP.addEventListener('change', profilAutomatisch);
  $('#logo-datei').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 1.5e6) { meldung('Das Logo ist größer als 1,5 MB. Bitte eine kleinere Datei wählen.'); return; }
    const typ = f.type === 'image/png' ? 'png' : 'jpg';
    const bytes = new Uint8Array(await f.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    zustand.profil.logo = { typ, daten: btoa(s) };
    await db.setzeEinstellung('profil', zustand.profil);
    profilFuellen(); meldung('Logo gespeichert.');
  });
  $('#logo-entfernen').addEventListener('click', async () => {
    delete zustand.profil.logo; await db.setzeEinstellung('profil', zustand.profil); profilFuellen();
  });
  $('#profil-export').addEventListener('click', async () => {
    clearTimeout(profilTimer); await profilUebernehmen();
    herunterladen(JSON.stringify({ format: 'e-rechnung-de-profil', version: 1, profil: zustand.profil }, null, 1), 'meine-rechnungsdaten.json', 'application/json');
  });
  $('#profil-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.format !== 'e-rechnung-de-profil') throw new Error('Das ist keine Profil-Datei dieses Werkzeugs.');
      zustand.profil = { ...STANDARD_PROFIL, ...d.profil };
      await db.setzeEinstellung('profil', zustand.profil);
      profilFuellen(); meldung('Profil geladen.');
    } catch (err) { meldung(err.message, 6000); }
  });
  $('#sicherung-export').addEventListener('click', async () => {
    clearTimeout(profilTimer); await profilUebernehmen();
    clearTimeout(entwurfTimer); await entwurfSpeichern();
    herunterladen(await db.sicherungErstellen(), `e-rechnung-sicherung-${heute()}.json`, 'application/json');
    await db.setzeEinstellung('letzteSicherung', new Date().toISOString());
    letzteSicherungAnzeigen();
  });
  $('#sicherung-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const ersetzen = confirm('Sicherung einspielen.\n\nOK: Alle Daten in diesem Browser durch die Sicherung ersetzen.\nAbbrechen: Sicherung zu den vorhandenen Daten hinzufügen.');
    try {
      await db.sicherungEinspielen(await f.text(), { ersetzen });
      await laden(); kundenAuswahlFuellen(); profilFuellen(); formularFuellen((await db.einstellung('entwurf')) || {});
      meldung('Sicherung eingespielt.');
    } catch (err) { meldung(err.message, 6000); }
  });
  $('#alles-loeschen').addEventListener('click', async () => {
    if (!confirm('Wirklich ALLE Daten (Meine Daten, Kunden, Rechnungen) in diesem Browser löschen?')) return;
    if (!confirm('Letzte Rückfrage: Das lässt sich nicht rückgängig machen. Haben Sie eine Sicherung?')) return;
    for (const s of ['einstellungen', 'kunden', 'rechnungen']) await db.leere(s);
    location.reload();
  });

  await letzteSicherungAnzeigen();
  const start = location.hash.slice(1);
  zeigeTab(['rechnung', 'liste', 'kunden', 'profil'].includes(start) ? start : (zustand.profil.name ? 'rechnung' : 'profil'));
  if (!zustand.profil.name) meldung('Willkommen! Tragen Sie zuerst Ihre eigenen Daten ein.', 5000);
}

start();
