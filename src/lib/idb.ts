// Browser cache in IndexedDB: each repo's last download and its personas, so a repeat visit in the same browser
// is instant. Every call is wrapped: a private window, blocked storage or a full quota just means "not cached".
const DB = 'tavern';
const STORE = 'kv';
const KEEP = 12; // repos; the oldest is dropped with everything stored under it

let db: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  return (db ??= new Promise((resolve) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (d) =>
      new Promise((resolve) => {
        if (!d) return resolve(undefined);
        try {
          const q = f(d.transaction(STORE, mode).objectStore(STORE));
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const idbGet = <T>(key: string) => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);

/** Stores `value` under `key`, filed under `group` (a repo) for eviction. */
export async function idbSet(group: string, key: string, value: unknown): Promise<void> {
  await run('readwrite', (s) => s.put(value, key));
  const index = (await idbGet<{ group: string; keys: string[] }[]>('index')) ?? [];
  const mine = { group, keys: [...new Set([...(index.find((e) => e.group === group)?.keys ?? []), key])] };
  const next = [...index.filter((e) => e.group !== group), mine]; // most recently used last
  for (const old of next.splice(0, Math.max(0, next.length - KEEP))) for (const k of old.keys) await run('readwrite', (s) => s.delete(k));
  await run('readwrite', (s) => s.put(next, 'index'));
}
