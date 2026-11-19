import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildHeader } from '@/pages/Analysis/grid/headerModel'
import { createEngine } from '@/semantic/measureEngine'
import { addGroup, fromMeasures, placeMeasure } from '@/stores/measureLayout'
import { SALES } from './fixtures'

const e = createEngine(SALES, [])

test('raw dataset presentation: one header row, one column per measure', () => {
  const h = buildHeader(fromMeasures(['revenue', 'cost', 'units']), {}, e)
  assert.equal(h.rows.length, 1)
  assert.deepEqual(h.rows[0]!.map((c) => c.label), ['Revenue', 'Cost', 'Units'])
  assert.deepEqual(h.leaves.map((l) => l.calc), ['value', 'value', 'value'])
  assert.ok(!JSON.stringify(h).match(/Growth|Gap|Achievement|Ton/))
})

test('sub-columns add a calculation row only when configured', () => {
  const h = buildHeader(fromMeasures(['revenue', 'cost']), { revenue: { display: ['value', 'growth_yoy'] } }, e)
  assert.equal(h.rows.length, 2)
  assert.deepEqual(h.rows[0]!.map((c) => [c.label, c.colSpan, c.rowSpan]), [['Revenue', 2, 1], ['Cost', 1, 2]])
  assert.deepEqual(h.rows[1]!.map((c) => c.label), ['Nilai', 'Pertumbuhan YoY'])
  assert.deepEqual(h.leaves.map((l) => l.key), ['revenue|value', 'revenue|growth_yoy', 'cost|value'])
})

test('Measure Groups add a group row; ungrouped measures span it', () => {
  let l = addGroup(fromMeasures(['revenue', 'cost', 'units']), 'g', 'Financial')
  l = placeMeasure(l, 'revenue', 'g')
  l = placeMeasure(l, 'cost', 'g')
  const h = buildHeader(l, { cost: { display: ['value', 'growth_yoy'] } }, e)
  assert.equal(h.rows.length, 3)
  // The group was added after the plain measures, so Units (ungrouped) comes first.
  assert.deepEqual(h.rows[0]!.map((c) => [c.kind, c.label, c.colSpan, c.rowSpan]), [['measure', 'Units', 1, 3], ['group', 'Financial', 3, 1]])
  assert.deepEqual(h.rows[1]!.map((c) => [c.label, c.colSpan, c.rowSpan]), [['Revenue', 1, 2], ['Cost', 2, 1]])
  assert.deepEqual(h.rows[2]!.map((c) => c.label), ['Nilai', 'Pertumbuhan YoY'])
  assert.deepEqual(h.leaves.map((x) => x.group), [null, 'g', 'g', 'g'])
})

test('removing configuration returns to the raw presentation', () => {
  const configured = buildHeader(addGroup(fromMeasures(['revenue']), 'g', 'G'), { revenue: { display: ['value', 'contribution'] } }, e)
  assert.ok(configured.rows.length > 1)
  const raw = buildHeader(fromMeasures(['revenue']), {}, e)
  assert.equal(raw.rows.length, 1)
  assert.deepEqual(raw.leaves.map((l) => l.calc), ['value'])
})

test('empty groups and unknown measures do not create columns', () => {
  const h = buildHeader(addGroup(fromMeasures(['revenue', 'ghost']), 'g', 'Empty'), {}, e)
  assert.equal(h.rows.length, 1)
  assert.deepEqual(h.leaves.map((l) => l.m), ['revenue'])
})

test('matrix: each column value gets the Layout columns, Total at the right, a row of column values on top', async () => {
  const { matrixHeader } = await import('@/pages/Analysis/grid/headerModel')
  const { createEngine } = await import('@/semantic/measureEngine')
  const { SALES } = await import('./fixtures')
  const e = createEngine(SALES, [])
  const base = buildHeader([{ kind: 'measure', id: 'revenue' }, { kind: 'measure', id: 'cost' }] as never, {}, e)
  const m = matrixHeader(base, [{ value: '2026-01-05', label: '05 Jan 2026' }, { value: null, label: '(kosong)' }], 'hari')
  assert.deepEqual(m.leaves.map((l) => [l.m, l.col ?? 'TOTAL']), [['revenue', '2026-01-05'], ['cost', '2026-01-05'], ['revenue', '\u0000'], ['cost', '\u0000'], ['revenue', 'TOTAL'], ['cost', 'TOTAL']])
  assert.deepEqual(m.rows[0]!.map((c) => [c.label, c.small ?? null, c.colSpan]), [['5', 'Jan 2026', 2], ['(kosong)', null, 2], ['Total', null, 2]])
  assert.equal(new Set(m.leaves.map((l) => l.key)).size, m.leaves.length, 'unique keys')
  assert.equal(m.rows[1]!.length, 6, 'the measure row repeats under each column value')
})
