/**
 * Data Profil through the real routes with the real guard (no database): every id-based endpoint answers 404 for a
 * record outside the caller's scope — the same answer as an unknown id (no IDOR) —, PUT needs the admin role AND
 * the scope, lists get the caller's filter. Plus the route inventory: every route of the API is classified, so a
 * new data route cannot appear without being reviewed for the data access guard.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import Fastify from 'fastify'
import type { User } from '../src/auth/authService.ts'
import type { Container } from '../src/container.ts'
import { DataAccessService } from '../src/dataAccess/dataAccessService.ts'
import { blockCondition, profileFilter, vehicleCondition } from '../src/dataAccess/guard.ts'
import { AppError } from '../src/http/errors.ts'
import { registerRoutes } from '../src/http/routes.ts'
import { createServer } from '../src/http/server.ts'
import { createLogger } from '../src/log/logger.ts'
import type { ProfileService } from '../src/profile/profileService.ts'
import type { ProfileOps } from '../src/profile/ops.ts'
import { registerProfileRoutes } from '../src/profile/routes.ts'
import { accessConfig, asg, fakeDb, ID, snapshot, user } from './support/dataAccessFixture.ts'

const log = createLogger('silent', false)

/** Master records: block 11 in SAM-1 (rayon A, division 01, INTI), block 12 in BHP-1, vehicle 21 in SAM-1, vehicle 22 in BHP-1. */
const REC: Record<string, { kind: 'block' | 'vehicle'; unitId: string; rayonId: string | null; divisionId: string | null; ownership: string | null }> = {
  'block:11': { kind: 'block', unitId: ID.SAM1, rayonId: ID.RAYON_A, divisionId: ID.DIV01, ownership: 'INTI' },
  'block:12': { kind: 'block', unitId: ID.BHP1, rayonId: ID.RAYON_A, divisionId: ID.DIV01, ownership: 'INTI' },
  'vehicle:21': { kind: 'vehicle', unitId: ID.SAM1, rayonId: null, divisionId: null, ownership: null },
  'vehicle:22': { kind: 'vehicle', unitId: ID.BHP1, rayonId: null, divisionId: null, ownership: null },
}

function setup() {
  const f = fakeDb()
  const users = new Map<string, User>()
  const add = (name: string, role: User['role'], ...a: Parameters<typeof asg>[0][]) => {
    users.set(name, user(name, role))
    f.assignments.set(`id-${name}`, a.map(asg))
  }
  add('sam1', 'viewer', { level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 })
  add('sam1admin', 'admin', { level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 })
  add('admin', 'admin')
  add('div02', 'viewer', { level: 'DIVISION', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_division', subId: ID.DIV02 })
  add('auditor', 'viewer')
  const calls: string[] = []
  const profile = {
    configured: true,
    ref: async (kind: 'block' | 'vehicle', id: string) => {
      const r = REC[`${kind}:${id}`]
      if (!r) throw new AppError(404, 'PROFILE_NOT_FOUND', 'x')
      return { kind, id, code: id, unitId: r.unitId, unitCode: null, companyId: null, plantedHa: null, uom: null, divisionCode: null, divisionId: r.divisionId, rayonId: r.rayonId, ownership: r.ownership }
    },
    block: async (id: string) => (calls.push(`block:${id}`), { id }),
    vehicle: async (id: string) => (calls.push(`vehicle:${id}`), { id }),
    units: async (flt: unknown) => (calls.push(`units:${JSON.stringify(flt)}`), []),
    blocks: async (_q: unknown, flt: unknown) => (calls.push(`blocks:${JSON.stringify(flt)}`), { items: [], more: false }),
    vehicles: async (_q: unknown, flt: unknown) => (calls.push(`vehicles:${JSON.stringify(flt)}`), { items: [], more: false }),
    vehicleGroups: async () => [],
  } as unknown as ProfileService
  const ops = {
    block: async (id: string) => (calls.push(`opsBlock:${id}`), {}),
    vehicle: async (id: string) => (calls.push(`opsVehicle:${id}`), {}),
    setVehicleCard: async (id: string) => (calls.push(`card:${id}`), {}),
    setVehicleCosts: async (id: string) => (calls.push(`costs:${id}`), {}),
  } as unknown as ProfileOps
  const dataAccess = new DataAccessService(f.db, accessConfig(), log, async () => snapshot())
  const app = Fastify()
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    req.user = users.get(String(req.headers['x-user'] ?? '')) ?? null
  })
  app.setErrorHandler((e, _req, reply) => reply.code((e as AppError).status ?? 500).send({ code: (e as AppError).code }))
  registerProfileRoutes(app, { profile, profileOps: ops, dataAccess })
  const r = (method: 'GET' | 'PUT', url: string, who: string) => app.inject({ method, url, headers: { 'x-user': who }, payload: method === 'PUT' ? {} : undefined })
  return { app, r, calls, f }
}

const ID_ROUTES = (block: string, vehicle: string) => [
  ['GET', `/api/profile/blocks/${block}`],
  ['GET', `/api/profile/blocks/${block}/ops/produksi`],
  ['GET', `/api/profile/vehicles/${vehicle}`],
  ['GET', `/api/profile/vehicles/${vehicle}/ops`],
] as const

describe('Data Profil: anti-IDOR', () => {
  test('every id-based read endpoint: inside the scope 200, outside 404 (like an unknown id), and the service is not called', async () => {
    const { r, calls, app } = setup()
    for (const [m, url] of ID_ROUTES('11', '21')) assert.equal((await r(m, url, 'sam1')).statusCode, 200, url)
    const before = calls.length
    for (const [m, url] of ID_ROUTES('12', '22')) {
      const res = await r(m, url, 'sam1')
      assert.deepEqual([res.statusCode, res.json().code], [404, 'PROFILE_NOT_FOUND'], url)
    }
    for (const [m, url] of ID_ROUTES('999', '999')) assert.equal((await r(m, url, 'sam1')).statusCode, 404, `unknown ${url}`)
    assert.equal(calls.length, before, 'no profile/ops call for a refused record')
    await app.close()
  })

  test('PUT needs the admin role AND the record in scope; an admin without assignment gets nothing', async () => {
    const { r, calls, app } = setup()
    for (const url of ['/api/profile/vehicles/21/card', '/api/profile/vehicles/21/costs/2026-10']) {
      assert.equal((await r('PUT', url, 'sam1')).statusCode, 403, `viewer ${url}`)
      assert.equal((await r('PUT', url, 'admin')).statusCode, 404, `admin without assignment ${url}`)
      assert.equal((await r('PUT', url, 'sam1admin')).statusCode, 200, `admin in scope ${url}`)
    }
    for (const url of ['/api/profile/vehicles/22/card', '/api/profile/vehicles/22/costs/2026-10']) assert.equal((await r('PUT', url, 'sam1admin')).statusCode, 404, `admin outside scope ${url}`)
    assert.deepEqual(calls.filter((c) => /^(card|costs)/.test(c)), ['card:21', 'costs:21'])
    await app.close()
  })

  test('Divisi: blocks are filtered by division; vehicles (no division) fall back to the parent BU only', async () => {
    const { r, app } = setup()
    assert.equal((await r('GET', '/api/profile/blocks/11', 'div02')).statusCode, 404, 'block of division 01')
    assert.equal((await r('GET', '/api/profile/vehicles/21', 'div02')).statusCode, 200, 'vehicle of the parent BU')
    assert.equal((await r('GET', '/api/profile/vehicles/22', 'div02')).statusCode, 404, 'another BU')
    await app.close()
  })

  test('lists carry the caller\'s filter; no scope = 403; unrestricted = no filter', async () => {
    const { r, calls, app } = setup()
    for (const url of ['/api/profile/units', '/api/profile/blocks', '/api/profile/vehicles']) {
      assert.equal((await r('GET', url, 'admin')).statusCode, 403, url)
      assert.equal((await r('GET', url, 'sam1')).statusCode, 200, url)
      assert.equal((await r('GET', url, 'auditor')).statusCode, 200, url)
    }
    assert.ok(calls.includes(`units:${JSON.stringify({ fullUnitIds: [ID.SAM1], rayonPairs: [], divisionPairs: [], ownershipPairs: [] })}`))
    assert.ok(calls.includes('units:null') && calls.includes('blocks:null') && calls.includes('vehicles:null'))
    await app.close()
  })

  test('list SQL conditions use bind parameters for unit ids and pairs', () => {
    const f = profileFilter({ kind: 'scoped', grants: [{ assignmentId: 'a', level: 'DIVISION', unitIds: [ID.SAM1], unitCodes: ['SAM-1'], ownership: null, rayon: null, division: { id: ID.DIV02, code: '02', name: 'AFDELING-02' } }], problems: [], snapshot: snapshot(), fingerprint: 'x' })!
    const p: unknown[] = []
    const sql = blockCondition(f, p)
    assert.match(sql, /k\.businessunit_id::text = ANY\(\$1::text\[\]\)/)
    assert.match(sql, /p\.b = k\.division_id::text/)
    assert.deepEqual(p[0], [])
    assert.deepEqual([p[3], p[4]], [[ID.SAM1], [ID.DIV02]])
    const pv: unknown[] = []
    assert.match(vehicleCondition(f, pv), /v\.businessunit_id::text = ANY\(\$1::text\[\]\)/)
    assert.deepEqual(pv[0], [ID.SAM1], 'vehicles: the parent BU of the division grant')
    assert.equal(blockCondition(null, []), 'TRUE')
  })
})

describe('route inventory', () => {
  // Routes that return source data, values or profiles: each goes through DataAccessGuard (reviewed).
  const GUARDED = [
    'POST /api/dw/analytics/query', 'POST /api/dw/analytics/grid', 'GET /api/dw/datasets/:id/values', 'GET /api/dw/catalog',
    'GET /api/profile/units', 'GET /api/profile/blocks', 'GET /api/profile/blocks/:id', 'GET /api/profile/blocks/:id/ops/:tab',
    'GET /api/profile/vehicles', 'GET /api/profile/vehicles/:id', 'GET /api/profile/vehicles/:id/ops', 'PUT /api/profile/vehicles/:id/card', 'PUT /api/profile/vehicles/:id/costs/:period',
  ]
  // Routes without report data (metadata, configuration, identity) or for dataset owners only (admin/analyst).
  const NO_REPORT_DATA = [
    'POST /api/auth/login', 'GET /api/auth/me', 'POST /api/auth/password', 'POST /api/auth/logout',
    'GET /api/health', 'GET /api/health/database', 'GET /api/health/datawarehouse',
    'GET /api/dw/connections', 'GET /api/dw/connections/:id/schemas', 'GET /api/dw/connections/:id/schemas/:schema/tables', 'GET /api/dw/connections/:id/schemas/:schema/tables/:table/columns',
    'GET /api/categories', 'POST /api/categories', 'PATCH /api/categories/:id', 'DELETE /api/categories/:id',
    'GET /api/dw/datasets', 'GET /api/dw/datasets/:id', 'POST /api/dw/datasets/suggest', 'POST /api/dw/datasets', 'PATCH /api/dw/datasets/:id', 'DELETE /api/dw/datasets/:id',
    'GET /api/dw/datasets/:id/org', 'POST /api/dw/datasets/:id/org-validation', 'GET /api/dw/query-log',
    'GET /api/saved-reports', 'POST /api/saved-reports', 'DELETE /api/saved-reports/:id',
    'GET /api/users', 'GET /api/users/:id', 'POST /api/users', 'PUT /api/users/:id', 'GET /api/users/:id/access', 'PUT /api/users/:id/access',
    'GET /api/org/options', 'GET /api/org/status', 'POST /api/org/reload', 'GET /api/profile/status', 'GET /api/profile/vehicles/groups',
    'GET /api/access/menus', 'PUT /api/access/menus', 'POST /api/access/menus/reset',
  ]
  test('every API route is classified (a new route fails this test until reviewed)', async () => {
    const config = { ...accessConfig(), api: { trustedProxies: [], corsOrigin: null } } as never
    const app = createServer(config, log, { userForToken: async () => null } as never)
    const seen: string[] = []
    app.addHook('onRoute', (r) => {
      for (const m of [r.method].flat()) if (m !== 'HEAD' && m !== 'OPTIONS') seen.push(`${m} ${r.url}`)
    })
    const k = { config, log, dataAccess: {}, datasets: {}, query: {}, access: {}, profile: {}, profileOps: {}, users: {}, auth: {}, loginLimiter: {}, savedReports: {}, categories: {}, db: {}, dw: {}, meta: {} } as unknown as Container
    registerRoutes(app, k)
    await app.ready()
    const known = new Set([...GUARDED, ...NO_REPORT_DATA])
    assert.deepEqual(seen.filter((x) => !known.has(x)).sort(), [], 'unclassified routes')
    assert.deepEqual([...known].filter((x) => !seen.includes(x)).sort(), [], 'classified routes that no longer exist')
    await app.close()
  })
})
