/**
 * Short-lived cache of aggregated analytics results (Analisis chart/table, saved reports), so a view opened again —
 * another tab, a filter set back, a report reopened — does not run the same source query again.
 *
 * Safety: the caller checks data access BEFORE asking the cache (every request), and the key always contains the
 * dataset version, the row scope fingerprint and the organization snapshot generation (see `scopeKey`). A result is
 * therefore only ever served to a request with exactly the same scope as the one it was computed for; a changed
 * assignment, master or dataset gives a new key. Only small aggregated results are kept, never source rows.
 *
 * Bounded: fixed lifetime (no sliding), at most `maxEntries` (least recently used dropped first).
 */
import type { RowScope } from '../dataAccess/guard.ts'

export class ResultCache {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly entries = new Map<string, { at: number; value: unknown }>()
  private readonly now: () => number

  constructor(ttlMs: number, maxEntries = 300, now: () => number = Date.now) {
    this.ttlMs = Math.max(0, ttlMs)
    this.maxEntries = Math.max(1, maxEntries)
    this.now = now
  }

  get enabled() {
    return this.ttlMs > 0
  }

  /** The cached value for `key` when younger than the lifetime, else the result of `load` (stored on success). */
  async get<T>(key: string, load: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    if (!this.enabled) return { value: await load(), hit: false }
    const e = this.entries.get(key)
    if (e && this.now() - e.at < this.ttlMs) {
      // Least recently used order: a hit moves the entry to the end.
      this.entries.delete(key)
      this.entries.set(key, e)
      return { value: e.value as T, hit: true }
    }
    if (e) this.entries.delete(key)
    const value = await load()
    this.entries.set(key, { at: this.now(), value })
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
    return { value, hit: false }
  }

  clear() {
    this.entries.clear()
  }

  get size() {
    return this.entries.size
  }
}

/** Part of every cache key that identifies what the user may see: scope fingerprint + organization snapshot. */
export const scopeKey = (rs: RowScope) => (rs.kind === 'all' ? 'all' : `${rs.fingerprint}@${rs.snapshot.loadedAt}`)

/** JSON with sorted object keys, so equal requests give equal keys (array order is kept: it carries meaning). */
export function stableKey(v: unknown): string {
  return JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x))
}
