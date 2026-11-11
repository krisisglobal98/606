import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ageAround, arealIndicators, arealNotAvailable } from '../src/pages/Analysis/profile/blockProfileMeta.ts'

const none = { blockHa: null, plantedHa: null, other: [] }
const noStand = { initial: null, total: null, productive: null, insertion: null, dead: null, perHa: null }

describe('Areal Statement figures', () => {
  test('block E23 reads as in the statement', () => {
    const r = arealIndicators({ area: { blockHa: 24.18, plantedHa: 24.18, other: [{ label: 'Jalan', ha: 0 }] }, stand: { ...noStand, initial: 3126, total: 3126, insertion: 0 } })
    assert.deepEqual(r, { otherTotalHa: 0, areaGapHa: 0, plantedPct: 100, standGap: 0, density: 129.28, insertionPct: 0 })
  })
  test('parts that are missing stay empty instead of reading as zero', () => {
    const r = arealIndicators({ area: none, stand: noStand })
    assert.deepEqual(r, { otherTotalHa: 0, areaGapHa: null, plantedPct: null, standGap: null, density: null, insertionPct: null })
  })
  test('age by calendar year', () => {
    assert.equal(ageAround('2000-10-01', 2026), 26)
    assert.equal(ageAround(null, 2026), null)
    assert.equal(ageAround('2030-01-01', 2026), null)
  })
  test('a filled validity date leaves the not-available list', () => {
    assert.equal(arealNotAvailable(null).length, 13)
    assert.ok(!arealNotAvailable('2026-01-01').includes('Tanggal Berlaku Areal Statement'))
  })
})
