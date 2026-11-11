/** Analisis → Data Profil on the browser side: the report list matches the server menus, and the STNK countdown. */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { PROFILE_REPORTS, daysUntil, parseNum } from '../src/pages/Analysis/profile/util.ts'
import { MENUS } from '../server/src/access/menus.ts'

describe('data profil (browser)', () => {
  test('each report is a sub-menu of Analisis on the server', () => {
    const server = new Map(MENUS.map((m) => [m.id, m]))
    assert.deepEqual(PROFILE_REPORTS.map((r) => r.value), ['blok', 'kendaraan'])
    for (const r of PROFILE_REPORTS) assert.equal(server.get(r.menu)?.parent, 'analisis', r.menu)
  })

  test('daysUntil counts calendar days in Asia/Jakarta', () => {
    const at = new Date('2026-10-26T18:30:00Z') // 27 Oct 01:30 in Jakarta
    assert.equal(daysUntil('2026-10-27', at), 0)
    assert.equal(daysUntil('2026-11-26', at), 30)
    assert.equal(daysUntil('2026-10-20', at), -7)
  })
})

test('parseNum reads Indonesian and plain numbers', () => {
  assert.equal(parseNum(''), null)
  assert.equal(parseNum('1.250.000'), 1250000)
  assert.equal(parseNum('1.250.000,5'), 1250000.5)
  assert.equal(parseNum('0,75'), 0.75)
  assert.equal(parseNum('0.75'), 0.75)
  assert.equal(parseNum('1250000'), 1250000)
  assert.ok(Number.isNaN(parseNum('abc')))
})
