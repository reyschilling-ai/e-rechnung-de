// Lokaler Speicher im Browser (IndexedDB). Fällt auf einen flüchtigen Speicher zurück,
// wenn IndexedDB nicht verfügbar ist (z. B. in manchen privaten Fenstern).

const DB_NAME = 'e-rechnung-de';
const DB_VERSION = 2;
const STORES = ['einstellungen', 'kunden', 'rechnungen', 'protokoll'];

let dbPromise = null;
let fluechtig = null;

export function istFluechtig() { return fluechtig !== null; }

function oeffnen() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { fluechtig = Object.fromEntries(STORES.map((s) => [s, new Map()])); resolve(null); };
    } catch {
      fluechtig = Object.fromEntries(STORES.map((s) => [s, new Map()]));
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx(store, modus, fn) {
  const db = await oeffnen();
  if (!db) return fn(null, fluechtig[store]);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, modus);
    const os = t.objectStore(store);
    let ergebnis;
    Promise.resolve(fn(os, null)).then((r) => { ergebnis = r; });
    t.oncomplete = () => resolve(ergebnis);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const alle = (store) => tx(store, 'readonly', (os, mem) => (mem ? [...mem.values()] : req(os.getAll())));
export const hole = (store, id) => tx(store, 'readonly', (os, mem) => (mem ? mem.get(id) : req(os.get(id))));
export const speichere = (store, obj) => tx(store, 'readwrite', (os, mem) => (mem ? mem.set(obj.id, obj) : req(os.put(obj))));
export const loesche = (store, id) => tx(store, 'readwrite', (os, mem) => (mem ? mem.delete(id) : req(os.delete(id))));
export const leere = (store) => tx(store, 'readwrite', (os, mem) => (mem ? mem.clear() : req(os.clear())));

export async function einstellung(id, standard = null) {
  const e = await hole('einstellungen', id);
  return e ? e.wert : standard;
}
export const setzeEinstellung = (id, wert) => speichere('einstellungen', { id, wert });

export function neueId() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

// ---------- Sicherung ----------
function b64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function ausB64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export async function sicherungErstellen() {
  const daten = { format: 'e-rechnung-de-sicherung', version: 1, erstellt: new Date().toISOString() };
  for (const s of STORES) {
    daten[s] = (await alle(s)).map((o) => (o.pdf ? { ...o, pdf: b64(o.pdf) } : o));
  }
  return JSON.stringify(daten, null, 1);
}

export async function sicherungEinspielen(text, { ersetzen }) {
  const d = JSON.parse(text);
  if (d.format !== 'e-rechnung-de-sicherung') throw new Error('Das ist keine Sicherungsdatei dieses Werkzeugs.');
  for (const s of STORES) {
    if (ersetzen) await leere(s);
    for (const o of d[s] || []) await speichere(s, o.pdf ? { ...o, pdf: ausB64(o.pdf) } : o);
  }
}
