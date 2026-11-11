/**
 * Connections from the server environment (.env) for every source type, and the MySQL / MongoDB / Redis
 * drivers.
 *
 *   npm test                      (from server/)
 *
 * Unit cases always run. Integration cases connect to throwaway local servers given by
 * DOD_TEST_MYSQL / DOD_TEST_MONGODB / DOD_TEST_REDIS ("host:port:user:password", user may be empty);
 * each is skipped when its variable is not set.
 * DOD's metadata DB is an in-memory stub, so nothing is persisted.
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { loadConfig, type SourceDbType } from '../src/config/config.ts'
import type { MetadataDb } from '../src/db/metadataDb.ts'
import { ClickHouseMetadataService } from '../src/dw/clickhouseMetadataService.ts'
import { DataWarehouseService } from '../src/dw/dataWarehouseService.ts'
import { capabilitiesOf, MetadataService } from '../src/dw/metadata.ts'
import { MongoMetadataService } from '../src/dw/mongoMetadataService.ts'
import { MysqlMetadataService } from '../src/dw/mysqlMetadataService.ts'
import { PostgresMetadataService } from '../src/dw/postgresMetadataService.ts'
import { RedisMetadataService } from '../src/dw/redisMetadataService.ts'
import { SourceRegistry } from '../src/dw/sourceRegistry.ts'
import { toSourceError } from '../src/http/errors.ts'
import { createLogger } from '../src/log/logger.ts'
import { QueryLog } from '../src/log/queryLog.ts'

const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as MetadataDb
const log = createLogger('silent', false)
const open: SourceRegistry[] = []
after(() => Promise.all(open.map((s) => s.closeAll())))

/** One connection under prefix T, defined as in .env; the password is set on process.env meanwhile. */
async function withEnv<T>(fields: Record<string, string | number | undefined>, password: string | undefined, run: (k: ReturnType<typeof stack>) => Promise<T>): Promise<T> {
  const env: NodeJS.ProcessEnv = { DOD_DW_CONNECTIONS: 'T' }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') env[`DOD_DW_T_${k}`] = String(v)
  const k = stack(env)
  if (password === undefined) delete process.env.DOD_DW_T_PASSWORD
  else process.env.DOD_DW_T_PASSWORD = password
  try {
    return await run(k)
  } finally {
    delete process.env.DOD_DW_T_PASSWORD
  }
}

function stack(env: NodeJS.ProcessEnv) {
  const config = loadConfig(env)
  const sources = new SourceRegistry(config, log, new QueryLog(db, log))
  open.push(sources)
  const meta = new MetadataService(
    new PostgresMetadataService(sources, config),
    new ClickHouseMetadataService(sources, config),
    { mysql: new MysqlMetadataService(sources, config), mongodb: new MongoMetadataService(sources, config), redis: new RedisMetadataService(sources) },
  )
  return { config, sources, meta, dw: new DataWarehouseService(db, sources, meta, log) }
}


describe('connections in .env', () => {
  const cfg = (fields: Record<string, string>) => () => loadConfig({ DOD_DW_CONNECTIONS: 'T', ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [`DOD_DW_T_${k}`, v])) })
  test('required fields depend on the type', () => {
    assert.throws(cfg({ TYPE: 'mysql', HOST: 'db', DATABASE: 'x' }), /USERNAME wajib/, 'MySQL needs a user')
    assert.throws(cfg({ TYPE: 'postgresql', DATABASE: 'x', USERNAME: 'u' }), /HOST wajib/, 'PostgreSQL needs a host')
    assert.equal(cfg({ TYPE: 'redis', HOST: 'cache' })().connections[0]!.database, '0', 'Redis: host only, database 0')
    assert.throws(cfg({ TYPE: 'sqlite', DATABASE: 'kebun.db' }), /TYPE/, 'a type outside the supported list (removed types included) is refused')
    assert.throws(cfg({ TYPE: 'mongodb', HOST: 'db; rm -rf', DATABASE: 'x' }), /HOST/, 'host is validated')
    assert.throws(cfg({ TYPE: 'redis', HOST: 'cache', DATABASE: 'abc' }), /Redis/, 'Redis database is a number')
  })
  test('a listed prefix without any variable is skipped, not fatal', () => {
    const c = loadConfig({ DOD_DW_CONNECTIONS: 'GONE,T', DOD_DW_T_TYPE: 'redis', DOD_DW_T_HOST: 'cache' })
    assert.deepEqual(c.connections.map((x) => x.id), ['t'])
    assert.deepEqual(c.skippedConnections, ['GONE'])
  })
  test('the connection id comes from the prefix; the browser list has no host, database, account or password', async () => {
    await withEnv({ TYPE: 'postgresql', NAME: 'Kebun', HOST: 'db.internal', DATABASE: 'kebun', USERNAME: 'reader' }, 'sangat-rahasia', async ({ dw }) => {
      const [c] = await dw.list()
      assert.equal(c!.id, 't')
      assert.equal(c!.name, 'Kebun')
      assert.equal(c!.secretConfigured, true)
      const json = JSON.stringify(c)
      for (const s of ['db.internal', 'reader', 'sangat-rahasia', 'DOD_DW_T_PASSWORD']) assert.ok(!json.includes(s), `${s} not exposed`)
    })
  })
  test('without its password a PostgreSQL connection is not configured and never dialled', async () => {
    await withEnv({ TYPE: 'postgresql', HOST: '127.0.0.1', PORT: 1, DATABASE: 'x', USERNAME: 'u', SSL_MODE: 'disable' }, undefined, async ({ dw, sources }) => {
      assert.equal((await dw.list())[0]!.status, 'not_configured')
      await assert.rejects(sources.run(dw.config('t'), 'SELECT 1', [], { kind: 'test', timeoutMs: 1000 }), (e: { code?: string }) => e.code === 'SOURCE_NOT_CONFIGURED')
    })
  })
  test('capabilities: datasets only on PostgreSQL / ClickHouse', () => {
    for (const t of ['mysql', 'mongodb', 'redis'] as SourceDbType[]) assert.deepEqual(capabilitiesOf(t), { preview: false, profile: false, exactCount: false, dataset: false })
    assert.equal(capabilitiesOf('postgresql').dataset, true)
  })
  test('driver errors are classified without echoing details', () => {
    assert.equal(toSourceError({ code: 'ER_ACCESS_DENIED_ERROR', message: "Access denied for user 'x'@'10.0.0.1'" }).code, 'SOURCE_AUTH_FAILED')
    assert.equal(toSourceError({ codeName: 'AuthenticationFailed', message: 'bad' }).code, 'SOURCE_AUTH_FAILED')
    assert.equal(toSourceError({ message: 'WRONGPASS invalid username-password pair' }).code, 'SOURCE_AUTH_FAILED')
    assert.equal(toSourceError({ name: 'MongoServerSelectionError', message: 'connect ECONNREFUSED' }).code, 'SOURCE_NETWORK_FAILURE')
    assert.ok(!toSourceError({ code: 'ER_ACCESS_DENIED_ERROR', message: "Access denied for user 'x'" }).message.includes("'x'"))
  })
  test('a refused port is reported as a network failure and leaves nothing open', async () => {
    await withEnv({ TYPE: 'mysql', HOST: '127.0.0.1', PORT: 1, DATABASE: 'x', USERNAME: 'u', CONNECT_TIMEOUT_MS: 1000 }, 'p', async ({ dw }) => {
      const r = await dw.test('t', null)
      assert.equal(r.ok, false)
      assert.equal(r.error?.code, 'SOURCE_NETWORK_FAILURE')
      assert.ok(!JSON.stringify(r).includes('"p"'))
    })
  })
})

/** "host:port:user:password" → .env fields + password. */
function target(v: string | undefined) {
  if (!v) return null
  const [host, port, username, ...pw] = v.split(':')
  return { fields: { HOST: host!, PORT: Number(port), USERNAME: username || undefined, SSL_MODE: 'disable' }, password: pw.join(':') || undefined }
}

/** Test, then browse as the dataset builder does: schemas → tables → table. */
async function check(type: SourceDbType, t: { fields: Record<string, string | number | undefined>; password?: string } | null, database: string, schema: string, table: string, password?: string) {
  return withEnv({ TYPE: type, DATABASE: database, ...(t?.fields ?? {}) }, password ?? t?.password, async ({ dw, meta }) => {
    const r = await dw.test('t', null)
    if (!r.ok) return { r, b: null }
    const c = dw.config('t')
    const b = { schemas: await meta.schemas(c, undefined, true), tables: await meta.tables(c, schema, undefined, true), t: await meta.table(c, schema, table, undefined, true) }
    return { r, b }
  })
}

const my = target(process.env.DOD_TEST_MYSQL)
describe('MySQL', { skip: !my && 'DOD_TEST_MYSQL not set' }, () => {
  test('test, wrong password, browse', async () => {
    const { r, b } = await check('mysql', my, 'kebun', 'kebun', 'panen')
    assert.equal(r.ok, true, r.error?.message)
    assert.match(r.serverVersion ?? '', /^MySQL 8/)
    assert.equal(r.readOnly?.session, true)
    assert.equal((await check('mysql', my, 'kebun', 'kebun', 'panen', 'salah')).r.error?.code, 'SOURCE_AUTH_FAILED')
    assert.ok(b!.schemas.some((s) => s.name === 'kebun'))
    assert.ok(b!.tables.some((t) => t.name === 'panen'))
    assert.deepEqual(b!.t.columns.map((c) => [c.name, c.typeCategory]), [['id', 'number'], ['tanggal', 'date'], ['blok', 'string'], ['kg', 'number']])
    assert.ok(b!.t.indexes.some((i) => i.primary))
  })
})

const mg = target(process.env.DOD_TEST_MONGODB)
describe('MongoDB', { skip: !mg && 'DOD_TEST_MONGODB not set' }, () => {
  test('test, wrong password, browse', async () => {
    const { r, b } = await check('mongodb', mg, 'kebun', 'kebun', 'pemupukan')
    assert.equal(r.ok, true, r.error?.message)
    assert.match(r.serverVersion ?? '', /^MongoDB 8/)
    assert.equal((await check('mongodb', mg, 'kebun', 'kebun', 'pemupukan', 'salah')).r.error?.code, 'SOURCE_AUTH_FAILED')
    assert.equal(b!.tables.find((t) => t.name === 'pemupukan')?.estimatedRows, 3)
    const cols = Object.fromEntries(b!.t.columns.map((c) => [c.name, c.typeCategory]))
    assert.equal(cols.dosis_kg, 'number')
    assert.equal(cols.tanggal, 'date')
    assert.equal(cols.blok, 'string')
  })
})

const rd = target(process.env.DOD_TEST_REDIS)
describe('Redis', { skip: !rd && 'DOD_TEST_REDIS not set' }, () => {
  test('test, wrong password, browse key groups', async () => {
    const { r, b } = await check('redis', rd, '', 'db0', 'panen:*')
    assert.equal(r.ok, true, r.error?.message)
    assert.match(r.serverVersion ?? '', /^Redis/)
    assert.equal((await check('redis', rd, '', 'db0', 'panen:*', 'salah')).r.error?.code, 'SOURCE_AUTH_FAILED')
    assert.equal(b!.tables.find((t) => t.name === 'panen:*')?.estimatedRows, 2)
    assert.deepEqual(b!.t.columns.map((c) => c.name), ['key', 'blok', 'kg'])
  })
})
