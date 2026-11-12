/**
 * One device, one user (route level) and the input guard, on the real Fastify server with an in-memory auth
 * stand-in (no database). The device rule itself runs in PostgreSQL (AuthService.login, one transaction under a
 * per-address lock); it was verified against the SIT database by the Tahap G suite: refusal, takeover, concurrent
 * sign-ins from one address (exactly one wins), same user in several browsers.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { AuthService } from '../src/auth/authService.ts'
import { deviceInUseMessage } from '../src/auth/authService.ts'
import { LoginLimiter } from '../src/auth/loginLimiter.ts'
import { loadConfig } from '../src/config/config.ts'
import { AppError, unauthenticated } from '../src/http/errors.ts'
import { registerAuthRoutes } from '../src/http/routes.ts'
import { createServer, hasNul } from '../src/http/server.ts'
import { createLogger } from '../src/log/logger.ts'

const log = createLogger('silent', false)

/** Auth stand-in: the address holds 'holder' until someone takes over. */
function dod() {
  const seen: { ip?: string | null; takeOver?: boolean }[] = []
  const holders = new Map<string, string>()
  const auth = {
    async login(username: string, password: string, device: { ip?: string | null; takeOver?: boolean } = {}) {
      seen.push(device)
      if (password !== 'right') throw new AppError(401, 'INVALID_CREDENTIALS', 'Username atau password salah.')
      const holder = device.ip ? holders.get(device.ip) : undefined
      if (holder && holder !== username && !device.takeOver) throw new AppError(409, 'DEVICE_IN_USE', deviceInUseMessage({ name: holder, username: holder }))
      if (device.ip) holders.set(device.ip, username)
      return { token: `tok-${username}`, expiresAt: new Date(Date.now() + 3600e3).toISOString(), user: { id: username, username, name: username, role: 'viewer' } }
    },
    async logout() {},
    async userForToken(): Promise<never> {
      throw unauthenticated()
    },
  }
  const config = loadConfig({ NODE_ENV: 'test', DOD_TRUSTED_PROXIES: '127.0.0.1' })
  const loginLimiter = new LoginLimiter(config.auth.loginLimit)
  const app = createServer(config, log, auth as unknown as AuthService)
  registerAuthRoutes(app, { auth: auth as unknown as AuthService, loginLimiter, log })
  const login = async (username: string, xff: string, extra: Record<string, unknown> = {}) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': xff }, payload: { username, password: 'right', ...extra } })
    return { status: r.statusCode, body: JSON.parse(r.body) as { error?: { code: string; message: string } } }
  }
  return { app, seen, login }
}

describe('one device, one user (login route)', () => {
  test('the client address (through the trusted proxy) and takeOver reach the auth service', async () => {
    const { seen, login } = dod()
    await login('a', '198.51.100.7')
    await login('b', '198.51.100.7', { takeOver: true })
    assert.deepEqual(seen, [{ ip: '198.51.100.7', takeOver: false }, { ip: '198.51.100.7', takeOver: true }])
  })

  test('another user on the same address is refused with 409 DEVICE_IN_USE; other addresses are independent', async () => {
    const { login } = dod()
    assert.equal((await login('a', '198.51.100.8')).status, 200)
    const b = await login('b', '198.51.100.8')
    assert.equal(b.status, 409)
    assert.equal(b.body.error?.code, 'DEVICE_IN_USE')
    assert.match(b.body.error?.message ?? '', /sedang dipakai oleh a \(a\)/)
    assert.equal((await login('b', '198.51.100.9')).status, 200)
    assert.equal((await login('a', '198.51.100.8')).status, 200, 'the same user again (another browser)')
    assert.equal((await login('b', '198.51.100.8', { takeOver: true })).status, 200)
  })

  test('takeOver must be a boolean', async () => {
    const { login } = dod()
    assert.equal((await login('a', '198.51.100.10', { takeOver: 'yes' })).status, 400)
  })

  test('refusals for a device in use do not count as failed sign-ins (no throttle block)', async () => {
    const { login } = dod()
    await login('a', '198.51.100.11')
    for (let i = 0; i < 12; i++) assert.equal((await login('b', '198.51.100.11')).status, 409)
  })
})

describe('input guard: U+0000 and runaway nesting', () => {
  test('hasNul finds NUL in strings, keys and nested values', () => {
    assert.equal(hasNul('a\u0000'), true)
    assert.equal(hasNul({ a: ['x', { b: 'y\u0000' }] }), true)
    assert.equal(hasNul({ 'k\u0000': 1 }), true)
    assert.equal(hasNul({ a: ['x', { b: 'y' }], n: 1, z: null }), false)
    assert.equal(hasNul(undefined), false)
  })

  test('nesting deeper than 64 levels counts as invalid', () => {
    let deep: unknown = 'x'
    for (let i = 0; i < 70; i++) deep = { a: deep }
    assert.equal(hasNul(deep), true)
    let ok: unknown = 'x'
    for (let i = 0; i < 20; i++) ok = { a: ok }
    assert.equal(hasNul(ok), false)
  })

  test('a NUL in the body or the query string is refused with 400 before the handler (no database error)', async () => {
    const { app, seen } = dod()
    const body = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', payload: { username: 'a\u0000', password: 'right' } })
    assert.equal(body.statusCode, 400)
    assert.equal(JSON.parse(body.body).error.code, 'INVALID_CHARACTER')
    assert.equal(seen.length, 0, 'the auth service was never called')
    const query = await app.inject({ method: 'POST', url: '/api/auth/login?x=%00', remoteAddress: '127.0.0.1', payload: { username: 'a', password: 'right' } })
    assert.equal(query.statusCode, 400)
    assert.equal(seen.length, 0)
  })
})
