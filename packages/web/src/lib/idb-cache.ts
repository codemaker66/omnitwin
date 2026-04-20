// ---------------------------------------------------------------------------
// idb-cache — tiny typed key/value cache backed by IndexedDB.
//
// Built for the offline hallkeeper tablet, where we need to:
//
//   - Store the /v2 JSON payload for the current config so the sheet
//     renders instantly on next mount even when the WiFi dropped.
//   - Queue progress PATCH calls that failed because the tablet was
//     offline, then flush them on reconnect.
//
// We deliberately avoid a larger IDB wrapper (idb, dexie) to stay
// zero-dep. The surface is:
//
//   - `openCache<T>(name, store)` — returns a typed handle.
//   - `handle.put(key, value)`   — upsert.
//   - `handle.get(key)`          — returns StoredValue<T> | null.
//   - `handle.delete(key)`       — idempotent.
//   - `handle.list()`            — iterate all keys (sync queue).
//
// `StoredValue<T>` wraps the payload with a `storedAt` ISO-8601 string
// so a TTL-aware consumer can decide whether to serve stale or fetch.
//
// STORAGE BACKEND INJECTION
// --------------------------
// Tests instantiate with an in-memory Map-backed backend; production
// uses IndexedDB. Both implement the `CacheBackend` interface. This
// keeps `idb-cache` pure-logic testable without `fake-indexeddb`.
// ---------------------------------------------------------------------------

export interface StoredValue<T> {
  readonly storedAt: string;
  readonly value: T;
}

export interface CacheBackend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ key: string; value: unknown }[]>;
}

export interface CacheHandle<T> {
  get(key: string): Promise<StoredValue<T> | null>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ key: string; stored: StoredValue<T> }[]>;
}

/**
 * In-memory backend — used by tests and as a fallback when IndexedDB
 * is unavailable (SSR, Safari private mode). Backend is a plain Map;
 * no persistence across page reloads.
 */
export function memoryBackend(): CacheBackend {
  const store = new Map<string, unknown>();
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async get(key) {
      return store.get(key) ?? null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async put(key, value) {
      store.set(key, value);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(key) {
      store.delete(key);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async list() {
      return Array.from(store.entries()).map(([key, value]) => ({ key, value }));
    },
  };
}

/**
 * IndexedDB backend — production default. Opens a single database
 * per `dbName`; each cache handle maps to an object store inside it.
 * Requests are wrapped in Promises.
 */
function idbBackend(dbName: string, storeName: string): CacheBackend {
  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? new Error("indexedDB open failed"));
      };
    });
  }

  async function tx<R>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    const db = await openDb();
    return new Promise<R>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const req = op(store);
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? new Error("indexedDB op failed"));
      };
    });
  }

  return {
    async get(key) {
      return await tx("readonly", (s) => s.get(key) as IDBRequest<unknown>);
    },
    async put(key, value) {
      await tx("readwrite", (s) => s.put(value, key));
    },
    async delete(key) {
      await tx("readwrite", (s) => s.delete(key));
    },
    async list() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const results: { key: string; value: unknown }[] = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor === null) {
            resolve(results);
            return;
          }
          // IDBValidKey is `string | number | Date | BufferSource | Array<IDBValidKey>`.
          // Our keys are always strings (see put() above), so a runtime
          // check + cast is safe; non-string keys are filtered out.
          const k = cursor.key;
          if (typeof k === "string") {
            results.push({ key: k, value: cursor.value as unknown });
          }
          cursor.continue();
        };
        req.onerror = () => {
          reject(req.error ?? new Error("indexedDB cursor failed"));
        };
      });
    },
  };
}

/**
 * Open a typed cache. In a browser with IndexedDB, uses IDB; falls
 * back to in-memory when unavailable (SSR, Safari private mode).
 */
export function openCache<T>(opts: {
  readonly dbName: string;
  readonly storeName: string;
}): CacheHandle<T> {
  const backend: CacheBackend = typeof indexedDB === "undefined"
    ? memoryBackend()
    : idbBackend(opts.dbName, opts.storeName);

  return withBackend<T>(backend);
}

/**
 * Construct a typed handle given a specific backend. Pure wiring —
 * exported so tests can inject `memoryBackend()` directly without
 * touching `openCache`.
 */
export function withBackend<T>(backend: CacheBackend): CacheHandle<T> {
  return {
    async get(key) {
      const raw = await backend.get(key);
      if (raw === null || typeof raw !== "object") return null;
      const r = raw as { storedAt?: unknown; value?: unknown };
      if (typeof r.storedAt !== "string") return null;
      return { storedAt: r.storedAt, value: r.value as T };
    },
    async put(key, value) {
      const stored: StoredValue<T> = { storedAt: new Date().toISOString(), value };
      await backend.put(key, stored);
    },
    async delete(key) {
      await backend.delete(key);
    },
    async list() {
      const rows = await backend.list();
      return rows
        .filter((row): row is { key: string; value: StoredValue<T> } => {
          const raw = row.value as { storedAt?: unknown } | null;
          return raw !== null && typeof raw === "object" && typeof raw.storedAt === "string";
        })
        .map((row) => ({ key: row.key, stored: row.value }));
    },
  };
}

/**
 * Given a stored value and a TTL in ms, returns true when the value
 * is stale (older than TTL). Pure helper for SWR consumers.
 */
export function isStale(stored: StoredValue<unknown>, ttlMs: number, now: Date = new Date()): boolean {
  const storedAtMs = new Date(stored.storedAt).getTime();
  if (Number.isNaN(storedAtMs)) return true;
  return now.getTime() - storedAtMs > ttlMs;
}
