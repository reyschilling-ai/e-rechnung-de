// Minimaler ZIP-Schreiber (ohne Kompression) und -Leser (gespeichert oder deflate).

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABELLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosZeit(d) {
  const zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const datum = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { zeit, datum };
}

// dateien: [{ name, daten: Uint8Array | string }]
export function zipErstellen(dateien, jetzt = new Date()) {
  const enc = new TextEncoder();
  const teile = [];
  const zentral = [];
  let offset = 0;
  const { zeit, datum } = dosZeit(jetzt);
  for (const d of dateien) {
    const name = enc.encode(d.name);
    const daten = typeof d.daten === 'string' ? enc.encode(d.daten) : d.daten;
    const crc = crc32(daten);
    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true);
    lokal.setUint16(4, 20, true);
    lokal.setUint16(6, 0x0800, true); // UTF-8-Dateinamen
    lokal.setUint16(8, 0, true);
    lokal.setUint16(10, zeit, true);
    lokal.setUint16(12, datum, true);
    lokal.setUint32(14, crc, true);
    lokal.setUint32(18, daten.length, true);
    lokal.setUint32(22, daten.length, true);
    lokal.setUint16(26, name.length, true);
    lokal.setUint16(28, 0, true);
    teile.push(new Uint8Array(lokal.buffer), name, daten);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true);
    z.setUint16(4, 20, true);
    z.setUint16(6, 20, true);
    z.setUint16(8, 0x0800, true);
    z.setUint16(10, 0, true);
    z.setUint16(12, zeit, true);
    z.setUint16(14, datum, true);
    z.setUint32(16, crc, true);
    z.setUint32(20, daten.length, true);
    z.setUint32(24, daten.length, true);
    z.setUint16(28, name.length, true);
    z.setUint32(42, offset, true);
    zentral.push(new Uint8Array(z.buffer), name);
    offset += 30 + name.length + daten.length;
  }
  const zentralLaenge = zentral.reduce((s, t) => s + t.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, dateien.length, true);
  ende.setUint16(10, dateien.length, true);
  ende.setUint32(12, zentralLaenge, true);
  ende.setUint32(16, offset, true);
  const alle = [...teile, ...zentral, new Uint8Array(ende.buffer)];
  const ergebnis = new Uint8Array(alle.reduce((s, t) => s + t.length, 0));
  let pos = 0;
  for (const t of alle) { ergebnis.set(t, pos); pos += t.length; }
  return ergebnis;
}

async function inflate(daten) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([daten]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Liest ein ZIP über das zentrale Verzeichnis. Liefert Map name -> Uint8Array.
export async function zipLesen(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
  const anzahl = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const dateien = new Map();
  for (let i = 0; i < anzahl; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
    const methode = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const groesse = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), kommLen = v.getUint16(p + 32, true);
    const lokalOffset = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = v.getUint16(lokalOffset + 26, true), lExtraLen = v.getUint16(lokalOffset + 28, true);
    const start = lokalOffset + 30 + lNameLen + lExtraLen;
    const roh = bytes.subarray(start, start + groesse);
    let daten;
    if (methode === 0) daten = roh;
    else if (methode === 8) daten = await inflate(roh);
    else throw new Error(`Kompressionsart ${methode} wird nicht unterstützt (${name})`);
    if (!name.endsWith('/')) {
      if (crc32(daten) !== crc) throw new Error(`Datei ${name} im ZIP ist beschädigt (CRC)`);
      dateien.set(name, daten);
    }
    p += 46 + nameLen + extraLen + kommLen;
  }
  return dateien;
}
