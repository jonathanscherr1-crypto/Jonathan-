/* ============================================================
   storage.js — IndexedDB persistence for notebooks
   ============================================================ */
const DB_NAME = "inkwell";
const DB_VERSION = 1;
const STORE = "notebooks";

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("updated", "updated");
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

export const Storage = {
  async all() {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const out = [];
      const cur = store.openCursor();
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { out.push(c.value); c.continue(); }
        else resolve(out);
      };
      cur.onerror = () => reject(cur.error);
    });
  },

  async get(id) {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  async put(nb) {
    nb.updated = Date.now();
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const r = store.put(nb);
      r.onsuccess = () => resolve(nb);
      r.onerror = () => reject(r.error);
    });
  },

  async remove(id) {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const r = store.delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
