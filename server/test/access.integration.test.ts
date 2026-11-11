/**
 * Menu permissions per role against a real, throw-away PostgreSQL database: migration 008, the matrix API, saving
 * and resetting, the audit rows, the menus sent with the session, and the API refusing a switched-off menu.
 *
 * Opt-in like the other integration tests: DOD_TEST_PG_HOST (and _PORT/_USER/_PASSWORD) on a server where that
 * account may CREATE DATABASE. Creates `dor_test_<random>` and drops it afterwards.
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { hashPassword } from '../src/auth/authService.ts'
import { loadConfig } from '../src/config/config.ts'
import { createContainer, type Container } from '../src/container.ts'
import { registerRoutes } from '../src/http/routes.ts'
import { createServer } from '../src/http/server.ts'
import { createLogger } from '../src/log/logger.ts'

const host = process.env.DOD_TEST_PG_HOST
const skip = host ? false : 'set DOD_TEST_PG_HOST to run the menu permission integration tests on a temporary database'
const admin = { host, port: Number(process.env.DOD_TEST_PG_PORT || 5432), user: process.env.DOD_TEST_PG_USER || undefined, password: process.env.DOD_TEST_PG_PASSWORD || undefined }
const DB = `dor_test_${randomBytes(6).toString('hex')}`
const adminPassword = randomBytes(12).toString('base64url')
const viewerPassword = randomBytes(12).toString('base64url')

async function run(database: string, sql: string) {
  const c = new pg.Client({ ...admin, database })
  await c.connect()
  try {
    return await c.query(sql)
  } finally {
    await c.end()
  }
}

describe('menu permissions on a temporary database', { skip }, () => {
  let k: Container
  let app: FastifyInstance
  let dir: string
  let created = false
  let ip = 1
  let adminToken = ''
  let viewerToken = ''
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, token: string, body?: unknown) => {
    const r = await app.inject({ method, url, payload: body as object | undefined, remoteAddress: `10.8.0.${ip++ % 250}`, headers: { authorization: `Bearer ${token}` } })
    return { status: r.statusCode, raw: r.body, body: r.body ? JSON.parse(r.body) : null }
  }
  const login = async (username: string, password: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, remoteAddress: `10.8.1.${ip++ % 250}` })
    assert.equal(r.statusCode, 200, r.body)
    return JSON.parse(r.body) as { token: string; user: { menus: string[] } }
  }

  before(async () => {
    await run('postgres', `CREATE DATABASE ${DB}`)
    created = true
    dir = await mkdtemp(join(tmpdir(), 'dod-access-test-'))
    const config = loadConfig({
      NODE_ENV: 'test',
      DOD_DB_HOST: admin.host,
      DOD_DB_PORT: String(admin.port),
      DOD_DB_NAME: DB,
      DOD_DB_USER: admin.user ?? process.env.USER ?? 'postgres',
      DOD_DB_PASSWORD: admin.password ?? '',
      DOD_ADMIN_PASSWORD: adminPassword,
      DOD_LOGIN_MAX_ATTEMPTS: '50',
      DOD_LOGIN_MAX_ATTEMPTS_PER_IP: '50',
    })
    k = createContainer(config, createLogger('silent', false))
    await k.db.migrate()
    await k.auth.ensureAdmin()
    await k.db.query('INSERT INTO dor_user (id, username, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), 'viewer1', 'Viewer Uji', 'viewer', await hashPassword(viewerPassword)])
    app = createServer(config, k.log, k.auth)
    registerRoutes(app, k)
    await app.ready()
    adminToken = (await login('admin', adminPassword)).token
  })

  after(async () => {
    await app?.close()
    await k?.db.close()
    if (dir) await rm(dir, { recursive: true, force: true })
    if (created) await run('postgres', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
  })

  test('migration 008 and the defaults sent with the session', async () => {
    assert.equal((await k.db.query("SELECT 1 FROM dor_migration WHERE name = '008_role_menu.sql'")).rowCount, 1)
    await assert.rejects(k.db.query("INSERT INTO dor_role_menu (role, menu_id, allowed) VALUES ('owner', 'report', true)"), /dor_role_menu_role_check/)
    const v = await login('viewer1', viewerPassword)
    viewerToken = v.token
    assert.ok(v.user.menus.includes('report') && v.user.menus.includes('beranda'))
    assert.ok(!v.user.menus.includes('settings.users') && !v.user.menus.includes('settings.permissions'))
    const me = await call('GET', '/api/auth/me', adminToken)
    assert.ok(me.body.menus.includes('settings.permissions'))
  })

  test('matrix: administrators only, with ceilings and locked cells', async () => {
    assert.equal((await call('GET', '/api/access/menus', viewerToken)).status, 403)
    const m = await call('GET', '/api/access/menus', adminToken)
    assert.equal(m.status, 200, m.raw)
    const cell = (id: string, role: string) => m.body.menus.find((x: { id: string }) => x.id === id).cells[role]
    assert.equal(cell('settings.users', 'viewer').state, 'unavailable')
    assert.deepEqual([cell('settings.permissions', 'admin').state, cell('settings.permissions', 'admin').locked], ['on', true])
    assert.equal(cell('report', 'viewer').state, 'on')
  })

  test('saving switches the menu and its API off; reset brings the defaults back', async () => {
    const bad = await call('PUT', '/api/access/menus', adminToken, { roles: { admin: { settings: false } } })
    assert.equal(bad.status, 400)
    assert.equal((await call('PUT', '/api/access/menus', adminToken, { roles: { viewer: { 'settings.users': true } } })).status, 400)

    const s = await call('PUT', '/api/access/menus', adminToken, { roles: { viewer: { report: false, beranda: false, analisis: true } } })
    assert.equal(s.status, 200, s.raw)
    assert.ok(s.body.updatedBy && s.body.updatedAt)
    const rows = (await k.db.query<{ menu_id: string; allowed: boolean }>("SELECT menu_id, allowed FROM dor_role_menu WHERE role = 'viewer' ORDER BY menu_id")).rows
    assert.deepEqual(rows, [{ menu_id: 'analisis', allowed: true }, { menu_id: 'beranda', allowed: false }, { menu_id: 'report', allowed: false }])
    assert.equal((await k.db.query("SELECT 1 FROM dor_audit WHERE action = 'access.menus.save'")).rowCount, 1)

    const me = await call('GET', '/api/auth/me', viewerToken)
    assert.ok(!me.body.menus.some((x: string) => x.startsWith('report') || x === 'beranda'))
    const denied = await call('GET', '/api/saved-reports', viewerToken)
    assert.deepEqual([denied.status, denied.body.error.code], [403, 'MENU_FORBIDDEN'])
    assert.equal((await call('GET', '/api/saved-reports', adminToken)).status, 200, 'other roles keep the menu')

    const r = await call('POST', '/api/access/menus/reset', adminToken)
    assert.equal(r.status, 200, r.raw)
    assert.equal((await k.db.query('SELECT 1 FROM dor_role_menu')).rowCount, 0)
    assert.equal((await call('GET', '/api/saved-reports', viewerToken)).status, 200)
  })
})
