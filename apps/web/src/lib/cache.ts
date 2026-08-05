const DEFAULT_TTL = 60_000; // 1 minute
const SS_PREFIX = 'splitit:cache:';

interface Entry { data: unknown; ts: number; ttl: number }

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function ssGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (!raw) return null;
    const e: Entry = JSON.parse(raw);
    if (Date.now() - e.ts > e.ttl) { sessionStorage.removeItem(SS_PREFIX + key); return null; }
    store.set(key, e); // warm the in-memory store
    return e.data as T;
  } catch { return null; }
}

function ssSet(key: string, entry: Entry) {
  try { sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(entry)); } catch { /* quota — ignore */ }
}

function ssDel(key: string) {
  try { sessionStorage.removeItem(SS_PREFIX + key); } catch { /* ignore */ }
}

export const apiCache = {
  get<T>(key: string): T | null {
    const e = store.get(key);
    if (e) {
      if (Date.now() - e.ts > e.ttl) { store.delete(key); ssDel(key); return null; }
      return e.data as T;
    }
    return ssGet<T>(key);
  },

  set(key: string, data: unknown, ttl = DEFAULT_TTL) {
    const entry: Entry = { data, ts: Date.now(), ttl };
    store.set(key, entry);
    ssSet(key, entry);
  },

  /** Fetch with cache + in-flight deduplication. */
  async fetch<T>(key: string, fn: () => Promise<T>, ttl = DEFAULT_TTL): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = fn()
      .then((data) => { this.set(key, data, ttl); inflight.delete(key); return data; })
      .catch((err) => { inflight.delete(key); throw err; });

    inflight.set(key, promise);
    return promise;
  },

  invalidate(...keys: string[]) {
    for (const k of keys) { store.delete(k); ssDel(k); }
  },

  invalidatePrefix(prefix: string) {
    for (const k of store.keys()) if (k.startsWith(prefix)) { store.delete(k); ssDel(k); }
    // also sweep sessionStorage for keys not yet in memory
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const sk = sessionStorage.key(i);
        if (sk?.startsWith(SS_PREFIX + prefix)) sessionStorage.removeItem(sk);
      }
    } catch { /* ignore */ }
  },
};
