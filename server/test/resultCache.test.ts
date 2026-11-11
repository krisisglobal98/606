/**
 * ResultCache (pure): fixed lifetime, bounded size (least recently used dropped), off at 0, failures not stored;
 * keys: scope part changes with the fingerprint and the organization snapshot, request part ignores key order.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ResultCache, scopeKey, stableKey } from '../src/analytics/resultCache.ts'
import type { RowScope } from '../src/dataAccess/guard.ts'

describe('ResultCache', () => {
  test('a value is reused within the lifetime and loaded again after it', async () => {
    let t = 0
    let loads = 0
    const c = new ResultCache(1000, 10, () => t)
    const load = async () => ++loads
    assert.deepEqual(await c.get('k', load), { value: 1, hit: false })
    t = 999
    assert.deepEqual(await c.get('k', load), { value: 1, hit: true })
    t = 1000
    assert.deepEqual(await c.get('k', load), { value: 2, hit: false }, 'fixed lifetime: a hit does not extend it')
  })
  test('bounded: the least recently used entry is dropped first', async () => {
    const c = new ResultCache(60_000, 2)
    await c.get('a', async () => 'a')
    await c.get('b', async () => 'b')
    await c.get('a', async () => 'x') // touch a
    await c.get('c', async () => 'c') // drops b
    assert.equal(c.size, 2)
    assert.equal((await c.get('a', async () => 'new')).hit, true)
    assert.equal((await c.get('b', async () => 'new')).hit, false)
  })
  test('0 = off: always loads, stores nothing', async () => {
    const c = new ResultCache(0)
    let loads = 0
    await c.get('k', async () => ++loads)
    await c.get('k', async () => ++loads)
    assert.deepEqual([loads, c.size, c.enabled], [2, 0, false])
  })
  test('a failed load is not stored', async () => {
    const c = new ResultCache(60_000)
    await assert.rejects(c.get('k', async () => { throw new Error('boom') }))
    assert.equal(c.size, 0)
    assert.deepEqual(await c.get('k', async () => 1), { value: 1, hit: false })
  })
})

describe('cache keys', () => {
  const rows = (fingerprint: string, loadedAt: number) => ({ kind: 'rows', fingerprint, snapshot: { loadedAt } }) as unknown as RowScope
  test('scope part: different fingerprint or a newer organization snapshot gives a different key', () => {
    assert.notEqual(scopeKey(rows('a', 1)), scopeKey(rows('b', 1)))
    assert.notEqual(scopeKey(rows('a', 1)), scopeKey(rows('a', 2)))
    assert.equal(scopeKey(rows('a', 1)), scopeKey(rows('a', 1)))
    assert.equal(scopeKey({ kind: 'all', fingerprint: 'all' }), 'all')
  })
  test('request part: object key order does not matter, array order and values do', () => {
    assert.equal(stableKey({ a: 1, b: { c: [1, 2], d: null } }), stableKey({ b: { d: null, c: [1, 2] }, a: 1 }))
    assert.notEqual(stableKey({ dims: ['x', 'y'] }), stableKey({ dims: ['y', 'x'] }))
    assert.notEqual(stableKey({ a: 1 }), stableKey({ a: 2 }))
  })
})
