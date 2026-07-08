const DEFAULT_TTL = 60_000; // 1 minute

interface Entry { data: unknown; ts: number; ttl: number }

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export const apiCache = {
  get<T>(key: string): T | null {
    const e = store.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > e.ttl) { store.delete(key); return null; }
    return e.data as T;
  },

  set(key: string, data: unknown, ttl = DEFAULT_TTL) {
    store.set(key, { data, ts: Date.now(), ttl });
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
    for (const k of keys) store.delete(k);
  },

  invalidatePrefix(prefix: string) {
    for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  },
};
