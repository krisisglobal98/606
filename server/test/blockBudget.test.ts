/**
 * Production budget per block (profile/blockBudget.ts): code normalisation, the budget of one block among a unit's
 * rows, and DOD_PRODUCTION_DB (with its earlier name DOD_GIS_PRODUCTION_DB). No database.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ConfigError, loadConfig } from '../src/config/config.ts'
import { BlockBudget, budgetOfBlock, normAfd, normBlok, normKebun } from '../src/profile/blockBudget.ts'

describe('normalisation', () => {
  test('kebun, afdeling (Roman / two-digit / AFD prefix) and blok codes', () => {
    assert.equal(normKebun('ATS-1'), 'ATS1')
    assert.equal(normKebun(' bbs m '), 'BBSM')
    assert.deepEqual(['VI', '06', '6', 'AFD06', 'xx', ''].map(normAfd), ['6', '6', '6', '6', 'XX', ''])
    assert.deepEqual(['H008', 'h8', 'd33a', 'M25A', 'N12', 'A11B', 'X-1'].map(normBlok), ['H8', 'H8', 'D33A', 'M25A', 'N12', 'A11B', 'X-1'])
  })
})

describe('budgetOfBlock', () => {
  const row = (afdeling: string, blokcode: string, kg: number) => ({ afdeling, blokcode, kg })
  test('kg of the budget table in ton, whatever the code spelling; several ownership rows add up', () => {
    assert.equal(budgetOfBlock([row('01', 'F0043', 54339)], '01', 'F43'), 54.339)
    assert.equal(budgetOfBlock([row('01', 'C42', 1000), row('01', 'C42', 500)], '1', 'C42'), 1.5)
  })
  test('the afdeling decides between blocks with one code; no row gives no budget', () => {
    assert.equal(budgetOfBlock([row('01', 'A1', 1000), row('02', 'A1', 3000)], 'II', 'A1'), 3)
    assert.equal(budgetOfBlock([row('01', 'A1', 1000)], '01', 'A2'), null)
  })
})

describe('DOD_PRODUCTION_DB', () => {
  test('optional, a plain database name; the earlier DOD_GIS_PRODUCTION_DB is still read', () => {
    assert.equal(loadConfig({ NODE_ENV: 'test' }).production, null)
    assert.deepEqual(loadConfig({ NODE_ENV: 'test', DOD_PRODUCTION_DB: 'DO_PIMS_REPORT' }).production, { database: 'DO_PIMS_REPORT' })
    assert.deepEqual(loadConfig({ NODE_ENV: 'test', DOD_GIS_PRODUCTION_DB: 'DO_PIMS_REPORT' }).production, { database: 'DO_PIMS_REPORT' })
    assert.deepEqual(loadConfig({ NODE_ENV: 'test', DOD_PRODUCTION_DB: 'A', DOD_GIS_PRODUCTION_DB: 'B' }).production, { database: 'A' })
    assert.throws(() => loadConfig({ NODE_ENV: 'test', DOD_PRODUCTION_DB: 'x; DROP' }), ConfigError)
  })
  test('not configured: the budget source says so and refuses queries', async () => {
    const b = new BlockBudget(loadConfig({ NODE_ENV: 'test' }))
    assert.equal(b.configured, false)
    await assert.rejects(b.blockBudgetTon('ATS1', '01', 'A1', '2026-10-01', '2026-11-01'), /DOD_PRODUCTION_DB/)
  })
})
