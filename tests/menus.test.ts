/** Menu permissions on the browser side: the helpers, and the menu ids matching the server catalog. */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { DATA_TABS, MENU_PATHS, REPORT_TABS, allowedLanding, canOpen, firstAllowed } from '../src/app/auth/menus.ts'
import { MENUS } from '../server/src/access/menus.ts'

describe('menu permissions (browser)', () => {
  test('every menu id of the navigation exists on the server, with the right parent', () => {
    const server = new Map(MENUS.map((m) => [m.id, m]))
    for (const m of MENU_PATHS) assert.equal(server.get(m.id)?.parent, null, m.id)
    for (const [parent, tabs] of [['report', REPORT_TABS], ['data', DATA_TABS]] as const)
      for (const t of tabs) assert.equal(server.get(t.id)?.parent, parent, t.id)
  })

  test('canOpen: the list from the server, or everything from an older server', () => {
    assert.equal(canOpen(null, 'report'), false)
    assert.equal(canOpen({}, 'report'), true)
    assert.equal(canOpen({ menus: ['analisis'] }, 'report'), false)
    assert.equal(canOpen({ menus: ['analisis'] }, 'analisis'), true)
  })

  test('landing page falls back to the first allowed menu', () => {
    const u = { menus: ['analisis', 'settings'] }
    assert.equal(allowedLanding(u, '/analisis'), '/analisis')
    assert.equal(allowedLanding(u, '/beranda'), '/analisis')
    assert.equal(allowedLanding(u, '/report/operasional'), '/analisis')
    assert.equal(allowedLanding({ menus: [] }, '/beranda'), '/settings')
    assert.equal(allowedLanding(u, '/somewhere-else'), '/somewhere-else', 'not a menu: the route decides')
    assert.equal(firstAllowed({ menus: ['report', 'report.operasional'] }, REPORT_TABS), '/report/operasional')
    assert.equal(firstAllowed({ menus: ['report'] }, REPORT_TABS), null)
  })
})
