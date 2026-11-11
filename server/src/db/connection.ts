/**
 * Pooled PostgreSQL clients after an error: whether the connection itself is broken (so it must not go back to the
 * pool), and a ROLLBACK that never hides the original error.
 *
 * A client goes back to the pool with `release()` after normal work and after an ordinary SQL error (the transaction
 * is rolled back and the connection is fine). It is destroyed with `release(err)` only when the connection is not
 * healthy: a network or protocol error, the server ending the session, a client-side query timeout (the statement may
 * still run on the server), or a ROLLBACK that itself failed (the session state is unknown).
 */
import type pg from 'pg'

/** Node socket errors that end a connection. */
const SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNABORTED', 'ENOTCONN', 'EHOSTUNREACH', 'ENETUNREACH'])
/** PostgreSQL: admin_shutdown, crash_shutdown, cannot_connect_now (class 57P); class 08 is connection exception. */
const SERVER_CODES = new Set(['57P01', '57P02', '57P03'])
/** node-postgres messages for a client that can no longer be used. */
const CLIENT_MESSAGES = /Connection terminated|connection error and is not queryable|Client was closed and is not queryable|Query read timeout/i

/** True when the error means the connection behind a pooled client is not healthy. */
export function isBrokenConnection(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const code = String((e as { code?: unknown }).code ?? '')
  if (SOCKET_CODES.has(code) || SERVER_CODES.has(code) || /^08/.test(code)) return true
  return CLIENT_MESSAGES.test(String((e as { message?: unknown }).message ?? ''))
}

const asError = (e: unknown) => (e instanceof Error ? e : new Error('connection not reusable'))

/**
 * Rolls back after `cause` and tells whether the client must be destroyed: the error to pass to `release()`, or
 * undefined when it can go back to the pool. A failing ROLLBACK is swallowed (the caller rethrows `cause`) but makes
 * the client unusable; on a broken connection no ROLLBACK is attempted.
 */
export async function rollback(client: pg.PoolClient, cause: unknown): Promise<Error | undefined> {
  if (isBrokenConnection(cause)) return asError(cause)
  try {
    await client.query('ROLLBACK')
    return undefined
  } catch (e) {
    return asError(e)
  }
}
