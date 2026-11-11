/**
 * Data Profil (server/src/profile): routes, the menu rules and the source-quirk helpers without a database, and
 * an opt-in read of the real master database (DOD_TEST_PROFILE_MASTER=1; read-only, writes nothing).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import Fastify from 'fastify'
import type { Role, User } from '../src/auth/authService.ts'
import { loadConfig, type Config } from '../src/config/config.ts'
import type { DataAccessService } from '../src/dataAccess/dataAccessService.ts'
import { AppError } from '../src/http/errors.ts'
import { createLogger } from '../src/log/logger.ts'
import { ProfileService, ageYears } from '../src/profile/profileService.ts'
import { CardSchema, minutesOf, monthRange, ProfileOps } from '../src/profile/ops.ts'
import { registerProfileRoutes } from '../src/profile/routes.ts'
import { UnitSources, unitDbCandidates } from '../src/profile/unitSource.ts'

const silent = createLogger('silent', false)
/** Unrestricted data access (these tests are about routing; scope enforcement: dataAccessProfile.test.ts). */
const unrestricted = { scopeFor: async () => ({ kind: 'unrestricted', fingerprint: 'unrestricted' }), denied: () => {} } as unknown as DataAccessService
const ref = async (kind: 'block' | 'vehicle', id: string) => ({ kind, id, code: id, unitId: '1', unitCode: 'U1', companyId: '1', plantedHa: null, uom: null, divisionCode: null, divisionId: null, rayonId: null, ownership: null })

describe('data profil', () => {
  test('ageYears counts whole years in Asia/Jakarta', () => {
    const at = new Date('2026-10-27T03:00:00Z')
    assert.equal(ageYears('1994-12-01', at), 31)
    assert.equal(ageYears('1994-10-27', at), 32)
    assert.equal(ageYears('1994-10-28', at), 31)
    assert.equal(ageYears('2030-01-01', at), 0)
  })

  test('without a master database: 409 with an explanation, never a query', async () => {
    const p = new ProfileService({ orgMaster: null, metadataDb: {} } as unknown as Config, silent)
    assert.equal(p.configured, false)
    await assert.rejects(p.blocks({}, null), (e) => e instanceof AppError && e.status === 409 && e.code === 'PROFILE_MASTER_NOT_CONFIGURED')
  })

  test('routes need a session and pass the filters through', async () => {
    const calls: unknown[] = []
    const fake = {
      configured: true,
      units: async () => (calls.push(['units']), []),
      vehicleGroups: async () => [],
      blocks: async (f: unknown) => (calls.push(['blocks', { ...(f as object) }]), { items: [], more: false }),
      block: async (id: string) => (calls.push(['block', id]), { id }),
      vehicles: async (f: unknown) => (calls.push(['vehicles', f]), { items: [], more: false }),
      vehicle: async (id: string) => (calls.push(['vehicle', id]), { id }),
      ref,
    } as unknown as ProfileService
    const app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => {
      const role = req.headers['x-role'] as Role | undefined
      req.user = role ? ({ id: 'u', username: 'u', name: 'U', role } satisfies User) : null
    })
    app.setErrorHandler((e, _req, reply) => reply.code((e as AppError).status ?? 500).send({ code: (e as AppError).code }))
    registerProfileRoutes(app, { profile: fake, dataAccess: unrestricted })
    const get = (url: string, role?: Role) => app.inject({ url, headers: role ? { 'x-role': role } : {} })
    assert.equal((await get('/api/profile/blocks')).statusCode, 401)
    assert.equal((await get('/api/profile/blocks?unit=12&q=C07', 'viewer')).statusCode, 200)
    assert.equal((await get('/api/profile/vehicles/77', 'viewer')).statusCode, 200)
    assert.equal((await get('/api/profile/units', 'viewer')).statusCode, 200)
    assert.deepEqual(calls, [['blocks', { unit: '12', q: 'C07' }], ['vehicle', '77'], ['units']])
    assert.deepEqual((await get('/api/profile/status', 'viewer')).json(), { configured: true })
    await app.close()
  })
})

const real = process.env.DOD_TEST_PROFILE_MASTER === '1'
describe('data profil operational tabs', () => {
  test('helpers: hours, months, unit databases, card rules', () => {
    assert.equal(minutesOf('03:23'), 203)
    assert.equal(minutesOf('7 Jam 0 Menit'), 420)
    assert.equal(minutesOf('7 jam 30 menit'), 450)
    assert.equal(minutesOf(''), 0)
    assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2027-01-01', ym: 202612 })
    assert.throws(() => monthRange('2026-13'), (e) => e instanceof AppError && e.code === 'INVALID_PERIOD')
    assert.deepEqual(unitDbCandidates('AMS-Kebun1'), ['dor_apims_ams'])
    assert.deepEqual(unitDbCandidates('PISP2-PKS'), ['dor_apims_pisp2', 'dor_apims_pisp'])
    assert.deepEqual(unitDbCandidates('PALM - PKS'), ['dor_apims_palm'])
    assert.deepEqual(unitDbCandidates('  '), [])
    const card = { tarifBudget: 9500, satuan: 'KM', bbmStandar: 0.25, intervalService: 5000, nilaiPerolehan: 1, nilaiBuku: 1, nilaiBukuPer: null }
    assert.equal(CardSchema.parse(card).batasPantau, 0.5)
    assert.throws(() => CardSchema.parse({ ...card, batasPantau: 0.8, batasEvaluasi: 0.6 }))
  })

  test('unit database lookup uses the server list and tries the bare prefix', async () => {
    let listed = 0
    const u = new UnitSources({ metadataDb: {} } as unknown as Config, silent, async () => (listed++, ['dor_apims_ams', 'dor_apims_pisp', 'dor_application']))
    assert.equal(await u.dbFor('AMS-Kebun1'), 'dor_apims_ams')
    assert.equal(await u.dbFor('PISP2-PKS'), 'dor_apims_pisp')
    assert.equal(await u.dbFor('XYZ-1'), null)
    assert.equal(await u.dbFor(null), null)
    assert.equal(listed, 1, 'the database list is cached')
  })

  test('ops routes: reads for every role, writes for administrators only', async () => {
    const calls: unknown[] = []
    const fake = {
      block: async (...a: unknown[]) => (calls.push(['block', ...a]), {}),
      vehicle: async (...a: unknown[]) => (calls.push(['vehicle', ...a]), {}),
      setVehicleCard: async (...a: unknown[]) => (calls.push(['card', ...a]), {}),
      setVehicleCosts: async (...a: unknown[]) => (calls.push(['costs', ...a]), {}),
    } as unknown as ProfileOps
    const app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => {
      const role = req.headers['x-role'] as Role | undefined
      req.user = role ? ({ id: 'u1', username: 'u', name: 'U', role } satisfies User) : null
    })
    app.setErrorHandler((e, _req, reply) => reply.code((e as AppError).status ?? 500).send({ code: (e as AppError).code }))
    registerProfileRoutes(app, { profile: { ref } as unknown as ProfileService, profileOps: fake, dataAccess: unrestricted })
    const r = (method: 'GET' | 'PUT', url: string, role?: Role) => app.inject({ method, url, headers: role ? { 'x-role': role } : {}, payload: method === 'PUT' ? {} : undefined })
    assert.equal((await r('GET', '/api/profile/blocks/9/ops/produksi')).statusCode, 401)
    assert.equal((await r('GET', '/api/profile/blocks/9/ops/produksi?period=2026-10', 'viewer')).statusCode, 200)
    assert.equal((await r('GET', '/api/profile/vehicles/7/ops', 'viewer')).statusCode, 200)
    for (const url of ['/api/profile/vehicles/7/card', '/api/profile/vehicles/7/costs/2026-10']) {
      assert.equal((await r('PUT', url, 'analyst')).statusCode, 403, url)
      assert.equal((await r('PUT', url, 'admin')).statusCode, 200, url)
    }
    assert.deepEqual(calls.map((c) => (c as unknown[]).slice(0, 4)), [['block', '9', 'produksi', '2026-10'], ['vehicle', '7', undefined], ['card', '7', {}, 'u1'], ['costs', '7', '2026-10', {}]])
    await app.close()
  })
})

describe('data profil on the real master database (read-only)', { skip: real ? false : 'set DOD_TEST_PROFILE_MASTER=1 (with the .env of the server) to read dor_apims_master' }, () => {
  test('pickers, a block profile and a vehicle card', async () => {
    const p = new ProfileService(loadConfig(process.env), silent)
    try {
      const units = (await p.units(null)).filter((u) => u.blocks > 0)
      assert.ok(units.length > 0)
      const unit = units.reduce((a, u) => (u.blocks > a.blocks ? u : a))
      const blocks = await p.blocks({ unit: unit.id }, null)
      assert.equal(blocks.items.length, unit.blocks, 'every block of the unit')
      assert.equal(blocks.more, false)
      assert.ok((await p.blocks({}, null)).items.length <= 50, 'at most 50 without a unit')
      const vu = (await p.units(null)).find((u) => u.vehicles > 0)!
      assert.equal((await p.vehicles({ unit: vu.id }, null)).items.length, vu.vehicles)
      const b = await p.block(blocks.items[0]!.id)
      assert.equal(b.id, blocks.items[0]!.id)
      assert.ok(b.planting.plantedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(b.planting.plantedOn))
      const vehicles = await p.vehicles({ q: 'DT' }, null)
      const v = await p.vehicle(vehicles.items[0]!.id)
      for (const d of Object.values(v.dates)) assert.ok(d === null || (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > '1900-12-31'), `placeholder date ${d}`)
      assert.equal((await p.blocks({ q: '%_\\' }, null)).items.length, 0, 'LIKE wildcards are literal')
      await assert.rejects(p.block('0'), (e) => e instanceof AppError && e.status === 404)
      await assert.rejects(p.vehicle("1 OR 1=1"), (e) => e instanceof AppError && e.status === 404)
      // Operational tabs read the unit databases; the DOD tables are replaced by an empty fake (nothing is written).
      const unitDbs = new UnitSources(loadConfig(process.env), silent, async () => (await p.read<{ datname: string }>('SELECT datname FROM pg_database')).map((r) => r.datname))
      const ops = new ProfileOps(p, unitDbs, { query: async () => ({ rows: [] }) } as never)
      try {
        const withData = (await p.read<{ id: string }>("SELECT k.id::text AS id FROM ms_block k JOIN ms_businessunit b ON b.id = k.businessunit_id WHERE b.code = 'AMS-Kebun1' ORDER BY k.code LIMIT 1"))[0]
        if (withData) {
          for (const tab of ['produksi', 'perawatan', 'pemupukan', 'biaya']) {
            const r = await ops.block(withData.id, tab)
            assert.ok(r.source === 'dor_apims_ams' && r.periods.length > 0 && r.period === r.periods[0], tab)
          }
          await assert.rejects(ops.block(withData.id, 'nope'), (e) => e instanceof AppError && e.code === 'INVALID_TAB')
        }
        const veh = (await p.read<{ id: string }>("SELECT v.id::text AS id FROM ms_vehicle v JOIN ms_businessunit b ON b.id = v.businessunit_id WHERE b.code = 'AMS-Kebun1' ORDER BY v.code LIMIT 1"))[0]
        if (veh) {
          const v = await ops.vehicle(veh.id)
          assert.equal(v.source, 'dor_apims_ams')
          if (v.data) assert.ok(v.data.kpi.pemakaian >= 0 && v.data.costRecorded === false && v.data.kpi.tarifAktual === null, 'no costs: no invented tariff')
        }
      } finally {
        await unitDbs.close()
      }
    } finally {
      await p.close()
    }
  })
})
