/**
 * Login throttle and configuration guards (login limits, application database). Pure functions only;
 * no database is touched.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LoginLimiter } from '../src/auth/loginLimiter.ts'
import { ConfigError, appServer, appServerAddress, loadConfig, requireAppDb } from '../src/config/config.ts'

const limits = { windowMs: 60_000, maxPerUser: 3, maxPerIp: 5, maxKeys: 1_000 }

describe('login throttle', () => {
  const clock = (start = 1_000_000) => {
    let t = start
    return { now: () => t, advance: (ms: number) => void (t += ms) }
  }
  /** One failed (wrong password) attempt; returns the refusal wait in seconds, or null when it was allowed. */
  const fail = (l: LoginLimiter, ip: string, user: string) => {
    const a = l.attempt(ip, user)
    if (!a.ok) return a.retryAfterSec
    l.settle(a.ticket, 'invalid')
    return null
  }
  const waitOf = (l: LoginLimiter, ip: string, user: string) => {
    const a = l.attempt(ip, user)
    if (!a.ok) return a.retryAfterSec
    l.settle(a.ticket, 'error') // probe only: refunded
    return null
  }

  test('allows attempts until the per-user limit, then refuses with the remaining wait', () => {
    const c = clock()
    const l = new LoginLimiter(limits, c.now)
    for (let i = 0; i < 3; i++) assert.equal(fail(l, '10.0.0.1', 'admin'), null)
    assert.equal(waitOf(l, '10.0.0.1', 'admin'), 60)
    c.advance(30_000)
    assert.equal(waitOf(l, '10.0.0.1', 'admin'), 30)
  })

  test('recovers when the window ends (no permanent lockout)', () => {
    const c = clock()
    const l = new LoginLimiter(limits, c.now)
    for (let i = 0; i < 3; i++) fail(l, '10.0.0.1', 'admin')
    c.advance(60_000)
    assert.equal(waitOf(l, '10.0.0.1', 'admin'), null)
  })

  test('a successful sign-in clears the per-user counter and is not held against the IP', () => {
    const l = new LoginLimiter(limits)
    fail(l, '10.0.0.1', 'admin')
    fail(l, '10.0.0.1', 'admin')
    const ok = l.attempt('10.0.0.1', 'admin')
    assert.ok(ok.ok)
    l.settle(ok.ticket, 'success')
    fail(l, '10.0.0.1', 'admin')
    fail(l, '10.0.0.1', 'admin')
    assert.equal(waitOf(l, '10.0.0.1', 'admin'), null)
    // 4 failures + 1 success from this IP: the success does not count towards the IP limit of 5.
    assert.equal(waitOf(l, '10.0.0.1', 'other'), null)
  })

  test('usernames are compared case-insensitively and per client IP', () => {
    const l = new LoginLimiter(limits)
    for (let i = 0; i < 3; i++) fail(l, '10.0.0.1', i % 2 ? 'Admin ' : 'admin')
    assert.notEqual(waitOf(l, '10.0.0.1', 'ADMIN'), null)
    // Another client is not locked out by someone else's failures.
    assert.equal(waitOf(l, '10.0.0.2', 'admin'), null)
  })

  test('the per-IP limit stops guessing across many usernames', () => {
    const l = new LoginLimiter(limits)
    for (let i = 0; i < 5; i++) fail(l, '10.0.0.9', `user${i}`)
    assert.notEqual(waitOf(l, '10.0.0.9', 'someone-new'), null)
  })

  test('a failure that is not a wrong password (e.g. database error) is refunded', () => {
    const l = new LoginLimiter(limits)
    for (let i = 0; i < 10; i++) {
      const a = l.attempt('10.0.0.3', 'admin')
      assert.ok(a.ok)
      l.settle(a.ticket, 'error')
    }
    assert.equal(waitOf(l, '10.0.0.3', 'admin'), null)
  })

  test('usernames are not stored in clear text', () => {
    const l = new LoginLimiter(limits)
    fail(l, '10.0.0.4', 'Rahasia.User@example.test')
    const keys = [...(l as unknown as { counters: Map<string, unknown> }).counters.keys()].join(' ')
    assert.doesNotMatch(keys, /rahasia|example/i)
  })

  test('a full table cannot evict the requesting client\'s own counter (per-IP limit holds at capacity)', () => {
    // Regression for Phase 2D L1: 23 attempts got through when the attacker's IP counter was the oldest.
    const l = new LoginLimiter({ windowMs: 900_000, maxPerUser: 5, maxPerIp: 20, maxKeys: 100 })
    const counters = (l as unknown as { counters: Map<string, { count: number; max: number }> }).counters
    fail(l, '203.0.113.66', 'first') // the attacker's counters are created first, so they are the oldest
    for (let i = 0; i < 4; i++) fail(l, '198.18.9.1', 'victim') // another client, one attempt short of a block
    fail(l, '198.18.9.2', 'blocked') // and a client that is already blocked:
    for (let i = 0; i < 4; i++) fail(l, '198.18.9.2', 'blocked')
    for (let i = 0; l.size < 100; i++) fail(l, `198.18.0.${i}`, `x${i}`) // others fill the table
    assert.equal(l.size, 100)
    let allowed = 1
    for (let i = 0; i < 500; i++) if (fail(l, '203.0.113.66', `spray${i}`) === null) allowed++
    assert.equal(allowed, 20, 'no 21st attempt through eviction')
    assert.ok(l.size <= 100)
    const ipKey = [...counters.entries()].find(([k]) => k === 'ip:203.0.113.66')
    assert.ok(ipKey && ipKey[1].count >= ipKey[1].max, "the attacker's IP counter is kept and blocking")
    assert.notEqual(waitOf(l, '198.18.9.2', 'blocked'), null, 'an active block is kept')
  })
})

describe('configuration guards', () => {
  test('production needs no published-page URL any more (the Publish module was removed)', () => {
    assert.doesNotThrow(() => loadConfig({ NODE_ENV: 'production', DOD_ADMIN_PASSWORD: 'x'.repeat(12) }))
    assert.equal('publish' in loadConfig({ NODE_ENV: 'development' }), false)
  })

  test('the application database has one setup: DOD_DB_* only, no local fallback, no profiles', () => {
    const env = { DOD_DB_HOST: '10.0.0.9', DOD_DB_PORT: '6432', DOD_DB_NAME: 'dor_application', DOD_DB_USER: 'app', DOD_DB_PASSWORD: 'pw', DOD_DB_SSL: 'true', DOD_DB_MASTER_NAME: 'dor_apims_master' }
    const c = loadConfig(env)
    assert.deepEqual(c.metadataDb, { host: '10.0.0.9', port: 6432, database: 'dor_application', user: 'app', password: 'pw', ssl: true, poolMax: 5 })
    assert.deepEqual(c.orgMaster, { database: 'dor_apims_master' })
    assert.doesNotThrow(() => requireAppDb(c))
    // Empty values never become 127.0.0.1 / dor: the API and the scripts refuse to start instead.
    const empty = loadConfig({})
    assert.deepEqual([empty.metadataDb.host, empty.metadataDb.database, empty.metadataDb.user], ['', '', ''])
    assert.throws(() => requireAppDb(empty), /DOD_DB_HOST, DOD_DB_NAME, DOD_DB_USER belum diisi/)
    // Every database of the app sits on that server; a socket path is reached as 127.0.0.1 by registered connections.
    assert.deepEqual(appServer(c, 'dor_webpwadh2', { user: 'r', password: 'x' }), { host: '10.0.0.9', port: 6432, database: 'dor_webpwadh2', user: 'r', password: 'x', ssl: { rejectUnauthorized: false } })
    assert.deepEqual(appServerAddress(loadConfig({ ...env, DOD_DB_HOST: '/tmp' })), { host: '127.0.0.1', port: 6432 })
    // The removed DOD_DB_TARGET profiles are refused by name (values never in the message).
    assert.throws(() => loadConfig({ ...env, DOD_DB_TARGET: 'SERVER' }), /DOD_DB_TARGET: profil DOD_DB_TARGET tidak dipakai lagi/)
    assert.throws(() => loadConfig({ ...env, DOD_DB_SERVER_HOST: '10.0.0.9', DOD_DB_LOCAL_PASSWORD: 'secret' }), (e) => e instanceof ConfigError && /DOD_DB_LOCAL_PASSWORD, DOD_DB_SERVER_HOST/.test(e.message) && !e.message.includes('secret'))
    assert.doesNotThrow(() => loadConfig({ ...env, DOD_DB_TARGET: '', DOD_DB_POOL_MAX: '7' }))
  })

  test('login limits come from the environment with safe defaults', () => {
    assert.deepEqual(loadConfig({}).auth.loginLimit, { windowMs: 15 * 60_000, maxPerUser: 5, maxPerIp: 20, maxKeys: 10_000 })
    assert.deepEqual(loadConfig({ DOD_LOGIN_MAX_ATTEMPTS: '3', DOD_LOGIN_WINDOW_MINUTES: '1', DOD_LOGIN_MAX_TRACKED: '500' }).auth.loginLimit, { windowMs: 60_000, maxPerUser: 3, maxPerIp: 20, maxKeys: 500 })
  })
})
