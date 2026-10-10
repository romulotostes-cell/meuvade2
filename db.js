const NAME = 'vade-mecum-db';
const VERSION = 1;
let openPromise;
function database() {
  if (!openPromise) openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('laws')) db.createObjectStore('laws', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('lawId', 'lawId');
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return openPromise;
}
function transact(store, mode, callback) {
  return database().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = callback(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error || req?.error);
    tx.onabort = () => reject(tx.error || new Error('Operação cancelada'));
  }));
}
export const DB = {
  all: store => transact(store, 'readonly', s => s.getAll()),
  get: (store, id) => transact(store, 'readonly', s => s.get(id)),
  put: (store, value) => transact(store, 'readwrite', s => s.put(value)),
  del: (store, id) => transact(store, 'readwrite', s => s.delete(id)),
  clear: store => transact(store, 'readwrite', s => s.clear())
};
