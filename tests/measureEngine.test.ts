import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEngine, DISPLAY_CALCS, kpiMeasures } from '@/semantic/measureEngine'
import { agg, PLAN, SALES } from './fixtures'

test('no configuration → Value only, for every measure', () => {
  const e = createEngine(SALES, [])
  for (const id of ['revenue', 'cost', 'units', 'margin_pct']) assert.deepEqual(e.displays(id, undefined), ['value'])
})

test('no built-in comparisons are invented for a dataset without an actual/target pair', () => {
  const e = createEngine({ ...SALES, kpi: { actual: '', target: null, achievement: null } }, [])
  assert.deepEqual([...e.defs.keys()].sort(), ['cost', 'margin_pct', 'revenue', 'units'])
})

test('units come from metadata only', () => {
  const e = createEngine(SALES, [])
  assert.equal(e.columnMeta('cost', 'value', undefined).unit, '')
  assert.equal(e.columnMeta('revenue', 'value', undefined).unit, 'IDR')
  assert.equal(e.columnMeta('revenue', 'value', { unit: 'Rp juta', alias: 'Pendapatan', decimals: 2 }).measureLabel, 'Pendapatan')
})

test('unavailable calculations are listed but never used', () => {
  const e = createEngine(SALES, [])
  const mom = e.calcsFor('revenue').find((c) => c.id === 'growth_mom')!
  assert.ok(mom.unavailable)
  assert.deepEqual(e.displays('revenue', { display: ['growth_mom'] }), ['value'])
  assert.equal(e.cell('revenue', 'growth_mom', agg({ revenue: 10 }, { revenue: 5 }), null), null)
  assert.ok(DISPLAY_CALCS.every((c) => typeof c.applies === 'function'))
})

test('display calculations are computed per row context', () => {
  const e = createEngine(SALES, [])
  const total = agg({ revenue: 200, cost: 100, '#count:revenue': 40 }, { revenue: 160, cost: 100 })
  const row = agg({ revenue: 50, cost: 40, '#count:revenue': 10 }, { revenue: 40, cost: 50 })
  assert.equal(e.cell('revenue', 'value', row, total), 50)
  assert.equal(e.cell('revenue', 'growth_yoy', row, total), 25)
  assert.equal(e.cell('revenue', 'growth_yoy', total, total), 25)
  assert.equal(e.cell('revenue', 'contribution', row, total), 25)
  assert.equal(e.cell('revenue', 'count', row, total), 10)
  assert.equal(e.cell('revenue', 'average', row, total), 5)
  // ratio from aggregated numerator/denominator; growth of a % measure is in pp
  assert.equal(e.cell('margin_pct', 'value', row, total), 125)
  assert.equal(e.cell('margin_pct', 'growth_yoy', row, total), 125 - 80)
  assert.equal(e.cell('margin_pct', 'gap', row, total), 25)
})

test('server measures: only what the chosen measures need', () => {
  const e = createEngine(PLAN, [{ id: 'cm:rpu', label: 'Revenue per Unit', formula: 'Revenue / Units', decimals: 2, percent: false, unit: '' }])
  assert.deepEqual(e.serverMeasures(['revenue']), ['revenue'])
  assert.deepEqual(e.serverMeasures(['cm:rpu']).sort(), ['revenue', 'units'])
  assert.deepEqual(e.serverMeasures(['dx:variance']).sort(), ['cost', 'revenue'])
  assert.deepEqual(kpiMeasures(PLAN, e).sort(), ['cost', 'margin_pct', 'revenue'])
})

test('calculated and derived measures are evaluated on aggregates', () => {
  const e = createEngine(PLAN, [{ id: 'cm:rpu', label: 'Revenue per Unit', formula: 'Revenue / Units', decimals: 2, percent: false, unit: '' }])
  const row = agg({ revenue: 90, cost: 100, units: 30 }, { revenue: 60, cost: 100, units: 20 })
  assert.equal(e.cell('cm:rpu', 'value', row, row), 3)
  assert.equal(e.cell('cm:rpu', 'growth_yoy', row, row), 0)
  assert.equal(e.cell('dx:variance', 'value', row, row), -10)
  assert.equal(e.cell('dx:ach_gap', 'value', row, row), -10)
  assert.equal(e.category('cm:rpu'), 'calculated')
  assert.equal(e.category('margin_pct'), 'derived')
  assert.equal(e.category('revenue'), 'raw')
})

test('KPI tiles use the same definitions as the table', () => {
  const e = createEngine(PLAN, [])
  const total = agg({ revenue: 92.7, cost: 100 }, { revenue: 90, cost: 95 })
  const k = Object.fromEntries(e.kpis(total, false).map((x) => [x.id, x.value]))
  assert.equal(k.actual, e.cell('revenue', 'value', total, total))
  assert.equal(k.achievement, e.cell('margin_pct', 'value', total, total))
  assert.equal(k.growth, e.cell('revenue', 'growth_yoy', total, total))
})
