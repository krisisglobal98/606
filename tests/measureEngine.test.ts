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

// Traksi P1: one measure as H.I and S.D.H.I columns; ratios follow the window of their numerator/denominator.
// Values: Kesiapan Unit, Dump Truck, report date 2026-01-20 (B/S/R and availability of the acceptance list).
test('H.I / S.D.H.I / YTD columns read their own window; a ratio is computed inside each window', async () => {
  const { windowsOf } = await import('@/semantic/measureEngine')
  const KU = {
    ...SALES,
    fields: [
      { id: 'n_beroperasi', label: 'B', kind: 'measure' as const, dataType: 'number' as const, decimals: 0, calc: { kind: 'base' as const } },
      { id: 'n_siap', label: 'Siap', kind: 'measure' as const, dataType: 'number' as const, decimals: 0, calc: { kind: 'base' as const } },
      { id: 'unit_hari', label: 'Unit-hari', kind: 'measure' as const, dataType: 'number' as const, decimals: 0, calc: { kind: 'base' as const } },
      { id: 'availability_pct', label: 'Availability', kind: 'measure' as const, dataType: 'number' as const, unit: '%', decimals: 2, calc: { kind: 'ratio' as const, num: 'n_siap', den: 'unit_hari', scale: 100 } },
    ],
    kpi: { actual: 'n_beroperasi', target: null, achievement: null },
  }
  const e = createEngine(KU, [])
  const row = { cur: { n_beroperasi: 900, n_siap: 1300, unit_hari: 1333 }, prev: {}, hi: { n_beroperasi: 29, n_siap: 43, unit_hari: 43 }, sdhi: { n_beroperasi: 464, n_siap: 857, unit_hari: 860 }, ytd: { n_beroperasi: 464, n_siap: 857, unit_hari: 860 } }
  assert.equal(e.cell('n_beroperasi', 'value_hi', row, row), 29)
  assert.equal(e.cell('n_beroperasi', 'value_sdhi', row, row), 464)
  assert.equal(e.cell('availability_pct', 'value_hi', row, row), 100)
  assert.equal(Math.round(e.cell('availability_pct', 'value_sdhi', row, row)! * 100) / 100, 99.65)
  assert.equal(e.cell('n_beroperasi', 'value', row, row), 900, 'Value stays the filter period')
  // Both columns at once for one measure, labelled H.I / S.D.H.I under it.
  assert.deepEqual(e.displays('n_beroperasi', { display: ['value_hi', 'value_sdhi'] }), ['value_hi', 'value_sdhi'])
  assert.equal(e.columnMeta('availability_pct', 'value_sdhi', undefined).calcLabel, 'S.D.H.I')
  assert.equal(e.columnMeta('availability_pct', 'value_sdhi', undefined).unit, '%')
  // A window that was not returned gives an empty cell, never another window's number.
  assert.equal(e.cell('n_beroperasi', 'value_hi', agg({ n_beroperasi: 5 }), null), null)
  // The grid asks only for the windows that a column shows.
  assert.deepEqual(windowsOf({ a: { display: ['value', 'value_sdhi'] }, b: { display: ['value_hi'] }, c: undefined }), ['hi', 'sdhi'])
  assert.deepEqual(windowsOf({ a: { display: ['value', 'growth_yoy'] } }), [])
})

// Traksi P3: budget pro rata to the report date, distinct counts, display scale.
test('ANG. S.D.H.I: monthly budget × working days to the report date ÷ working days of the month; YTD adds earlier months', async () => {
  const { windowsOf } = await import('@/semantic/measureEngine')
  const DS = {
    ...SALES,
    fields: [
      { id: 'ang', label: 'Anggaran', kind: 'measure' as const, dataType: 'number' as const, unit: 'Rp', decimals: 0, calc: { kind: 'base' as const } },
      { id: 'hk', label: 'Hari kerja', kind: 'measure' as const, dataType: 'number' as const, decimals: 0, calc: { kind: 'base' as const } },
      { id: 'ang_prorata', label: 'ANG. S.D.H.I', kind: 'measure' as const, dataType: 'number' as const, unit: 'Rp', decimals: 0, calc: { kind: 'prorate' as const, budget: 'ang', workdays: 'hk' } },
      { id: 'unit_unik', label: 'Jumlah unit', kind: 'measure' as const, dataType: 'number' as const, decimals: 0, calc: { kind: 'distinct' as const } },
    ],
    kpi: { actual: 'ang', target: null, achievement: null },
  }
  const e = createEngine(DS, [])
  // Month: budget 1000, 25 working days; to the report date 15; on the report date 1; earlier months budget 3000.
  const row = { cur: { ang: 1000, hk: 25 }, prev: {}, hi: { ang: 0, hk: 1 }, sdhi: { ang: 1000, hk: 15 }, ytd: { ang: 4000, hk: 90 }, mon: { ang: 1000, hk: 25 } }
  assert.equal(e.cell('ang_prorata', 'value_sdhi', row, row), 600)
  assert.equal(e.cell('ang_prorata', 'value_hi', row, row), 40)
  assert.equal(e.cell('ang_prorata', 'value_ytd', row, row), 3600, '3000 of earlier months + 600 of this month')
  assert.equal(e.cell('ang_prorata', 'value', row, row), 1000, 'the filter period shows the budget as it is')
  assert.equal(e.cell('ang_prorata', 'value_sdhi', { ...row, mon: undefined }, row), null, 'no month window → no number, never a guess')
  assert.deepEqual(e.defs.get('ang_prorata')!.needs.sort(), ['ang', 'hk'])
  assert.deepEqual(windowsOf({ ang_prorata: { display: ['value_sdhi'] } }, true), ['sdhi', 'mon'])
  assert.deepEqual(windowsOf({ ang_prorata: { display: ['value_hi'] } }, true), ['hi', 'sdhi', 'mon'])
  // A distinct count is not additive: no Contribution / Count / Average for it.
  assert.ok(!e.calcsFor('unit_unik').some((c) => c.id === 'contribution' || c.id === 'count'))
  // Display scale: Rp ÷ 1000 → "Rp 000"; percentages and the measure itself are untouched.
  assert.equal(e.cell('ang', 'value', row, row, { scale: 1000 }), 1)
  assert.equal(e.cell('ang_prorata', 'value_sdhi', row, row, { scale: 1000 }), 0.6)
  assert.equal(e.columnMeta('ang', 'value', { scale: 1000 }).unit, 'Rp 000')
  assert.equal(e.columnMeta('ang', 'value', { scale: 1_000_000 }).unit, 'Rp juta')
})
