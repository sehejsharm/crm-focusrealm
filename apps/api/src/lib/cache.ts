/**
 * Remembers the result of slow, slowly-changing work (30-day averages read
 * out of every call's AI analysis, for example) for a short time, and shares
 * one run between requests that ask at the same moment.
 *
 * Kept per process: on serverless every warm instance has its own copy, so
 * only use it for figures where being a minute behind doesn't matter. Never
 * for anything a person has just changed and expects to see.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();

export function remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;

  if (store.size > 200) {
    for (const [k, v] of store) if (now - v.at > 3600_000) store.delete(k);
  }
  const value = load();
  store.set(key, { at: now, value });
  // A failure isn't worth remembering: the next request tries again.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}
