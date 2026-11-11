/**
 * Pooled-client lifecycle (cleanup Phase 1): which errors destroy a client instead of returning it to the pool, a
 * ROLLBACK that never hides the original error, the organization master pool's error handler attached once, and
 * close() that forgets an ended pool. The last two use the real organization master when DOD_ORG_DB_* is set.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type pg from 'pg'
import { loadConfig } from '../src/config/config.ts'
import { isBrokenConnection, rollback } from '../src/db/connection.ts'
import { OrgMasterReader } from '../src/dataAccess/orgMaster.ts'
import { BlockBudget } from '../src/profile/blockBudget.ts'
import { createLogger } from '../src/log/logger.ts'

const err = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? 'x')), props)

/** A client whose ROLLBACK succeeds or fails, counting the statements it was sent. */
function fakeClient(rollbackFails = false) {
  const sent: string[] = []
  const client = {
    query: async (sql: string) => {
      sent.push(sql)
      if (rollbackFails) throw err({ code: 'ECONNRESET', message: 'read ECONNRESET' })
      return { rows: [] }
    },
  }
  return { client: client as unknown as pg.PoolClient, sent }
}

describe('broken connection detection', () => {
  test('connection-level errors destroy the client', () => {
    for (const e of [
      err({ code: 'ECONNRESET' }),
      err({ code: 'EPIPE' }),
      err({ code: 'ETIMEDOUT' }),
      err({ code: '57P01', message: 'terminating connection due to administrator command' }),
      err({ code: '08006', message: 'connection failure' }),
      err({ message: 'Connection terminated unexpectedly' }),
      err({ message: 'Client has encountered a connection error and is not queryable' }),
      err({ message: 'Query read timeout' }),
    ])
      assert.equal(isBrokenConnection(e), true, `${(e as { code?: string }).code ?? ''} ${e.message}`)
  })
  test('ordinary SQL errors and cancellations keep the client (normal transactions are not affected)', () => {
    for (const e of [
      err({ code: '23505', message: 'duplicate key value violates unique constraint' }),
      err({ code: '42P01', message: 'relation does not exist' }),
      err({ code: '57014', message: 'canceling statement due to user request' }),
      err({ code: '40001', message: 'could not serialize access' }),
      new Error('validation failed'),
      null,
      'text',
    ])
      assert.equal(isBrokenConnection(e), false, String((e as { message?: string } | null)?.message ?? e))
  })
})

describe('rollback after an error', () => {
  test('an ordinary error: ROLLBACK is sent and the client goes back to the pool', async () => {
    const f = fakeClient()
    assert.equal(await rollback(f.client, err({ code: '23505' })), undefined)
    assert.deepEqual(f.sent, ['ROLLBACK'])
  })
  test('a broken connection: no ROLLBACK is attempted and the client is destroyed with the original error', async () => {
    const f = fakeClient()
    const cause = err({ code: 'ECONNRESET', message: 'read ECONNRESET' })
    assert.equal(await rollback(f.client, cause), cause)
    assert.deepEqual(f.sent, [])
  })
  test('a failing ROLLBACK never throws (the caller rethrows its own error) but destroys the client', async () => {
    const f = fakeClient(true)
    const broken = await rollback(f.client, err({ code: '23505', message: 'the real error' }))
    assert.ok(broken instanceof Error)
    assert.notEqual(broken.message, 'the real error')
  })
})

const config = loadConfig(process.env)
const log = createLogger('silent', false)

describe('pool lifecycle', () => {
  test('organization master: the pool error handler is attached once, however many snapshots are loaded', { skip: !config.orgDb && 'DOD_ORG_DB_* not set' }, async () => {
    const r = new OrgMasterReader(config, log)
    try {
      await r.load()
      await r.load()
      await r.load()
      const pool = (r as unknown as { pool: pg.Pool }).pool
      assert.equal(pool.listenerCount('error'), 1)
    } finally {
      await r.close()
    }
    assert.equal((r as unknown as { pool: pg.Pool | null }).pool, null, 'close() forgets the ended pool')
    await r.close() // a second close is harmless
  })
  test('block budget: close() forgets the pool, so a later read opens a fresh one instead of an ended pool', { skip: !config.production && 'DOD_PRODUCTION_DB not set' }, async () => {
    const b = new BlockBudget(config)
    const internal = b as unknown as { pool: pg.Pool | null; db(): pg.Pool }
    const first = internal.db()
    await b.close()
    assert.equal(internal.pool, null)
    const second = internal.db()
    assert.notEqual(second, first)
    await b.close()
  })
})
