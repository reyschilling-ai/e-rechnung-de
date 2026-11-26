// Änderungsprotokoll mit SHA-256-Prüfsummenkette.
// Jeder Eintrag enthält die Prüfsumme des vorherigen. Wird ein Eintrag nachträglich verändert,
// gelöscht oder eingeschoben, passt die Kette nicht mehr. Das verhindert keine Manipulation,
// macht sie aber nachweisbar.

export const NULL_HASH = '0'.repeat(64);

export async function sha256(daten) {
  const bytes = typeof daten === 'string' ? new TextEncoder().encode(daten) : daten;
  const h = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// JSON mit sortierten Schlüsseln, damit die Prüfsumme nicht von der Reihenfolge abhängt
export function kanonisch(wert) {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(',')}]`;
  if (wert && typeof wert === 'object') {
    return `{${Object.keys(wert).filter((k) => wert[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${kanonisch(wert[k])}`).join(',')}}`;
  }
  return JSON.stringify(wert ?? null);
}

export async function eintragBerechnen(vorheriger, aktion, daten, zeit = new Date().toISOString()) {
  const nr = vorheriger ? vorheriger.nr + 1 : 1;
  const kern = { nr, zeit, aktion, daten, vorher: vorheriger ? vorheriger.hash : NULL_HASH };
  return { id: String(nr).padStart(10, '0'), ...kern, hash: await sha256(kanonisch(kern)) };
}

export async function kettePruefen(eintraege) {
  const fehler = [];
  const liste = [...eintraege].sort((a, b) => a.nr - b.nr);
  let vorher = NULL_HASH;
  for (let i = 0; i < liste.length; i++) {
    const e = liste[i];
    if (e.nr !== i + 1) fehler.push(`Eintrag ${i + 1} fehlt oder ist doppelt (gefunden: ${e.nr})`);
    if (e.vorher !== vorher) fehler.push(`Eintrag ${e.nr}: Verweis auf den vorherigen Eintrag stimmt nicht`);
    const soll = await sha256(kanonisch({ nr: e.nr, zeit: e.zeit, aktion: e.aktion, daten: e.daten, vorher: e.vorher }));
    if (soll !== e.hash) fehler.push(`Eintrag ${e.nr} (${e.aktion}) wurde nachträglich verändert`);
    vorher = e.hash;
  }
  return { ok: fehler.length === 0, anzahl: liste.length, letzterHash: vorher, fehler };
}

// Lücken in fortlaufenden Rechnungsnummern (gleiches Präfix, Zahl am Ende)
export function nummernluecken(nummern) {
  const gruppen = new Map();
  for (const n of nummern) {
    const m = /^(.*?)(\d+)$/.exec(n);
    if (!m) continue;
    if (!gruppen.has(m[1])) gruppen.set(m[1], []);
    gruppen.get(m[1]).push({ zahl: Number(m[2]), stellen: m[2].length });
  }
  const luecken = [];
  for (const [praefix, werte] of gruppen) {
    const zahlen = [...new Set(werte.map((w) => w.zahl))].sort((a, b) => a - b);
    const stellen = werte[0].stellen;
    for (let i = 1; i < zahlen.length; i++) {
      for (let z = zahlen[i - 1] + 1; z < zahlen[i] && luecken.length < 50; z++) luecken.push(`${praefix}${String(z).padStart(stellen, '0')}`);
    }
  }
  return luecken;
}
