/**
 * HTTP API against a real, throw-away PostgreSQL database: migrations, sign-in, login throttling,
 * health endpoint exposure and JSON error bodies.
 *
 * Opt-in: set DOD_TEST_PG_HOST (and DOD_TEST_PG_PORT / _USER / _PASSWORD if needed) to a PostgreSQL
 * server where that account may CREATE DATABASE. The test creates `dor_test_<random>`, and drops it
 * (WITH FORCE) afterwards, also when a test fails. No other database is read or written.
 *
 *   DOD_TEST_PG_HOST=/tmp npm test
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { hashPassword } from '../src/auth/authService.ts'
import { LoginLimiter } from '../src/auth/loginLimiter.ts'
import { loadConfig } from '../src/config/config.ts'
import { createContainer, type Container } from '../src/container.ts'
import { registerRoutes } from '../src/http/routes.ts'
import { createServer } from '../src/http/server.ts'
import { createLogger } from '../src/log/logger.ts'

const host = process.env.DOD_TEST_PG_HOST
const skip = host ? false : 'set DOD_TEST_PG_HOST to run the API integration tests on a temporary database'
const admin = { host, port: Number(process.env.DOD_TEST_PG_PORT || 5432), user: process.env.DOD_TEST_PG_USER || undefined, password: process.env.DOD_TEST_PG_PASSWORD || undefined }
const DB = `dor_test_${randomBytes(6).toString('hex')}`
const adminPassword = randomBytes(12).toString('base64url')
const viewerPassword = randomBytes(12).toString('base64url')

async function onServer(sql: string) {
  const c = new pg.Client({ ...admin, database: 'postgres' })
  await c.connect()
  try {
    await c.query(sql)
  } finally {
    await c.end()
  }
}

describe('DOD API on a temporary database', { skip }, () => {
  let k: Container
  let app: FastifyInstance
  let dir: string
  let created = false
  let t = 1_000_000
  const json = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, opts: { token?: string; body?: unknown; ip?: string } = {}) => {
    const r = await app.inject({ method, url, payload: opts.body as object | undefined, remoteAddress: opts.ip ?? '10.0.0.1', headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {} })
    return { status: r.statusCode, headers: r.headers, type: String(r.headers['content-type'] ?? ''), body: r.body ? JSON.parse(r.body) : null }
  }
  const login = (username: string, password: string, ip?: string) => json('POST', '/api/auth/login', { body: { username, password }, ip })

  before(async () => {
    await onServer(`CREATE DATABASE ${DB}`)
    created = true
    dir = await mkdtemp(join(tmpdir(), 'dod-api-test-'))
    const config = loadConfig({
      NODE_ENV: 'test',
      DOD_DB_HOST: admin.host,
      DOD_DB_PORT: String(admin.port),
      DOD_DB_NAME: DB,
      DOD_DB_USER: admin.user ?? process.env.USER ?? 'postgres',
      DOD_DB_PASSWORD: admin.password ?? '',
      DOD_ADMIN_PASSWORD: adminPassword,
      DOD_LOGIN_MAX_ATTEMPTS: '3',
      DOD_LOGIN_MAX_ATTEMPTS_PER_IP: '50',
    })
    const log = createLogger('silent', false)
    k = createContainer(config, log)
    await k.db.migrate()
    await k.auth.ensureAdmin()
    // Same limits as configured, on a clock the test controls.
    k.loginLimiter = new LoginLimiter(config.auth.loginLimit, () => t)
    await k.db.query("INSERT INTO dor_user (id, username, name, role, password_hash) VALUES ('u-viewer01', 'viewer', 'Viewer', 'viewer', $1)", [await hashPassword(viewerPassword)])
    app = createServer(config, log, k.auth)
    registerRoutes(app, k)
    await app.ready()
  })

  after(async () => {
    await app?.close()
    await k?.queryLog.flush().catch(() => undefined)
    await k?.db.close()
    if (dir) await rm(dir, { recursive: true, force: true })
    if (created) await onServer(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
  })

  test('migrations create the full schema', async () => {
    const r = await k.db.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
    const have = new Set(r.rows.map((x) => x.t))
    // Every table a migration creates exists (read from the migration files, so a new migration needs no edit here).
    const dir = new URL('../src/db/migrations/', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8'))
    // Tables a later migration removes (020: the Laporan PDF module, in a FOREACH ... ARRAY[...] DROP loop).
    const dropped = new Set(files.filter((sql) => /DROP TABLE/.test(sql)).flatMap((sql) => [...sql.matchAll(/ARRAY\[([^\]]+)\]/g)].flatMap((m) => [...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!))))
    const want = files.flatMap((sql) => [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!)).filter((t) => !dropped.has(t))
    assert.ok(want.length >= 20, `only ${want.length} tables found in the migrations`)
    for (const t of dropped) assert.ok(!have.has(t), `${t} is removed by a later migration`)
    assert.deepEqual(want.filter((w) => !have.has(w)), [])
    for (const t of ['dor_vehicle_card', 'dor_vehicle_cost', 'dor_block_budget']) assert.ok(have.has(t), t)
    // Tables of the removed modules are not created (Laporan Excel, curah hujan: dropped by 016; Publish: 017).
    for (const t of ['dor_xl_project', 'dor_xl_step', 'dor_xl_query', 'dor_rainfall_actual', 'dor_publish_template', 'dor_publish_template_version', 'dor_publish_template_file', 'dor_publication', 'dor_publication_version', 'dor_publish_run']) assert.ok(!have.has(t), t)
  })

  test('sign-in, /auth/me and sign-out', async () => {
    const s = await login('admin', adminPassword)
    assert.equal(s.status, 200)
    assert.equal(s.body.user.role, 'admin')
    assert.ok(!JSON.stringify(s.body).includes('password'))
    assert.equal((await json('GET', '/api/auth/me', { token: s.body.token })).body.username, 'admin')
    await json('POST', '/api/auth/logout', { token: s.body.token })
    assert.equal((await json('GET', '/api/auth/me', { token: s.body.token })).status, 401)
  })

  test('repeated failures are throttled with 429 + Retry-After, then recover', async () => {
    const ip = '10.0.0.50'
    for (let i = 0; i < 3; i++) {
      const r = await login('admin', 'wrong-password', ip)
      assert.equal(r.status, 401)
      assert.equal(r.body.error.code, 'INVALID_CREDENTIALS')
    }
    const blocked = await login('admin', adminPassword, ip)
    assert.equal(blocked.status, 429)
    assert.equal(blocked.body.error.code, 'TOO_MANY_ATTEMPTS')
    assert.equal(blocked.headers['retry-after'], '900')
    assert.ok(!('token' in blocked.body), 'no session while throttled, even with the right password')
    // Another client is unaffected.
    assert.equal((await login('admin', adminPassword, '10.0.0.51')).status, 200)
    t += 15 * 60_000
    assert.equal((await login('admin', adminPassword, ip)).status, 200)
  })

  test('public health shows the overall status only; details need a session', async () => {
    const anon = await json('GET', '/api/health/datawarehouse')
    assert.deepEqual(anon.body, { status: 'not_configured' })
    const bad = await json('GET', '/api/health/datawarehouse', { token: 'not-a-token' })
    assert.deepEqual(bad.body, { status: 'not_configured' })
    const s = await login('admin', adminPassword, '10.0.0.60')
    const full = await json('GET', '/api/health/datawarehouse', { token: s.body.token })
    assert.deepEqual(full.body, { status: 'not_configured', sources: [] })
    assert.equal((await json('GET', '/api/health/database')).body.status, 'up')
  })

  test('saved reports: name and category required, stay out of the dataset count, owner or admin removes', async () => {
    const layout = { scope: {}, filter: {}, dimensions: ['kebun'], measureLayout: [], measureSettings: {}, chartType: 'bar', chartBy: 'trend', table: { subtotal: true } }
    const admin = (await login('admin', adminPassword, '10.0.0.80')).body.token
    const viewer = (await login('viewer', viewerPassword, '10.0.0.81')).body.token
    await k.db.query("INSERT INTO dw_connection (id, name, db_type, environment, host, port, database_name, username, password_secret, schema_name, ssl_mode, connect_timeout_ms, command_timeout_ms) VALUES ('c-saved', 'c', 'postgresql', 'dev', 'h', 5432, 'd', 'u', '', 'public', 'disable', 1000, 1000)")
    await k.db.query("INSERT INTO dor_dataset (id, name, connection_id, schema_name, source_tables, semantic) VALUES ('d-saved', 'Produksi', 'c-saved', 'public', '{t}', '{}')")
    const cat = (await json('POST', '/api/categories', { token: admin, body: { name: 'Panen Laporan' } })).body
    const body = { name: 'Produksi per Kebun', categoryId: cat.id, datasetId: 'd-saved', layout }

    assert.equal((await json('POST', '/api/saved-reports', { body })).status, 401)
    assert.equal((await json('POST', '/api/saved-reports', { token: viewer, body: { ...body, name: ' ' } })).status, 400)
    assert.equal((await json('POST', '/api/saved-reports', { token: viewer, body: { ...body, categoryId: '' } })).status, 400)
    assert.equal((await json('POST', '/api/saved-reports', { token: viewer, body: { ...body, categoryId: 'cat-none' } })).status, 400)
    assert.equal((await json('POST', '/api/saved-reports', { token: viewer, body: { ...body, datasetId: 'd-none' } })).status, 400)

    const saved = await json('POST', '/api/saved-reports', { token: viewer, body })
    assert.equal(saved.status, 201)
    const list = (await json('GET', '/api/saved-reports', { token: admin })).body
    assert.equal(list.length, 1)
    assert.equal(list[0].datasetName, 'Produksi')
    assert.equal(list[0].createdByName, 'Viewer')
    assert.deepEqual(list[0].layout.dimensions, ['kebun'])
    const inMaster = (await json('GET', '/api/categories', { token: admin })).body.find((c: { id: string }) => c.id === cat.id)
    assert.equal(inMaster.datasetCount, 0, 'a saved report is not a dataset of the category')

    // PATCH keeps the id; only the owner or an administrator; nothing else (dataset, owner) can be changed.
    const id = saved.body.id
    const renamed = await json('PATCH', `/api/saved-reports/${id}`, { token: viewer, body: { name: 'Produksi per Kebun (v2)', layout: { ...layout, dimensions: ['kebun', 'afdeling'] } } })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body))
    assert.deepEqual([renamed.body.id, renamed.body.name, renamed.body.layout.dimensions, renamed.body.datasetId], [id, 'Produksi per Kebun (v2)', ['kebun', 'afdeling'], 'd-saved'])
    assert.ok(renamed.body.updatedAt >= saved.body.updatedAt)
    assert.equal((await json('PATCH', `/api/saved-reports/${id}`, { token: viewer, body: {} })).status, 400, 'nothing to change')
    assert.equal((await json('PATCH', `/api/saved-reports/${id}`, { token: viewer, body: { datasetId: 'd-other' } })).status, 400, 'the dataset is not changeable')
    assert.equal((await json('PATCH', `/api/saved-reports/${id}`, { token: viewer, body: { categoryId: 'cat-none' } })).status, 400)
    assert.equal((await json('PATCH', '/api/saved-reports/srp-tidak-ada', { token: viewer, body: { name: 'xx' } })).status, 404)
    assert.equal((await json('PATCH', `/api/saved-reports/${id}`, { body: { name: 'xx' } })).status, 401)
    const audit = await k.db.query<{ n: number }>("SELECT count(*)::int AS n FROM dor_audit WHERE action = 'saved-report.update' AND target = $1", [id])
    assert.equal(audit.rows[0]?.n, 1)

    const other = (await json('POST', '/api/saved-reports', { token: admin, body })).body
    assert.equal((await json('PATCH', `/api/saved-reports/${other.id}`, { token: viewer, body: { name: 'bukan milik saya' } })).status, 403)
    assert.equal((await json('PATCH', `/api/saved-reports/${id}`, { token: admin, body: { name: 'Produksi per Kebun' } })).status, 200, 'an administrator may change any report')
    assert.equal((await json('DELETE', `/api/saved-reports/${other.id}`, { token: viewer })).status, 403)
    assert.equal((await json('DELETE', `/api/saved-reports/${other.id}`, { token: admin })).status, 204)

    // Deleting the category or the dataset keeps the report listed, without them.
    assert.equal((await json('DELETE', `/api/categories/${cat.id}`, { token: admin })).status, 204)
    await k.db.query("DELETE FROM dor_dataset WHERE id = 'd-saved'")
    const [left] = (await json('GET', '/api/saved-reports', { token: viewer })).body
    assert.equal(left.categoryId, null)
    assert.equal(left.datasetName, null)
    assert.equal((await json('DELETE', `/api/saved-reports/${left.id}`, { token: viewer })).status, 204)
  })

  test('API errors are JSON, also for unknown endpoints', async () => {
    const s = await login('admin', adminPassword, '10.0.0.80')
    const r = await json('GET', '/api/does-not-exist', { token: s.body.token })
    assert.equal(r.status, 404)
    assert.match(r.type, /application\/json/)
    assert.equal(r.body.error.code, 'NOT_FOUND')
    const anon = await json('GET', '/api/does-not-exist')
    assert.equal(anon.status, 401)
    assert.match(anon.type, /application\/json/)
  })
})

/**
 * ClickHouse is an optional add-on: with a configured ClickHouse source that cannot be reached, the
 * health check reports it, and sign-in, categories, reports and the catalog still work. Own temporary database, dropped afterwards; the unreachable source is 127.0.0.1:1.
 */
describe('DOD API with an unreachable ClickHouse source', { skip }, () => {
  const db = `dor_test_${randomBytes(6).toString('hex')}`
  const password = randomBytes(12).toString('base64url')
  let k: Container
  let app: FastifyInstance
  let dir: string
  let created = false
  const json = async (method: 'GET' | 'POST' | 'DELETE', url: string, token?: string, body?: unknown) => {
    const r = await app.inject({ method, url, payload: body as object | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} })
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }
  }

  before(async () => {
    // Source passwords are read from process.env when used; without one the source is "not configured".
    process.env.DOD_DW_CHDOWN_PASSWORD = 'unused-test-password'
    await onServer(`CREATE DATABASE ${db}`)
    created = true
    dir = await mkdtemp(join(tmpdir(), 'dod-api-test-'))
    const config = loadConfig({
      NODE_ENV: 'test',
      DOD_DB_HOST: admin.host,
      DOD_DB_PORT: String(admin.port),
      DOD_DB_NAME: db,
      DOD_DB_USER: admin.user ?? process.env.USER ?? 'postgres',
      DOD_DB_PASSWORD: admin.password ?? '',
      DOD_ADMIN_PASSWORD: password,
      DOD_DW_CONNECTIONS: 'CHDOWN',
      DOD_DW_CHDOWN_TYPE: 'clickhouse',
      DOD_DW_CHDOWN_HOST: '127.0.0.1',
      DOD_DW_CHDOWN_PORT: '1',
      DOD_DW_CHDOWN_DATABASE: 'doreportwarehouse',
      DOD_DW_CHDOWN_USERNAME: 'dor',
      DOD_DW_CHDOWN_CONNECT_TIMEOUT_MS: '1000',
    })
    const log = createLogger('silent', false)
    k = createContainer(config, log)
    await k.db.migrate()
    await k.auth.ensureAdmin()
    await k.dw.syncFromConfig()
    app = createServer(config, log, k.auth)
    registerRoutes(app, k)
    await app.ready()
  })

  after(async () => {
    await app?.close()
    await k?.queryLog.flush().catch(() => undefined)
    await k?.sources.closeAll().catch(() => undefined)
    await k?.db.close()
    if (dir) await rm(dir, { recursive: true, force: true })
    if (created) await onServer(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`)
    delete process.env.DOD_DW_CHDOWN_PASSWORD
  })

  test('health reports the source as down; core functions keep working', async () => {
    const anon = await json('GET', '/api/health/datawarehouse')
    assert.equal(anon.status, 503)
    assert.deepEqual(anon.body, { status: 'degraded' })

    const s = await json('POST', '/api/auth/login', undefined, { username: 'admin', password })
    assert.equal(s.status, 200)
    const token = s.body.token as string
    const full = await json('GET', '/api/health/datawarehouse', token)
    assert.equal(full.body.sources.length, 1)
    assert.equal(full.body.sources[0].id, 'chdown')
    assert.equal(full.body.sources[0].status, 'down')
    assert.ok(!JSON.stringify(full.body).includes('127.0.0.1'), 'no host in the health response')

    assert.equal((await json('GET', '/api/health/database')).body.status, 'up')
    assert.equal((await json('GET', '/api/dw/connections', token)).status, 200)
    assert.deepEqual((await json('GET', '/api/dw/catalog', token)).body, { datasets: [] })
    assert.equal((await json('GET', '/api/saved-reports', token)).status, 200)
    const c = await json('POST', '/api/categories', token, { name: 'Tanpa ClickHouse' })
    assert.equal(c.status, 201)
    assert.equal((await json('DELETE', `/api/categories/${c.body.id}`, token)).status, 204)
  })
})
