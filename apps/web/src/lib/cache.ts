const DEFAULT_TTL = 60_000; // 1 minute
// After the TTL, entries are still served (and refreshed in the background) for this long,
// so navigating back to a page renders instantly instead of waiting on the network.
const MAX_STALE = 10 * 60_000;
const SS_PREFIX = 'splitit:cache:';

interface Entry { data: unknown; ts: number; ttl: number }

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function ssGet(key: string): Entry | null {
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (!raw) return null;
    const e: Entry = JSON.parse(raw);
    store.set(key, e); // warm the in-memory store
    return e;
  } catch { return null; }
}

function ssSet(key: string, entry: Entry) {
  try { sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(entry)); } catch { /* quota — ignore */ }
}

function ssDel(key: string) {
  try { sessionStorage.removeItem(SS_PREFIX + key); } catch { /* ignore */ }
}

// Returns the entry (fresh or stale), dropping it once it's past MAX_STALE
function read(key: string): Entry | null {
  const e = store.get(key) ?? ssGet(key);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl + MAX_STALE) { store.delete(key); ssDel(key); return null; }
  return e;
}

const isFresh = (e: Entry) => Date.now() - e.ts <= e.ttl;

export const apiCache = {
  get<T>(key: string): T | null {
    const e = read(key);
    return e && isFresh(e) ? (e.data as T) : null;
  },

  set(key: string, data: unknown, ttl = DEFAULT_TTL) {
    const entry: Entry = { data, ts: Date.now(), ttl };
    store.set(key, entry);
    ssSet(key, entry);
  },

  /** Fetch with cache + in-flight deduplication. Stale entries are returned immediately and refreshed in the background. */
  async fetch<T>(key: string, fn: () => Promise<T>, ttl = DEFAULT_TTL): Promise<T> {
    const cached = read(key);
    if (cached && isFresh(cached)) return cached.data as T;

    let promise = inflight.get(key) as Promise<T> | undefined;
    if (!promise) {
      // Only the current request may write back — an invalidate() while it was in flight
      // means its response may predate a mutation
      const p: Promise<T> = fn()
        .then((data) => {
          if (inflight.get(key) === p) { this.set(key, data, ttl); inflight.delete(key); }
          return data;
        })
        .catch((err) => { if (inflight.get(key) === p) inflight.delete(key); throw err; });
      inflight.set(key, p);
      promise = p;
    }

    if (cached) {
      promise.catch(() => { /* background refresh — keep serving the stale copy */ });
      return cached.data as T;
    }
    return promise;
  },

  invalidate(...keys: string[]) {
    for (const k of keys) { store.delete(k); ssDel(k); inflight.delete(k); }
  },

  invalidatePrefix(prefix: string) {
    for (const k of store.keys()) if (k.startsWith(prefix)) { store.delete(k); ssDel(k); }
    for (const k of inflight.keys()) if (k.startsWith(prefix)) inflight.delete(k);
    // also sweep sessionStorage for keys not yet in memory
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const sk = sessionStorage.key(i);
        if (sk?.startsWith(SS_PREFIX + prefix)) sessionStorage.removeItem(sk);
      }
    } catch { /* ignore */ }
  },
};
