import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageWindow } from '../src/components/tables/pageWindow.ts'

test('page numbers: all when few, otherwise first, last and the neighbours of the current page', () => {
  assert.deepEqual(pageWindow(1, 1), [1])
  assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(pageWindow(1, 12), [1, 2, 3, 4, 5, null, 12])
  assert.deepEqual(pageWindow(6, 12), [1, null, 5, 6, 7, null, 12])
  assert.deepEqual(pageWindow(12, 12), [1, null, 8, 9, 10, 11, 12])
  for (let p = 1; p <= 30; p++) {
    const w = pageWindow(p, 30)
    assert.ok(w.includes(p) && w[0] === 1 && w.at(-1) === 30 && w.length <= 7, `page ${p}: ${w.join(',')}`)
  }
})
