/** DatasetService.cachedStale: stale-while-revalidate cache used for dataset coverage. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatasetService } from '../src/datasets/datasetService.ts'

const service = () => new DatasetService({} as never, {} as never, {} as never, {} as never, {} as never)

test('fresh entry: answered from cache without loading', async () => {
  const s = service()
  let loads = 0
  const load = async () => ++loads
  assert.equal(await s.cachedStale('k', 60_000, 600_000, undefined, load), 1)
  assert.equal(await s.cachedStale('k', 60_000, 600_000, undefined, load), 1)
  assert.equal(loads, 1)
})

test('stale entry: old value answered at once, one background reload replaces it', async () => {
  const s = service()
  let loads = 0
  const signals: (AbortSignal | undefined)[] = []
  const load = async (signal?: AbortSignal) => (signals.push(signal), ++loads)
  const req = new AbortController().signal
  assert.equal(await s.cachedStale('k', 0, 600_000, req, load), 1)
  // ttl 0: every call is stale. Two calls at once start ONE reload and both get the old value.
  const [a, b] = await Promise.all([s.cachedStale('k', 0, 600_000, req, load), s.cachedStale('k', 0, 600_000, req, load)])
  assert.deepEqual([a, b], [1, 1])
  await s.settled()
  assert.equal(loads, 2)
  // The background reload does not use the request's abort signal (it outlives the request).
  assert.equal(signals[0], req)
  assert.equal(signals[1], undefined)
  assert.equal(await s.cachedStale('k', 60_000, 600_000, req, load), 2)
})

test('failed background reload keeps the old entry', async () => {
  const s = service()
  await s.cachedStale('k', 0, 600_000, undefined, async () => 'old')
  assert.equal(await s.cachedStale('k', 0, 600_000, undefined, async () => { throw new Error('source down') }), 'old')
  await s.settled()
  assert.equal(await s.cachedStale('k', 60_000, 600_000, undefined, async () => 'never'), 'old')
})

test('too old (beyond maxStale) or no entry: the caller waits for a fresh load; errors reach the caller', async () => {
  const s = service()
  await s.cachedStale('k', 0, 0, undefined, async () => 'old')
  assert.equal(await s.cachedStale('k', 0, 0, undefined, async () => 'new'), 'new')
  await assert.rejects(s.cachedStale('other', 0, 600_000, undefined, async () => { throw new Error('source down') }), /source down/)
})
