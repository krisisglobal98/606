/**
 * Trusted proxies and the login throttle on the real Fastify server: `loadConfig` → `createServer` →
 * `registerAuthRoutes`, driven with `inject` (simulated TCP peer and headers). No database and no network:
 * the auth service is an in-memory stand-in with the same login/logout/userForToken contract.
 *
 * These are simulations of what a proxy sends; they do not exercise a real IIS or nginx.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../src/auth/authService.ts'
import { LoginLimiter } from '../src/auth/loginLimiter.ts'
import { ConfigError, loadConfig, parseTrustedProxies } from '../src/config/config.ts'
import { clientIp, normalizeIp } from '../src/http/clientIp.ts'
import { AppError, unauthenticated } from '../src/http/errors.ts'
import { registerAuthRoutes } from '../src/http/routes.ts'
import { createServer } from '../src/http/server.ts'
import { createLogger } from '../src/log/logger.ts'

const GOOD = 'correct-horse'
const log = createLogger('silent', false)

function fakeAuth() {
  const calls = { login: 0, logout: 0 }
  const auth = {
    async login(username: string, password: string) {
      calls.login++
      await new Promise((r) => setTimeout(r, 15)) // like scrypt: the check takes time, so requests overlap
      if (password !== GOOD) throw new AppError(401, 'INVALID_CREDENTIALS', 'Username atau password salah.')
      return { token: `tok-${username}`, expiresAt: new Date(Date.now() + 3600e3).toISOString(), user: { id: 'u-1', username, name: username, role: 'admin' } }
    },
    async logout() {
      calls.logout++
    },
    async userForToken(token: string | null) {
      if (token === 'valid') return { id: 'u-1', username: 'admin', name: 'Admin', role: 'admin' }
      throw unauthenticated()
    },
  }
  return { auth: auth as unknown as AuthService, calls }
}

/** A DOD API with the given environment; `t` is the throttle's clock. */
function dod(env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ...env })
  const { auth, calls } = fakeAuth()
  const clock = { t: 1_000_000 }
  const loginLimiter = new LoginLimiter(config.auth.loginLimit, () => clock.t)
  const app = createServer(config, log, auth)
  registerAuthRoutes(app, { auth, loginLimiter, log })
  app.get('/api/health/test-ip', async (req) => ({ ip: req.ip, client: clientIp(req) }))
  return { app, calls, clock, loginLimiter, config }
}

const peer = async (app: FastifyInstance, remoteAddress: string, headers: Record<string, string> = {}) =>
  JSON.parse((await app.inject({ url: '/api/health/test-ip', remoteAddress, headers })).body) as { ip: string; client: string }

const login = async (app: FastifyInstance, o: { from: string; xff?: string; user?: string; password?: string }) => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: o.from, headers: o.xff ? { 'x-forwarded-for': o.xff } : {}, payload: { username: o.user ?? 'admin', password: o.password ?? 'wrong-password' } })
  return { status: r.statusCode, retryAfter: r.headers['retry-after'], body: JSON.parse(r.body) as { error?: { code: string }; token?: string } }
}

describe('A. configuration and client identity', () => {
  test('native (no proxy configured): X-Forwarded-For is ignored, the TCP peer is the client', async () => {
    const { app } = dod()
    assert.deepEqual(await peer(app, '127.0.0.1', { 'x-forwarded-for': '198.51.100.1' }), { ip: '127.0.0.1', client: '127.0.0.1' })
    assert.equal((await peer(app, '203.0.113.9', { 'x-forwarded-for': '198.51.100.1' })).client, '203.0.113.9')
  })

  test('a trusted proxy yields the client it appended, not values the client sent', async () => {
    const { app } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' })
    assert.equal((await peer(app, '127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })).client, '203.0.113.7')
    // The client forged "198.51.100.1"; the proxy appended the real address.
    assert.equal((await peer(app, '127.0.0.1', { 'x-forwarded-for': '198.51.100.1, 203.0.113.7' })).client, '203.0.113.7')
  })

  test('an untrusted peer cannot set the client address, even by naming the proxy', async () => {
    const { app } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' })
    assert.equal((await peer(app, '192.0.2.50', { 'x-forwarded-for': '203.0.113.7' })).client, '192.0.2.50')
    assert.equal((await peer(app, '192.0.2.50', { 'x-forwarded-for': '198.51.100.1, 127.0.0.1' })).client, '192.0.2.50')
  })

  test('DOD_API_TRUST_PROXY=true is refused (production and elsewhere); "false" and empty are accepted', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', DOD_API_TRUST_PROXY: 'true' }), /DOD_API_TRUST_PROXY=true/)
    assert.throws(() => loadConfig({ DOD_API_TRUST_PROXY: 'TRUE' }), ConfigError)
    assert.throws(() => loadConfig({ DOD_API_TRUST_PROXY: 'yes' }), /tidak dikenal/)
    assert.deepEqual(loadConfig({ DOD_API_TRUST_PROXY: 'false' }).api.trustedProxies, [])
    assert.deepEqual(loadConfig({ DOD_API_TRUST_PROXY: '' }).api.trustedProxies, [])
  })

  test('the trusted list: empty means none; valid entries are normalised; malformed or too broad ones are refused', () => {
    assert.deepEqual(parseTrustedProxies(''), [])
    assert.deepEqual(parseTrustedProxies(' , '), [])
    assert.deepEqual(parseTrustedProxies('loopback'), ['127.0.0.1/8', '::1/128'])
    assert.deepEqual(parseTrustedProxies(' 127.0.0.1 , 10.20.0.0/24, ::FFFF:10.0.0.1, 2001:DB8:0:0::1, 127.0.0.1 '), ['127.0.0.1/32', '10.20.0.0/24', '10.0.0.1/32', '2001:db8::1/128'])
    for (const bad of ['abc', 'true', '*', 'all', '1.2.3.4/33', '::1/129', '0.0.0.0/0', '::/0', '10.0.0.0/4', 'fd00::/8', '1.2.3.4/x', '1.2.3.4/8/9', '1.2.3', '300.1.1.1', 'localhost'])
      assert.throws(() => parseTrustedProxies(bad), ConfigError, bad)
    assert.throws(() => loadConfig({ DOD_TRUSTED_PROXIES: '127.0.0.1, nope' }), /DOD_TRUSTED_PROXIES/)
  })

  test('IPv6 and IPv4-mapped peers are matched and normalised consistently', async () => {
    const v6 = dod({ DOD_TRUSTED_PROXIES: 'fd00:10::/32' }).app
    assert.equal((await peer(v6, 'fd00:10::5', { 'x-forwarded-for': '2001:DB8::7' })).client, '2001:db8::7')
    const mapped = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' }).app
    assert.equal((await peer(mapped, '::ffff:127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })).client, '203.0.113.7')
    assert.equal((await peer(dod().app, '::ffff:203.0.113.8')).client, '203.0.113.8')
    for (const [raw, want] of [['::ffff:1.2.3.4', '1.2.3.4'], ['::FFFF:0102:0304', '1.2.3.4'], ['[2001:db8:0:0:0:0:0:1]', '2001:db8::1'], ['fe80::1%en0', 'fe80::1'], ['nope', null], ['', null]] as const)
      assert.equal(normalizeIp(raw), want, raw)
  })

  test('a chain is followed only through trusted hops', async () => {
    const { app } = dod({ DOD_TRUSTED_PROXIES: '10.0.0.1, 10.0.0.2' })
    // client → 10.0.0.1 (IIS) → 10.0.0.2 (load balancer) → API
    assert.equal((await peer(app, '10.0.0.2', { 'x-forwarded-for': '198.51.100.1, 203.0.113.7, 10.0.0.1' })).client, '203.0.113.7')
    // An untrusted hop (10.0.0.9) ends the chain: what it claims about its client is not used.
    assert.equal((await peer(app, '10.0.0.2', { 'x-forwarded-for': '198.51.100.1, 10.0.0.9' })).client, '10.0.0.9')
  })
})

describe('B. spoofing', () => {
  test('forged X-Forwarded-For values do not bypass the throttle behind a trusted proxy', async () => {
    const { app } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' })
    const statuses: number[] = []
    for (let i = 0; i < 10; i++) statuses.push((await login(app, { from: '127.0.0.1', xff: `198.51.100.${i}, 203.0.113.7` })).status)
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429, 429, 429, 429])
    assert.equal((await login(app, { from: '127.0.0.1', xff: '198.51.100.99, 203.0.113.7', password: GOOD })).status, 429, 'blocked even with the right password')
  })

  test('a direct (untrusted) client rotating X-Forwarded-For is throttled on its own address', async () => {
    const { app, loginLimiter } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' })
    const statuses: number[] = []
    for (let i = 0; i < 8; i++) statuses.push((await login(app, { from: '192.0.2.66', xff: `198.51.100.${i}` })).status)
    assert.deepEqual(statuses.slice(4), [401, 429, 429, 429])
    assert.equal(loginLimiter.size, 2, 'one (IP, user) counter and one IP counter, however many header variants')
  })

  test('other forwarding headers and invalid forwarded values give no new identity', async () => {
    const { app } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' })
    assert.equal((await peer(app, '127.0.0.1', { forwarded: 'for=198.51.100.1', 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '203.0.113.7' })).client, '203.0.113.7')
    assert.equal((await peer(app, '127.0.0.1', { forwarded: 'for=198.51.100.1', 'x-real-ip': '198.51.100.2' })).client, '127.0.0.1')
    // A proxy that passes a garbage value through: req.ip is that value, the throttle uses the TCP peer.
    const r = await peer(app, '127.0.0.1', { 'x-forwarded-for': 'not-an-ip' })
    assert.equal(r.ip, 'not-an-ip')
    assert.equal(r.client, '127.0.0.1')
  })
})

describe('C. throttle behaviour', () => {
  test('clients behind the same proxy do not lock each other out', async () => {
    const { app } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' })
    for (let i = 0; i < 25; i++) await login(app, { from: '127.0.0.1', xff: '203.0.113.10', user: `guess${i}` })
    assert.equal((await login(app, { from: '127.0.0.1', xff: '203.0.113.10', user: 'admin', password: GOOD })).status, 429, 'the guessing client is blocked')
    const other = await login(app, { from: '127.0.0.1', xff: '203.0.113.11', user: 'admin', password: GOOD })
    assert.equal(other.status, 200, 'another client behind the same proxy signs in')
  })

  test('per-IP limit across usernames (20 by default)', async () => {
    const { app } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1' })
    const s: number[] = []
    for (let i = 0; i < 21; i++) s.push((await login(app, { from: '127.0.0.1', xff: '203.0.113.20', user: `user${i}` })).status)
    assert.equal(s.filter((x) => x === 401).length, 20)
    assert.equal(s[20], 429)
  })

  test('parallel attempts cannot exceed the per-user limit', async () => {
    const { app, calls } = dod()
    const results = await Promise.all(Array.from({ length: 20 }, () => login(app, { from: '203.0.113.30' })))
    assert.equal(calls.login, 5, 'only 5 attempts reached the password check')
    assert.equal(results.filter((r) => r.status === 401).length, 5)
    assert.equal(results.filter((r) => r.status === 429).length, 15)
  })

  test('429 carries Retry-After and the error code; the block ends with the window', async () => {
    const { app, clock } = dod({ DOD_LOGIN_WINDOW_MINUTES: '15' })
    for (let i = 0; i < 5; i++) await login(app, { from: '203.0.113.40' })
    clock.t += 60_000
    const blocked = await login(app, { from: '203.0.113.40', password: GOOD })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.body.error?.code, 'TOO_MANY_ATTEMPTS')
    assert.equal(blocked.retryAfter, String(14 * 60))
    clock.t += 14 * 60_000
    assert.equal((await login(app, { from: '203.0.113.40', password: GOOD })).status, 200)
  })

  test('stored counters stay bounded, and an active block survives a flood of new identities', async () => {
    const { app, loginLimiter } = dod({ DOD_TRUSTED_PROXIES: '127.0.0.1', DOD_LOGIN_MAX_TRACKED: '100' })
    for (let i = 0; i < 5; i++) await login(app, { from: '127.0.0.1', xff: '203.0.113.50' })
    for (let i = 0; i < 300; i++) await login(app, { from: '127.0.0.1', xff: `198.18.${i >> 8}.${i & 255}` })
    assert.ok(loginLimiter.size <= 100, `size ${loginLimiter.size}`)
    assert.equal((await login(app, { from: '127.0.0.1', xff: '203.0.113.50', password: GOOD })).status, 429, 'still blocked')
  })

  test('when every stored counter is an active block, a new identity is refused (fail closed)', async () => {
    const { app, loginLimiter } = dod({ DOD_LOGIN_MAX_TRACKED: '100', DOD_LOGIN_MAX_ATTEMPTS: '1', DOD_LOGIN_MAX_ATTEMPTS_PER_IP: '1' })
    for (let i = 0; i < 50; i++) assert.equal((await login(app, { from: `198.18.1.${i}` })).status, 401)
    assert.equal(loginLimiter.size, 100)
    const refused = await login(app, { from: '198.18.2.1', password: GOOD })
    assert.equal(refused.status, 429)
    assert.ok(Number(refused.retryAfter) >= 1)
    assert.equal((await login(app, { from: '198.18.1.0', password: GOOD })).status, 429, 'existing block kept')
  })

  test('normal sign-in and sign-out still work', async () => {
    const { app, calls } = dod()
    const ok = await login(app, { from: '203.0.113.60', password: GOOD })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.token, 'tok-admin')
    const me = await app.inject({ url: '/api/auth/me', headers: { authorization: 'Bearer valid' } })
    assert.equal(me.statusCode, 200)
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: 'Bearer valid' } })
    assert.equal(out.statusCode, 204)
    assert.equal(calls.logout, 1)
    assert.equal((await app.inject({ url: '/api/auth/me' })).statusCode, 401)
  })
})
