// Minimal IndexedDB wrapper. All app data lives on the device.
const DB_NAME = 'lift-log';
const VERSION = 1;
export const STORES = ['kv', 'locations', 'exercises', 'templates', 'sessions'];

let dbp;
function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    const r = fn(t);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAll = (store) => tx([store], 'readonly', (t) => t.objectStore(store).getAll());
export const put = (store, obj) => tx([store], 'readwrite', (t) => t.objectStore(store).put(obj));
export const del = (store, id) => tx([store], 'readwrite', (t) => t.objectStore(store).delete(id));

export async function dumpAll() {
  const out = {};
  for (const s of STORES) out[s] = await getAll(s);
  return out;
}

/** Replace everything with the contents of a backup. */
export async function restoreAll(data) {
  await tx(STORES, 'readwrite', (t) => {
    for (const s of STORES) {
      const os = t.objectStore(s);
      os.clear();
      for (const row of data[s] || []) os.put(row);
    }
  });
}
