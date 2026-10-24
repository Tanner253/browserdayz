import type { World } from './worldgen';
import { looksWhole } from './world-file';

// One generator version is kept, off the main thread. Storage trouble must never prevent generation.
const DATABASE = 'zona-world', STORE = 'cache', SLOT = 'current', WAIT_MS = 250;
type Entry = { key: string; world: World };

function open(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (database?: IDBDatabase) => {
      if (settled) { database?.close(); return; }
      settled = true; clearTimeout(timer); resolve(database);
    };
    const timer = setTimeout(() => finish(), WAIT_MS);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        } catch {
          try { request.transaction?.abort(); } catch {}
          finish();
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        finish(database);
      };
      request.onerror = request.onblocked = () => finish();
    } catch { finish(); }
  });
}

function read(database: IDBDatabase): Promise<Entry | undefined> {
  return new Promise((resolve) => {
    let transaction: IDBTransaction | undefined, settled = false;
    const finish = (entry?: Entry) => { if (!settled) { settled = true; clearTimeout(timer); resolve(entry); } };
    const timer = setTimeout(() => { finish(); try { transaction?.abort(); } catch {} }, WAIT_MS);
    try {
      transaction = database.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(SLOT);
      request.onsuccess = () => finish(request.result as Entry | undefined);
      request.onerror = transaction.onabort = transaction.onerror = () => finish();
    } catch { finish(); }
  });
}

function write(database: IDBDatabase, entry: Entry): Promise<void> {
  return new Promise((resolve) => {
    let transaction: IDBTransaction | undefined, settled = false;
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => { finish(); try { transaction?.abort(); } catch {} }, WAIT_MS);
    try {
      transaction = database.transaction(STORE, 'readwrite');
      transaction.oncomplete = transaction.onabort = transaction.onerror = finish;
      transaction.objectStore(STORE).put(entry, SLOT);
    } catch { finish(); }
  });
}

export async function cachedWorld(key: string | undefined, generate: () => World): Promise<World> {
  if (!key) return generate();
  const database = await open();
  if (!database) return generate();
  try {
    const entry = await read(database), world = entry?.world;
    if (entry?.key === key && looksWhole(world)) return world;
    const fresh = generate();
    // Complete the write before the worker transfers and detaches the original typed-array storage.
    await write(database, { key, world: fresh });
    return fresh;
  } finally { database.close(); }
}
