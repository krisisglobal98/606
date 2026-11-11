import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addGroup, flatten, fromMeasures, locate, moveBlock, placeMeasure, removeGroup, removeMeasure, renameGroup, sanitize } from '@/stores/measureLayout'

test('flat layout without groups', () => {
  const l = fromMeasures(['a', 'b'])
  assert.deepEqual(flatten(l), ['a', 'b'])
  assert.ok(l.every((b) => b.kind === 'measure'))
})

test('add, rename, fill, reorder and delete a Measure Group', () => {
  let l = addGroup(fromMeasures(['a', 'b', 'c']), 'g1', 'Operational')
  l = renameGroup(l, 'g1', 'Ops')
  l = placeMeasure(l, 'b', 'g1')
  l = placeMeasure(l, 'c', 'g1', 0)
  assert.deepEqual(flatten(l), ['a', 'c', 'b'])
  assert.deepEqual(locate(l, 'b'), { group: 'g1', index: 1 })
  // reorder inside the group
  l = placeMeasure(l, 'b', 'g1', 0)
  assert.deepEqual(flatten(l), ['a', 'b', 'c'])
  // move the group before "a"
  l = moveBlock(l, 'g1', 0)
  assert.equal(l[0]!.id, 'g1')
  assert.equal((l[0] as { name: string }).name, 'Ops')
  // deleting the group keeps its measures at its position
  l = removeGroup(l, 'g1')
  assert.deepEqual(flatten(l), ['b', 'c', 'a'])
  assert.ok(l.every((b) => b.kind === 'measure'))
})

test('move a measure between groups and back to the top level', () => {
  let l = addGroup(addGroup(fromMeasures(['a', 'b']), 'g1', 'One'), 'g2', 'Two')
  l = placeMeasure(l, 'a', 'g1')
  l = placeMeasure(l, 'a', 'g2')
  assert.deepEqual(locate(l, 'a'), { group: 'g2', index: 0 })
  l = placeMeasure(l, 'a', null, 0)
  assert.deepEqual(locate(l, 'a'), { group: null, index: 0 })
  assert.deepEqual(flatten(l), ['a', 'b'])
})

test('remove and sanitize', () => {
  let l = placeMeasure(addGroup(fromMeasures(['a', 'x']), 'g', 'G'), 'a', 'g')
  l = removeMeasure(l, 'a')
  assert.deepEqual(flatten(l), ['x'])
  assert.deepEqual(flatten(sanitize(fromMeasures(['a', 'stale']), (id) => id === 'a')), ['a'])
})
