/**
 * Menu permissions per role (server/src/access): the API rules, the ceilings, parents, locked menus and the
 * request hook. No database: the stored choices come from an in-memory stand-in for dor_role_menu.
 */
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config/config.ts'
import { describe, test } from 'node:test'
import Fastify from 'fastify'
import { AccessService } from '../src/access/accessService.ts'
import { MENUS, requiredMenus } from '../src/access/menus.ts'
import { registerAccessRoutes } from '../src/access/routes.ts'
import type { Role, User } from '../src/auth/authService.ts'
import type { MetadataDb } from '../src/db/metadataDb.ts'
import { AppError } from '../src/http/errors.ts'
import { createLogger } from '../src/log/logger.ts'

function service(rows: { role: Role; menu_id: string; allowed: boolean }[] = []) {
  const db = { query: async () => ({ rows }) } as unknown as MetadataDb
  return new AccessService(db, createLogger('silent', false))
}
const forbidden = (e: unknown) => e instanceof AppError && e.status === 403 && e.code === 'MENU_FORBIDDEN'

describe('menu permissions', () => {
  test('catalog: unique ids, parents exist and come first', () => {
    const seen = new Set<string>()
    for (const m of MENUS) {
      assert.ok(!seen.has(m.id), m.id)
      if (m.parent) assert.ok(seen.has(m.parent), `${m.id} after its parent`)
      seen.add(m.id)
    }
  })

  test('API rules: module APIs need their menu, shared reads need none', () => {
    assert.deepEqual(requiredMenus('GET', '/api/saved-reports'), [['report.operasional']])
    assert.deepEqual(requiredMenus('POST', '/api/saved-reports'), [['analisis']])
    assert.deepEqual(requiredMenus('DELETE', '/api/saved-reports/srp-1'), [['report.operasional']])
    assert.deepEqual(requiredMenus('PATCH', '/api/saved-reports/srp-1'), [['report.operasional']])
    // connections come from .env; their names and tables are read only to build datasets
    assert.deepEqual(requiredMenus('GET', '/api/dw/connections'), [['data.dataset']])
    assert.deepEqual(requiredMenus('GET', '/api/dw/connections/x/schemas/public/tables'), [['data.dataset']])
    assert.deepEqual(requiredMenus('DELETE', '/api/categories/1'), [['data.dataset']])
    assert.deepEqual(requiredMenus('GET', '/api/profile/blocks/12'), [['analisis'], ['analisis.profil-blok']])
    assert.deepEqual(requiredMenus('GET', '/api/profile/vehicles?q=DT'.split('?')[0]!), [['analisis'], ['analisis.kartu-kendaraan']])
    assert.deepEqual(requiredMenus('GET', '/api/profile/status'), [['analisis']])
    for (const [m, p] of [['GET', '/api/dw/datasets'], ['POST', '/api/dw/analytics/query'], ['GET', '/api/auth/me']]) assert.deepEqual(requiredMenus(m!, p!), [], `${m} ${p}`)
  })

  test('defaults: every menu inside its ceiling', async () => {
    const a = service()
    assert.equal((await a.menusFor('admin')).length, MENUS.length)
    const viewer = await a.menusFor('viewer')
    for (const id of ['beranda', 'analisis', 'analisis.profil-blok', 'analisis.kartu-kendaraan', 'report', 'report.operasional', 'data.dataset', 'settings']) assert.ok(viewer.includes(id), id)
    for (const id of ['settings.users', 'settings.permissions']) assert.ok(!viewer.includes(id), id)
    // Without the Publish menu the publisher role has the same menus as a viewer.
    assert.deepEqual((await a.menusFor('publisher')).sort(), [...viewer].sort())
  })

  test('a menu switched off closes its sub-menus and its API', async () => {
    const a = service([{ role: 'viewer', menu_id: 'report', allowed: false }, { role: 'analyst', menu_id: 'analisis.profil-blok', allowed: false }])
    const viewer = await a.menusFor('viewer')
    assert.ok(!viewer.some((x) => x.startsWith('report')))
    await assert.rejects(a.check('viewer', 'GET', '/api/saved-reports'), forbidden)
    await a.check('analyst', 'GET', '/api/profile/status')
    await a.check('analyst', 'GET', '/api/profile/vehicles')
    await assert.rejects(a.check('analyst', 'GET', '/api/profile/blocks/12'), forbidden)
    await a.check('viewer', 'GET', '/api/dw/datasets')
  })

  test('removed modules (Insight, Laporan Excel, Dashboard Generator, GIS, Executive Summary, Publish, Kontak, Gudang Data, Laporan PDF) are not in the catalog and have no API rule', async () => {
    const ids = MENUS.map((m) => m.id)
    for (const id of ['insight', 'laporan-excel', 'dashboard-generator', 'dashboard-generator.ai-settings', 'beranda.input-hujan', 'peta-kebun', 'executive-summary', 'publish', 'publish.publications', 'publish.templates', 'settings.contact', 'data.warehouse', 'report.reports', 'report.templates', 'report.blast', 'report.history', 'report.recipients', 'report.settings']) assert.ok(!ids.includes(id), id)
    for (const p of ['/api/insight/catalog', '/api/xl/projects', '/api/dashgen/dashboards', '/api/gis/status', '/api/publish/directory', '/api/publish/publications', '/api/report/reports', '/api/report/blast']) assert.deepEqual(requiredMenus('GET', p), [], p)
    const a = service([{ role: 'analyst', menu_id: 'beranda', allowed: false }])
    assert.ok(!(await a.menusFor('analyst')).includes('beranda'))
    assert.ok((await a.menusFor('viewer')).includes('beranda'))
  })

  test('locked: Settings and Hak Akses Menu always stay on for admin', async () => {
    const a = service([{ role: 'admin', menu_id: 'settings', allowed: false }, { role: 'admin', menu_id: 'settings.permissions', allowed: false }])
    const admin = await a.menusFor('admin')
    assert.ok(admin.includes('settings') && admin.includes('settings.permissions'))
    await a.check('admin', 'PUT', '/api/access/menus')
    await assert.rejects(a.save({ roles: { admin: { 'settings.permissions': false } } }, 'u'), /selalu aktif/)
    await assert.rejects(a.save({ roles: { viewer: { 'settings.users': true } } }, 'u'), /tidak tersedia/)
    await assert.rejects(a.save({ roles: { viewer: { nope: true } } }, 'u'), /tidak dikenal/)
  })

  test('the request hook refuses before the handler runs', async () => {
    const a = service([{ role: 'viewer', menu_id: 'report', allowed: false }])
    const app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => {
      const role = req.headers['x-role'] as Role | undefined
      req.user = role ? ({ id: 'u', username: 'u', name: 'U', role } satisfies User) : null
    })
    app.setErrorHandler((e, _req, reply) => reply.code((e as AppError).status ?? 500).send({ code: (e as AppError).code }))
    registerAccessRoutes(app, { access: a })
    let ran = 0
    app.get('/api/saved-reports', async () => (ran++, []))
    const as = (role: Role) => app.inject({ url: '/api/saved-reports', headers: { 'x-role': role } })
    assert.equal((await as('viewer')).statusCode, 403)
    assert.equal(ran, 0)
    assert.equal((await as('analyst')).statusCode, 200)
    assert.equal((await app.inject({ url: '/api/saved-reports' })).statusCode, 200, 'no session: the route decides')
    await app.close()
  })
})

describe('DOD rename', () => {
  test('an env file with the earlier DOR_ names still loads; the DOD_ name wins', () => {
    const c = loadConfig({ NODE_ENV: 'test', DOR_DB_HOST: 'old', DOR_DB_NAME: 'dor_application', DOD_DB_NAME: 'dor_new' })
    assert.equal(c.metadataDb.host, 'old')
    assert.equal(c.metadataDb.database, 'dor_new')
    assert.throws(() => loadConfig({ NODE_ENV: 'test', DOR_DB_TARGET: 'dev' }), /DOD_DB_TARGET/)
  })
})
