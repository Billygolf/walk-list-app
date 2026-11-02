// Everything is stored on this device in IndexedDB. Nothing is sent anywhere.
const DB = 'walk-lists', VER = 1;
let dbp;

function open() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('packs');     // key: pack title
      r.result.createObjectStore('results');   // key: "title|T1|7"
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export const getAll = async (store) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store), s = t.objectStore(store), out = {};
    const c = s.openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } else res(out); };
    c.onerror = () => rej(c.error);
  });
};
export const put = (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key));
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const putMany = (store, entries) => tx(store, 'readwrite', (s) => { for (const [k, v] of entries) s.put(v, k); });

export const resultKey = (pack, turf, n) => `${pack}|${turf}|${n}`;
