/**
 * Login throttle. Sign-in attempts are counted per (client IP, username) and per client IP in a fixed
 * window; when a counter reaches its limit, further attempts on that key are refused until its window
 * ends. Nothing is locked permanently.
 *
 * - An attempt is counted when it starts (synchronously, before the password check), so parallel requests
 *   cannot slip past the limit. The outcome settles it: a success clears the (IP, username) counter and is
 *   not held against the IP; a failure that is not a wrong password (e.g. database error) is refunded.
 * - The client IP must come from `clientIp()` (trusted-proxy aware, normalised). Usernames are stored only
 *   as a hash.
 * - At most `maxKeys` counters are kept. When full, expired counters are dropped first, then the oldest
 *   counters that are not blocking and do not belong to the requesting client; an active block is never
 *   evicted. If every counter is blocking, a new
 *   identity is refused (fail closed) until the first block expires.
 *
 * Process-local (memory): counters reset when the API restarts and are not shared between processes or
 * instances.
 */
import { createHash } from 'node:crypto'

export interface LoginLimitConfig {
  windowMs: number
  /** Attempts per IP + username within the window. */
  maxPerUser: number
  /** Attempts per IP (any username) within the window. */
  maxPerIp: number
  /** Upper bound on stored counters. */
  maxKeys: number
}

interface Counter { count: number; resetAt: number; max: number }

export interface LoginTicket { readonly user: string; readonly ip: string }
export type LoginAttempt = { ok: true; ticket: LoginTicket } | { ok: false; retryAfterSec: number; reason: 'limit' | 'capacity' }
export type LoginOutcome = 'success' | 'invalid' | 'error'

export class LoginLimiter {
  private readonly counters = new Map<string, Counter>()
  private readonly config: LoginLimitConfig
  private readonly now: () => number

  constructor(config: LoginLimitConfig, now: () => number = Date.now) {
    this.config = config
    this.now = now
  }

  /** Number of stored counters (for monitoring and tests). */
  get size() {
    return this.counters.size
  }

  private keys(ip: string, username: string): LoginTicket {
    const user = createHash('sha256').update(username.trim().toLowerCase()).digest('hex').slice(0, 32)
    return { user: `u:${ip}|${user}`, ip: `ip:${ip}` }
  }

  private live(key: string, t: number): Counter | null {
    const c = this.counters.get(key)
    if (!c) return null
    if (c.resetAt <= t) {
      this.counters.delete(key)
      return null
    }
    return c
  }

  /** Counts the attempt, or refuses it with the seconds to wait. */
  attempt(ip: string, username: string): LoginAttempt {
    const t = this.now()
    const k = this.keys(ip, username)
    const user = this.live(k.user, t)
    const byIp = this.live(k.ip, t)
    let wait = 0
    for (const c of [user, byIp]) if (c && c.count >= c.max) wait = Math.max(wait, c.resetAt - t)
    if (wait > 0) return { ok: false, retryAfterSec: Math.ceil(wait / 1000), reason: 'limit' }
    const missing = (user ? 0 : 1) + (byIp ? 0 : 1)
    // This request's own counters are never evicted to make its room: they must keep counting it.
    if (missing && !this.makeRoom(missing, t, k)) return { ok: false, retryAfterSec: this.soonestExpiry(t), reason: 'capacity' }
    const resetAt = t + this.config.windowMs
    if (user) user.count++
    else this.counters.set(k.user, { count: 1, resetAt, max: this.config.maxPerUser })
    if (byIp) byIp.count++
    else this.counters.set(k.ip, { count: 1, resetAt, max: this.config.maxPerIp })
    return { ok: true, ticket: k }
  }

  /** Records how a counted attempt ended. */
  settle(ticket: LoginTicket, outcome: LoginOutcome) {
    if (outcome === 'invalid') return
    const t = this.now()
    const byIp = this.live(ticket.ip, t)
    if (byIp && byIp.count > 0) byIp.count--
    if (outcome === 'success') {
      this.counters.delete(ticket.user)
      return
    }
    const user = this.live(ticket.user, t)
    if (user && user.count > 0) user.count--
  }

  /** Frees space for `n` new counters without evicting an active block or the requesting client's counters. */
  private makeRoom(n: number, t: number, own: LoginTicket): boolean {
    const max = this.config.maxKeys
    if (this.counters.size + n <= max) return true
    for (const [key, c] of this.counters) if (c.resetAt <= t) this.counters.delete(key)
    // Map order is insertion order: the oldest non-blocking counters go first.
    for (const [key, c] of this.counters) {
      if (this.counters.size + n <= max) break
      if (c.count < c.max && key !== own.user && key !== own.ip) this.counters.delete(key)
    }
    return this.counters.size + n <= max
  }

  private soonestExpiry(t: number): number {
    let soonest = Infinity
    for (const c of this.counters.values()) soonest = Math.min(soonest, c.resetAt - t)
    return Math.max(1, Math.ceil((Number.isFinite(soonest) ? soonest : this.config.windowMs) / 1000))
  }
}
