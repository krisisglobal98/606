import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeFields, filterText, isActiveFilter } from '@/pages/Analysis/fieldFilter'

test('value filters: a value, a list or "contains"; empty forms are no filter', () => {
  assert.equal(isActiveFilter('Dump Truck'), true)
  assert.equal(isActiveFilter(['Dump Truck', 'Tractor']), true)
  assert.equal(isActiveFilter({ like: 'DT-0' }), true)
  for (const v of [null, undefined, '', [], { like: '  ' }]) assert.equal(isActiveFilter(v as never), false, JSON.stringify(v))
  assert.equal(filterText(['Dump Truck', 'Tractor']), 'Dump Truck, Tractor')
  assert.equal(filterText({ like: ' DT-0 ' }), 'berisi "DT-0"')
  assert.deepEqual(activeFields({ b: 'x', a: ['y'], c: null, d: [] }).map(([k]) => k), ['a', 'b'])
})
