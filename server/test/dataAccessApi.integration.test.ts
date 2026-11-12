/**
 * Data access, end to end through the real HTTP routes (Fastify inject) and real SQL on PostgreSQL:
 * analytics query, grid (pivot, drilldown, paging), distinct values (search) and catalog (status, coverage), for
 * users of every level — called directly, as an attacker would, not through the UI.
 *
 * The source tables are TEMP tables created inside ONE transaction that is rolled back at the end, on the
 * application database of .env (DOD_DB_*): nothing is created, changed or left behind. Skipped without DOD_DB_HOST.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { AnalyticsService } from '../src/analytics/analyticsService.ts'
import { ResultCache } from '../src/analytics/resultCache.ts'
import type { User } from '../src/auth/authService.ts'
import type { Container } from '../src/container.ts'
import { DataAccessService } from '../src/dataAccess/dataAccessService.ts'
import type { MetadataDb } from '../src/db/metadataDb.ts'
import { DatasetService } from '../src/datasets/datasetService.ts'
import type { QueryEngine } from '../src/dw/queryEngine.ts'
import { registerRoutes } from '../src/http/routes.ts'
import { createServer } from '../src/http/server.ts'
import { createLogger } from '../src/log/logger.ts'
import { accessConfig, ACTUAL_ROWS, asg, BUDGET_ROWS, dataset, fakeDb, ID, noBu, nonPims, snapshot, tables, TEMP_SQL, UPDATED, user } from './support/dataAccessFixture.ts'

const host = process.env.DOD_DB_HOST
const skip = host ? false : 'set DOD_DB_* (.env) to run the SQL/API data access tests on TEMP tables'
const log = createLogger('silent', false)

describe('data access through the API on PostgreSQL (TEMP tables, rolled back)', { skip }, () => {
  let client: pg.Client
  let app: FastifyInstance
  let access: DataAccessService
  let datasets: DatasetService
  const users = new Map<string, User>()
  const f = fakeDb()
  const DS = { ok: dataset('ds-ok'), partial: dataset('ds-partial'), none: dataset('ds-none', noBu()), nonpims: dataset('ds-nonpims', nonPims()), unverified: dataset('ds-unverified') }

  const tok = (name: string, role: User['role'], ...assignments: Parameters<typeof asg>[0][]) => {
    const u = user(name, role)
    users.set(`t-${name}`, u)
    f.assignments.set(u.id, assignments.map(asg))
  }

  before(async () => {
    client = new pg.Client({ host, port: Number(process.env.DOD_DB_PORT || 5432), database: process.env.DOD_DB_NAME, user: process.env.DOD_DB_USER, password: process.env.DOD_DB_PASSWORD, application_name: 'dod-test-data-access',
      // As the source registry: date/timestamp stay wall-clock strings.
      types: { getTypeParser: ((oid: number, format?: 'text' | 'binary') => (oid === 1114 || oid === 1082 ? (v: string) => v : pg.types.getTypeParser(oid, format))) as never } })
    await client.connect()
    await client.query('BEGIN')
    for (const sql of TEMP_SQL) await client.query(sql)
    for (const r of ACTUAL_ROWS) await client.query('INSERT INTO t_act (tanggal, business_unit, groupcode, regioncode, company, ray, afd, ownership, produksi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', r)
    for (const r of BUDGET_ROWS) await client.query('INSERT INTO t_bud (tanggal, kodebisnisunit, produksi_b) VALUES ($1,$2,$3)', r)

    // Validations (K-13): ok, partial; ds-unverified has none.
    for (const [id, status] of [['ds-ok', 'ok'], ['ds-partial', 'partial'], ['ds-none', 'ok'], ['ds-nonpims', 'ok']] as const)
      f.validations.set(id, { status, dataset_updated_at: new Date(UPDATED), checked_at: new Date(), detail: { unmappedShare: id === 'ds-partial' ? 0.1 : 0 } })

    tok('sam1', 'viewer', { level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 })
    tok('frg', 'viewer', { level: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG })
    tok('own', 'viewer', { level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, ownership: ['PLASMA'] }, { level: 'OWNERSHIP', orgLevel: 'COMPANY', orgKind: 'ms_company', orgId: ID.SAM, ownership: ['INTI'] })
    tok('rayon', 'viewer', { level: 'RAYON', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: ID.RAYON_A })
    tok('div', 'viewer', { level: 'DIVISION', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_division', subId: ID.DIV02 })
    tok('gmk', 'viewer', { level: 'GMK', orgKind: 'ms_gmk_header', orgId: ID.GMK1 })
    tok('wil', 'viewer', { level: 'WILAYAH', orgKind: 'ms_so_node', orgId: ID.N_DP_RIAU_1 })
    tok('region', 'viewer', { level: 'REGION', orgKind: 'ms_region', orgId: ID.PKU })
    tok('company', 'viewer', { level: 'COMPANY', orgKind: 'ms_company', orgId: ID.SAM })
    tok('admin', 'admin')
    tok('auditor', 'viewer')
    tok('nobody', 'viewer')
    tok('multi', 'viewer', { level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 }, { level: 'GMK', orgKind: 'ms_gmk_header', orgId: ID.GMK1 })

    const config = { ...accessConfig(), api: { trustedProxies: [], corsOrigin: null } } as never
    // A SAVEPOINT per statement: one failing statement must not abort the test transaction for the next ones.
    const run = async (sql: string, params: unknown[]) => {
      await client.query('SAVEPOINT q')
      try {
        const r = await client.query(sql, params)
        await client.query('RELEASE SAVEPOINT q')
        return r
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT q')
        if (process.env.DOD_TEST_DEBUG) console.error('SQL failed', (e as { code?: string; message?: string }).code, (e as Error).message, sql.slice(0, 2000))
        throw e
      }
    }
    const engine: QueryEngine = { execute: async (r) => ({ rows: (await run(r.sql, r.params)).rows, durationMs: 0 }) } as QueryEngine
    const all = Object.values(DS)
    const row = (d: (typeof all)[number]) => ({ id: d.id, name: d.name, description: '', connection_id: 'pg', schema_name: 'pg_temp', source_tables: d.sourceTables, status: 'active', semantic: d.semantic, category_id: null, category_name: null, parent_id: null, parent_name: null, created_by: null, created_at: new Date(UPDATED), updated_at: new Date(UPDATED) })
    const metaDb = { query: async (sql: string, p: unknown[] = []) => ({ rows: /WHERE d\.id = \$1/.test(sql) ? all.filter((d) => d.id === p[0]).map(row) : all.map(row) }) } as unknown as MetadataDb
    const conn = { id: 'pg', name: 'PG', dbType: 'postgresql', environment: 'test', capabilities: { dataset: true } }
    datasets = new DatasetService(metaDb, { config: () => conn } as never, { get: () => conn, run: async (_c: unknown, sql: string, values: unknown[]) => ({ rows: (await run(sql, values)).rows }) } as never, { table: async (_c: unknown, _s: string, t: string) => tables[t]! } as never, config)
    access = new DataAccessService(f.db, config, log, async () => snapshot())
    // The result cache is ON for every test here: all scope checks below also prove it never crosses scopes.
    const resultCache = new ResultCache(60_000)
    const k = {
      version: 'test', config, log, db: {}, dw: {}, meta: {}, query: engine, datasets, dataAccess: access, resultCache, analytics: new AnalyticsService(datasets, engine, config, access, resultCache),
      access: { check: async () => {}, menusFor: async () => [] }, auth: {}, loginLimiter: {}, savedReports: {}, users: {}, profile: {}, categories: {},
    } as unknown as Container
    app = createServer(config, log, { userForToken: async (t: string | null) => users.get(t ?? '') ?? (() => { throw Object.assign(new Error('x'), { statusCode: 401 }) })() } as never)
    registerRoutes(app, k)
    await app.ready()
  })

  after(async () => {
    await app?.close()
    await client?.query('ROLLBACK').catch(() => undefined)
    await client?.end()
  })

  const call = async (method: 'GET' | 'POST', url: string, token: string, body?: unknown) => {
    const r = await app.inject({ method, url, payload: body as object | undefined, headers: { authorization: `Bearer t-${token}` } })
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }
  }
  const Q = (datasetId = 'ds-ok', over: Record<string, unknown> = {}) => ({ datasetId, scope: {}, filter: { dateFrom: '2026-01-01', dateTo: '2026-12-31' }, dimensions: ['bisnis_unit'], measures: ['produksi', 'budget_produksi'], chartBy: 'bisnis_unit', ...over })
  const query = (token: string, datasetId?: string, over?: Record<string, unknown>) => call('POST', '/api/dw/analytics/query', token, Q(datasetId, over))
  const totals = async (token: string, datasetId?: string) => {
    const r = await query(token, datasetId)
    assert.equal(r.status, 200, `${token}: ${JSON.stringify(r.body)}`)
    return { actual: r.body.grandTotal.produksi, budget: r.body.grandTotal.budget_produksi, units: r.body.rows.map((x: { label: string }) => x.label).sort() }
  }

  test('each of the levels sees exactly its Business Units (filtered before aggregation, both sources)', async () => {
    assert.deepEqual(await totals('sam1'), { actual: 30, budget: 100, units: ['SAM-1'] })
    assert.deepEqual(await totals('frg'), { actual: 270, budget: 100, units: ['CLP-1', 'SAM-1', 'SAM-2'] })
    assert.deepEqual(await totals('wil'), { actual: 160, budget: 100, units: ['CLP-1', 'SAM-1'] })
    assert.deepEqual(await totals('region'), { actual: 270, budget: 100, units: ['CLP-1', 'SAM-1', 'SAM-2'] })
    assert.deepEqual(await totals('gmk'), { actual: 50, budget: 500, units: ['BHP-1'] })
    assert.deepEqual(await totals('company'), { actual: 140, budget: 100, units: ['SAM-1', 'SAM-2'] })
  })

  test('Kepemilikan AND per assignment: FRG+PLASMA and SAM+INTI never give FRG+INTI; the budget source has no ownership → nothing', async () => {
    assert.deepEqual(await totals('own'), { actual: 180, budget: null, units: ['CLP-1', 'SAM-1', 'SAM-2'] })
  })

  test('Rayon / Divisi: filtered by the field where it exists; the budget source (no field) gives nothing (never the parent BU)', async () => {
    assert.deepEqual(await totals('rayon'), { actual: 10, budget: null, units: ['SAM-1'] })
    assert.deepEqual(await totals('div'), { actual: 20, budget: null, units: ['SAM-1'] })
  })

  test('multiple assignments: a union of the grants (SAM-1 + GMK 1 = SAM-1, BHP-1)', async () => {
    assert.deepEqual(await totals('multi'), { actual: 80, budget: 600, units: ['BHP-1', 'SAM-1'] })
  })

  test('unrestricted_data sees everything, incl. rows a scoped user never sees', async () => {
    assert.deepEqual(await totals('auditor'), { actual: 450, budget: 1200, units: ['BHP-1', 'CLP', 'CLP-1', 'SAM-1', 'SAM-2'] })
  })

  test('PARTIAL: rows whose BU is a company code (CLP) and rows inconsistent with the master (SAM-1/FAP) are hidden', async () => {
    const r = await totals('frg', 'ds-partial')
    assert.equal(r.actual, 270, 'CLP 60 and SAM-1/FAP 70 are not counted')
    assert.ok(!r.units.includes('CLP'))
  })

  test('application admin without assignment, users without assignment: 403 on every data path', async () => {
    for (const t of ['admin', 'nobody']) {
      assert.equal((await query(t)).status, 403, t)
      assert.equal((await query(t)).body.error.code, 'SCOPE_UNRESOLVED')
      assert.equal((await call('POST', '/api/dw/analytics/grid', t, { query: Q(), depth: 0, path: null, withTotal: true })).status, 403)
      assert.equal((await call('GET', '/api/dw/datasets/ds-ok/values?field=bisnis_unit', t)).status, 403)
    }
  })

  test('non-standard datasets return no data: NONPIMS, UNVERIFIED; notification only for levels 1–4, 6, 7', async () => {
    for (const id of ['ds-nonpims', 'ds-unverified']) {
      const r = await query('sam1', id, { dimensions: [], chartBy: 'trend', measures: ['produksi'] })
      assert.deepEqual([r.status, r.body.error.code, r.body.error.details.notify], [409, 'DATASET_NOT_STANDARD', true], id)
      assert.match(r.body.error.message, /Tabel belum standar dan tidak memiliki parameter default/)
    }
    const g = await query('gmk', 'ds-nonpims', { dimensions: [], chartBy: 'trend', measures: ['produksi'] })
    assert.deepEqual([g.status, g.body.error.details.notify], [409, false])
    assert.doesNotMatch(g.body.error.message, /parameter default/)
  })

  test('no Unit Operasional column (NONE): 403 ACCESS_FIELD_MISSING with the field and authority notice, for every level', async () => {
    for (const t of ['sam1', 'gmk', 'rayon']) {
      const r = await query(t, 'ds-none', { dimensions: [], chartBy: 'trend', measures: ['produksi'] })
      assert.deepEqual([r.status, r.body.error.code, r.body.error.details.notify], [403, 'ACCESS_FIELD_MISSING', true], t)
      assert.match(r.body.error.message, /field Unit Operasional .*tidak memiliki otoritas/)
    }
  })

  test('request manipulation cannot widen the scope (scope, filter, drilldown path)', async () => {
    const viaScope = await query('sam1', 'ds-ok', { scope: { bisnis_unit: ['BHP-1', 'SAM-2'] } })
    assert.deepEqual([viaScope.status, viaScope.body.grandTotal.produksi, viaScope.body.rows.length], [200, null, 0])
    const viaFilter = await query('sam1', 'ds-ok', { filter: { dateFrom: '2026-01-01', dateTo: '2026-12-31', fields: { bisnis_unit: 'BHP-1' } } })
    assert.equal(viaFilter.body.grandTotal.produksi, null)
    const viaPath = await call('POST', '/api/dw/analytics/grid', 'sam1', { query: Q('ds-ok', { dimensions: ['bisnis_unit', 'afdeling'], measures: ['produksi'] }), depth: 1, path: ['BHP-1'], withTotal: true })
    assert.deepEqual([viaPath.status, viaPath.body.rows.length, viaPath.body.total?.cur.produksi ?? null], [200, 0, null])
    const otherDataset = await query('sam1', 'ds-missing')
    assert.equal(otherDataset.status, 404)
  })

  test('grid (pivot / hierarchy / paging counts) shows the scope only', async () => {
    const r = await call('POST', '/api/dw/analytics/grid', 'frg', { query: Q('ds-ok'), depth: 0, path: null, withTotal: true, withCounts: true })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.rows.map((x: { label: string }) => x.label), ['CLP-1', 'SAM-1', 'SAM-2'])
    assert.equal(r.body.total.cur.produksi, 270)
    assert.equal(r.body.sourceRows, 7, 'count of the allowed source rows only (6 actual + 1 budget)')
    const child = await call('POST', '/api/dw/analytics/grid', 'frg', { query: Q('ds-ok', { dimensions: ['bisnis_unit', 'afdeling'], measures: ['produksi'] }), depth: 1, path: ['SAM-1'], withTotal: false })
    assert.equal(child.status, 200, JSON.stringify(child.body))
    assert.deepEqual(child.body.rows.map((x: { label: string }) => x.label), ['01', '02'])
  })

  test('distinct values and search: only values inside the scope; cache never crosses scopes', async () => {
    const v = async (t: string, q = '') => (await call('GET', `/api/dw/datasets/ds-ok/values?field=bisnis_unit${q ? `&q=${q}` : ''}`, t)).body.values
    assert.deepEqual(await v('frg'), ['CLP-1', 'SAM-1', 'SAM-2'])
    assert.deepEqual(await v('sam1'), ['SAM-1'], 'same dataset and field right after another scope')
    assert.deepEqual(await v('sam1', 'BHP'), [])
    assert.ok((await v('auditor')).includes('BHP-1'))
    assert.deepEqual((await call('GET', '/api/dw/datasets/ds-ok/values?field=group', 'sam1')).body.values, ['FRG'], 'the inconsistent FAP row stays hidden')
  })

  test('catalog: access status per dataset and coverage of the scope only', async () => {
    const c = (await call('GET', '/api/dw/catalog', 'sam1')).body.datasets as { id: string; access: { status: string; notify: boolean; unmappedShare: number | null }; coverage: { from: string; to: string } }[]
    const by = Object.fromEntries(c.map((d) => [d.id, d]))
    assert.equal(by['ds-ok']!.access.status, 'ok')
    assert.deepEqual(by['ds-ok']!.coverage, { from: '2026-01-05', to: '2026-01-06' }, 'SAM-1 rows only (01-11 is inconsistent and hidden)')
    assert.deepEqual([by['ds-partial']!.access.status, by['ds-partial']!.access.unmappedShare], ['partial', 0.1])
    assert.deepEqual([by['ds-none']!.access.status, by['ds-none']!.access.notify], ['denied', true])
    const adminCat = (await call('GET', '/api/dw/catalog', 'admin')).body.datasets as { access: { status: string; code: string } }[]
    assert.ok(adminCat.every((d) => d.access.status === 'denied' && d.access.code === 'SCOPE_UNRESOLVED'), 'an admin without assignment sees no dataset as usable')
  })

  test('per month (month grouped as a date in SQL): month labels, and the months add up to the scope total', async () => {
    for (const [t, total] of [['frg', 270], ['sam1', 30]] as const) {
      const r = await query(t, 'ds-ok', { dimensions: ['tanggal'], chartBy: 'tanggal', measures: ['produksi'] })
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(r.body.grandTotal.produksi, total)
      assert.ok(r.body.rows.length > 0 && r.body.rows.every((x: { label: string }) => /^[A-Z][a-z]{2} 2026$/.test(x.label)), JSON.stringify(r.body.rows.map((x: { label: string }) => x.label)))
      assert.equal(r.body.rows.reduce((a: number, x: { values: { produksi: number | null } }) => a + (x.values.produksi ?? 0), 0), total)
      assert.deepEqual(r.body.chart.categories, r.body.rows.map((x: { label: string }) => x.label))
    }
  })

  test('result cache: a repeat is served from the cache for the same scope only; refusals are never cached', async () => {
    const body = Q('ds-ok', { filter: { dateFrom: '2026-01-01', dateTo: '2026-06-30' } })
    const a1 = await call('POST', '/api/dw/analytics/query', 'sam1', body)
    const a2 = await call('POST', '/api/dw/analytics/query', 'sam1', body)
    assert.deepEqual([a1.body.execution.cached, a2.body.execution.cached], [undefined, true])
    assert.deepEqual([a2.body.grandTotal, a2.body.rows], [a1.body.grandTotal, a1.body.rows])
    // Same request, other scopes right after: computed for their own scope, not the cached SAM-1 result.
    const b = await call('POST', '/api/dw/analytics/query', 'frg', body)
    assert.deepEqual([b.body.execution.cached, b.body.grandTotal.produksi], [undefined, 270])
    const c = await call('POST', '/api/dw/analytics/query', 'company', body)
    assert.deepEqual([c.body.execution.cached, c.body.grandTotal.produksi], [undefined, 140])
    assert.equal((await call('POST', '/api/dw/analytics/query', 'sam1', body)).body.grandTotal.produksi, 30)
    for (const t of ['admin', 'nobody']) assert.equal((await call('POST', '/api/dw/analytics/query', t, body)).status, 403, `${t} after the result was cached`)
    // Key order in the request does not matter; a different request is a different entry.
    const reordered = await call('POST', '/api/dw/analytics/query', 'sam1', { chartBy: body.chartBy, measures: body.measures, dimensions: body.dimensions, filter: { dateTo: '2026-06-30', dateFrom: '2026-01-01' }, scope: {}, datasetId: 'ds-ok' })
    assert.equal(reordered.body.execution.cached, true)
    const other = await call('POST', '/api/dw/analytics/query', 'sam1', { ...body, measures: ['produksi'] })
    assert.equal(other.body.execution.cached, undefined)
    // Grid: the same rules.
    const g = { query: body, depth: 0, path: null, withTotal: true }
    const g1 = await call('POST', '/api/dw/analytics/grid', 'frg', g)
    const g2 = await call('POST', '/api/dw/analytics/grid', 'frg', g)
    const g3 = await call('POST', '/api/dw/analytics/grid', 'sam1', g)
    assert.deepEqual([g1.body.cached, g2.body.cached, g3.body.cached], [undefined, true, undefined])
    assert.deepEqual(g2.body.rows, g1.body.rows)
    assert.deepEqual(g3.body.rows.map((x: { label: string }) => x.label), ['SAM-1'])
  })

  test('refusals are audited (data.denied)', async () => {
    await query('nobody')
    await new Promise((r) => setImmediate(r))
    assert.ok(f.audit.some((x) => x.action === 'data.denied' && x.user_id === 'id-nobody'))
  })

  test('no export endpoint exists: exports are built in the browser from these scoped responses', () => {
    assert.doesNotMatch(app.printRoutes({ commonPrefix: false }), /export/i)
  })
})
