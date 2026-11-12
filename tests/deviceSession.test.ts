/** One device, one signed-in user: rules applied between the tabs of a browser (src/stores/deviceSession.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deviceHolder, readStoredSession, sessionChange } from '../src/stores/deviceSession.ts'

const NOW = Date.parse('2026-11-12T08:00:00Z')
const stored = (token: string | null, id: string, username: string, expiresAt = '2026-11-12T20:00:00Z') =>
  JSON.stringify({ state: { token, expiresAt, user: token ? { id, username, name: `Nama ${username}`, role: 'viewer' } : null }, version: 0 })

test('readStoredSession: a valid session, or null when absent, signed out, expired or unreadable', () => {
  assert.deepEqual(readStoredSession(stored('t1', 'u1', 'andi'), NOW), { token: 't1', expiresAt: '2026-11-12T20:00:00Z', user: { id: 'u1', username: 'andi', name: 'Nama andi' } })
  assert.equal(readStoredSession(null, NOW), null)
  assert.equal(readStoredSession(stored(null, 'u1', 'andi'), NOW), null)
  assert.equal(readStoredSession(stored('t1', 'u1', 'andi', '2026-11-12T07:59:59Z'), NOW), null)
  assert.equal(readStoredSession('{not json', NOW), null)
})

test('sessionChange: what a tab does when another tab changes the session', () => {
  const A1 = readStoredSession(stored('a1', 'A', 'andi'), NOW)
  const A2 = readStoredSession(stored('a2', 'A', 'andi'), NOW)
  const B1 = readStoredSession(stored('b1', 'B', 'budi'), NOW)
  // Signed in as A here.
  assert.equal(sessionChange({ token: 'a1', userId: 'A' }, null), 'signed-out')
  assert.equal(sessionChange({ token: 'a1', userId: 'A' }, A1), 'none')
  assert.equal(sessionChange({ token: 'a1', userId: 'A' }, A2), 'adopt')
  assert.equal(sessionChange({ token: 'a1', userId: 'A' }, B1), 'switched')
  // Signed out here: follow whoever signs in on this device.
  assert.equal(sessionChange({ token: null, userId: null }, B1), 'adopt')
  assert.equal(sessionChange({ token: null, userId: null }, null), 'none')
})

test('deviceHolder: another user signed in on the device blocks a sign-in; the same user (any case) does not', () => {
  const A = readStoredSession(stored('a1', 'A', 'andi'), NOW)
  assert.deepEqual(deviceHolder(A, 'budi'), { id: 'A', username: 'andi', name: 'Nama andi' })
  assert.equal(deviceHolder(A, ' ANDI '), null)
  assert.equal(deviceHolder(null, 'budi'), null)
  // An expired session on the device blocks nothing.
  assert.equal(deviceHolder(readStoredSession(stored('a1', 'A', 'andi', '2026-11-12T07:00:00Z'), NOW), 'budi'), null)
})
