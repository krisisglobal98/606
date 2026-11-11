/**
 * Session cache registry: every registered reset runs on each `resetSessionCaches()` (called by the auth store on a
 * change of token or user), so per-user caches never survive into the next session in the same tab.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { onSessionReset, resetSessionCaches } from '../src/services/session/sessionCaches.ts'

test('every registered cache is reset, each time', () => {
  const a = new Map([['ds|bu', ['SAM-1']]])
  let catalog: string | null = 'catalog of user A'
  onSessionReset(() => a.clear())
  onSessionReset(() => (catalog = null))
  resetSessionCaches()
  assert.deepEqual([a.size, catalog], [0, null])
  a.set('ds|bu', ['FRG']); catalog = 'catalog of user B'
  resetSessionCaches()
  assert.deepEqual([a.size, catalog], [0, null])
})
