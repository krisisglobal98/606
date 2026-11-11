/**
 * Test Connection and source error classification, for ClickHouse and PostgreSQL.
 *
 *   npm test                      (from server/, reads ../.env)
 *
 * Integration cases use the connections configured in .env. The ClickHouse host is overridden with
 * DOD_TEST_CLICKHOUSE_HOST (default localhost), so a test ClickHouse can run next to the API. Cases whose
 * source is unreachable are skipped.
 * DOD's metadata DB is replaced by an in-memory stub, so tests write nothing.
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { loadConfig, type Config, type SourceConnectionConfig } from '../src/config/config.ts'
import type { MetadataDb } from '../src/db/metadataDb.ts'
import { ClickHouseMetadataService } from '../src/dw/clickhouseMetadataService.ts'
import { DataWarehouseService } from '../src/dw/dataWarehouseService.ts'
import { MetadataService } from '../src/dw/metadata.ts'
import { PostgresMetadataService } from '../src/dw/postgresMetadataService.ts'
import { SourceRegistry } from '../src/dw/sourceRegistry.ts'
import { toSourceError } from '../src/http/errors.ts'
import { createLogger } from '../src/log/logger.ts'
import { QueryLog } from '../src/log/queryLog.ts'

const CH_HOST = process.env.DOD_TEST_CLICKHOUSE_HOST || 'localhost'

/** Stub of DOD's metadata DB: accepts every statement, returns no rows. */
const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as MetadataDb
const log = createLogger('silent', false)

function stack(env: NodeJS.ProcessEnv) {
  const config: Config = loadConfig(env)
  const sources = new SourceRegistry(config, log, new QueryLog(db, log))
  const meta = new MetadataService(new PostgresMetadataService(sources, config), new ClickHouseMetadataService(sources, config))
  const dw = new DataWarehouseService(db, sources, meta, log)
  return { config, sources, dw }
}

/** A ClickHouse connection from .env (prefix CLICKHOUSE) with the host overridden; extra vars win. */
function clickhouse(extra: NodeJS.ProcessEnv = {}) {
  return stack({ ...process.env, DOD_DW_CONNECTIONS: 'CLICKHOUSE', DOD_DW_CLICKHOUSE_TYPE: 'clickhouse', DOD_DW_CLICKHOUSE_HOST: CH_HOST, ...extra })
}

/**
 * The CLICKHOUSE connection under the test-only prefix CHTEST, with its own password variable.
 * Passwords are read from process.env when a client opens (never from the config object), so the
 * variable is set on process.env for the duration of one test and removed afterwards.
 */
async function clickhouseWithPassword(password: string | undefined, run: (k: ReturnType<typeof stack>) => Promise<void>) {
  const copy = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('DOD_DW_CLICKHOUSE_')).map(([k, v]) => [k.replace('DOD_DW_CLICKHOUSE_', 'DOD_DW_CHTEST_'), v]))
  const k = stack({ ...process.env, ...copy, DOD_DW_CONNECTIONS: 'CHTEST', DOD_DW_CHTEST_TYPE: 'clickhouse', DOD_DW_CHTEST_HOST: CH_HOST })
  open.push(k.sources)
  if (password === undefined) delete process.env.DOD_DW_CHTEST_PASSWORD
  else process.env.DOD_DW_CHTEST_PASSWORD = password
  try {
    await run(k)
  } finally {
    delete process.env.DOD_DW_CHTEST_PASSWORD
  }
}

async function reachable(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok
  } catch {
    return false
  }
}

const chConfigured = !!process.env.DOD_DW_CLICKHOUSE_PASSWORD
const chUp = chConfigured && (await reachable(`${process.env.DOD_DW_CLICKHOUSE_PROTOCOL || 'http'}://${CH_HOST}:${process.env.DOD_DW_CLICKHOUSE_PORT || '8123'}/ping`))
const chSkip = !chConfigured ? 'DOD_DW_CLICKHOUSE_* not configured' : !chUp ? `ClickHouse not reachable on ${CH_HOST}` : false

const open: SourceRegistry[] = []
after(async () => {
  await Promise.all(open.map((s) => s.closeAll()))
})

describe('ClickHouse', () => {
  test('SELECT 1 succeeds', { skip: chSkip }, async () => {
    const { sources, dw } = clickhouse()
    open.push(sources)
    const r = await sources.run<{ test: number }>(dw.config('clickhouse'), 'SELECT 1 AS test', [], { kind: 'test', timeoutMs: 5000 })
    assert.deepEqual(r.rows, [{ test: 1 }])
  })

  test('successful Test Connection returns connected, never SOURCE_DNS_FAILURE', { skip: chSkip }, async () => {
    const { sources, dw } = clickhouse()
    open.push(sources)
    const t = await dw.test('clickhouse', null)
    assert.equal(t.error?.code, undefined, `unexpected error ${t.error?.code}`)
    assert.equal(t.ok, true)
    assert.equal(t.status, 'connected')
    assert.match(t.serverVersion ?? '', /^ClickHouse /)
    assert.equal(t.schema.available, true)
    assert.equal(t.readOnly?.session, true)
  })

  test('unresolvable host maps to SOURCE_DNS_FAILURE', { skip: chConfigured ? false : 'DOD_DW_CLICKHOUSE_* not configured' }, async () => {
    const { sources, dw } = clickhouse({ DOD_DW_CLICKHOUSE_HOST: 'dod-no-such-host.invalid' })
    open.push(sources)
    const t = await dw.test('clickhouse', null)
    assert.equal(t.ok, false)
    assert.equal(t.status, 'failed')
    assert.equal(t.error?.code, 'SOURCE_DNS_FAILURE')
  })

  test('refused port maps to SOURCE_NETWORK_FAILURE', { skip: chConfigured ? false : 'DOD_DW_CLICKHOUSE_* not configured' }, async () => {
    const { sources, dw } = clickhouse({ DOD_DW_CLICKHOUSE_HOST: '127.0.0.1', DOD_DW_CLICKHOUSE_PORT: '1' })
    open.push(sources)
    const t = await dw.test('clickhouse', null)
    assert.equal(t.error?.code, 'SOURCE_NETWORK_FAILURE')
  })

  test('wrong password maps to SOURCE_AUTH_FAILED', { skip: chSkip }, async () => {
    await clickhouseWithPassword('dod-test-wrong-password', async ({ dw }) => {
      const t = await dw.test('chtest', null)
      assert.equal(t.ok, false)
      assert.equal(t.status, 'failed')
      assert.equal(t.error?.code, 'SOURCE_AUTH_FAILED')
    })
  })

  test('missing password reports not_configured without connecting', { skip: chConfigured ? false : 'DOD_DW_CLICKHOUSE_* not configured' }, async () => {
    await clickhouseWithPassword(undefined, async ({ dw }) => {
      const t = await dw.test('chtest', null)
      assert.equal(t.status, 'not_configured')
      assert.equal(t.error?.code, 'SOURCE_NOT_CONFIGURED')
    })
  })
})

describe('error classification', () => {
  const cases: [string, object, string][] = [
    ['DNS ENOTFOUND', { code: 'ENOTFOUND', syscall: 'getaddrinfo' }, 'SOURCE_DNS_FAILURE'],
    ['DNS EAI_AGAIN', { code: 'EAI_AGAIN', syscall: 'getaddrinfo' }, 'SOURCE_DNS_FAILURE'],
    ['refused', { code: 'ECONNREFUSED' }, 'SOURCE_NETWORK_FAILURE'],
    ['ClickHouse AUTHENTICATION_FAILED', { code: '516', type: 'AUTHENTICATION_FAILED', message: 'dor_admin: Authentication failed' }, 'SOURCE_AUTH_FAILED'],
    ['ClickHouse REQUIRED_PASSWORD', { code: '194', type: 'REQUIRED_PASSWORD' }, 'SOURCE_AUTH_FAILED'],
    ['ClickHouse UNKNOWN_DATABASE', { code: '81', type: 'UNKNOWN_DATABASE' }, 'SOURCE_SCHEMA_UNAVAILABLE'],
    ['ClickHouse UNKNOWN_TABLE', { code: '60', type: 'UNKNOWN_TABLE' }, 'SOURCE_TABLE_UNAVAILABLE'],
    ['ClickHouse TIMEOUT_EXCEEDED', { code: '159', type: 'TIMEOUT_EXCEEDED' }, 'SOURCE_TIMEOUT'],
    ['ClickHouse READONLY', { code: '164', type: 'READONLY' }, 'SOURCE_READ_ONLY_VIOLATION'],
    ['ClickHouse unknown server error', { code: '62', type: 'SYNTAX_ERROR' }, 'SOURCE_QUERY_FAILED'],
    // PostgreSQL mappings are unchanged.
    ['PostgreSQL bad password', { code: '28P01' }, 'SOURCE_AUTH_FAILED'],
    ['PostgreSQL statement_timeout', { code: '57014' }, 'SOURCE_TIMEOUT'],
    ['PostgreSQL permission', { code: '42501' }, 'SOURCE_PERMISSION_DENIED'],
    ['PostgreSQL unknown table', { code: '42P01' }, 'SOURCE_TABLE_UNAVAILABLE'],
    ['PostgreSQL read-only transaction', { code: '25006' }, 'SOURCE_READ_ONLY_VIOLATION'],
    ['PostgreSQL connect timeout', { message: 'Connection terminated due to connection timeout' }, 'SOURCE_NETWORK_FAILURE'],
  ]
  for (const [name, err, code] of cases) test(name, () => assert.equal(toSourceError(Object.assign(new Error(), err)).code, code))
})

describe('PostgreSQL connect backoff', () => {
  test('a connection that failed to connect answers with the same error without reconnecting, until cleared', async () => {
    process.env.DOD_DW_PGDOWN_PASSWORD = 'x'
    try {
      const { sources, dw } = stack({ DOD_DW_CONNECTIONS: 'PGDOWN', DOD_DW_PGDOWN_TYPE: 'postgresql', DOD_DW_PGDOWN_HOST: '127.0.0.1', DOD_DW_PGDOWN_PORT: '1', DOD_DW_PGDOWN_DATABASE: 'x', DOD_DW_PGDOWN_USERNAME: 'x', DOD_DW_PGDOWN_SSL_MODE: 'disable' })
      open.push(sources)
      const c = dw.config('pgdown')
      const q = () => sources.run(c, 'SELECT 1', [], { kind: 'test', timeoutMs: 2000 }).then(() => null, (e: unknown) => e)
      const first = await q()
      assert.equal((first as { code?: string }).code, 'SOURCE_NETWORK_FAILURE')
      const t0 = performance.now()
      const second = await q()
      assert.equal(second, first, 'the stored failure is returned')
      assert.ok(performance.now() - t0 < 50, 'no new connection attempt')
      sources.clearBackoff(c.id)
      const third = await q()
      assert.notEqual(third, first, 'after clearing, it connects again')
      assert.equal((third as { code?: string }).code, 'SOURCE_NETWORK_FAILURE')
    } finally {
      delete process.env.DOD_DW_PGDOWN_PASSWORD
    }
  })
})

describe('PostgreSQL', () => {
  const prefix = (process.env.DOD_DW_CONNECTIONS ?? '').split(',').map((s) => s.trim().toUpperCase()).find((p) => p && (process.env[`DOD_DW_${p}_TYPE`] ?? 'postgresql') === 'postgresql' && process.env[`DOD_DW_${p}_PASSWORD`])

  test('Test Connection still reports a PostgreSQL server', { skip: prefix ? false : 'no PostgreSQL source configured' }, async (t) => {
    const { sources, dw } = stack({ ...process.env, DOD_DW_CONNECTIONS: prefix })
    open.push(sources)
    const c: SourceConnectionConfig = dw.config(prefix!.toLowerCase().replace(/_/g, '-'))
    assert.equal(c.dbType, 'postgresql')
    const r = await dw.test(c.id, null)
    if (!r.ok && ['SOURCE_DNS_FAILURE', 'SOURCE_NETWORK_FAILURE'].includes(r.error?.code ?? '')) return t.skip(`${c.id} not reachable`)
    assert.equal(r.ok, true, r.error?.code)
    assert.match(r.serverVersion ?? '', /^PostgreSQL /)
    assert.equal(r.readOnly?.session, true)
  })

  test('unresolvable host maps to SOURCE_DNS_FAILURE', { skip: prefix ? false : 'no PostgreSQL source configured' }, async () => {
    const { sources, dw } = stack({ ...process.env, DOD_DW_CONNECTIONS: prefix, [`DOD_DW_${prefix}_HOST`]: 'dod-no-such-host.invalid' })
    open.push(sources)
    const r = await dw.test(prefix!.toLowerCase().replace(/_/g, '-'), null)
    assert.equal(r.error?.code, 'SOURCE_DNS_FAILURE')
  })
})
