/** DOD's own PostgreSQL (users, sessions, connections, datasets, logs). Separate from every source DB. */
import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import type { Config } from '../config/config.ts'
import type { Logger } from '../log/logger.ts'
import { isBrokenConnection, rollback } from './connection.ts'

export class MetadataDb {
  readonly pool: pg.Pool
  private readonly log: Logger

  constructor(config: Config, log: Logger) {
    this.log = log
    const c = config.metadataDb
    this.pool = new pg.Pool({
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
      ssl: c.ssl ? { rejectUnauthorized: false } : false,
      max: c.poolMax,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: 'dod-metadata',
    })
    this.pool.on('error', (e) => this.log.warn({ code: (e as { code?: string }).code }, 'metadata db idle client error'))
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<R>(text, values)
  }

  /** Applies SQL files in ./migrations in name order, each once, inside a transaction. */
  async migrate() {
    const client = await this.pool.connect()
    let broken: Error | undefined
    try {
      await client.query('CREATE TABLE IF NOT EXISTS dor_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
      const done = new Set((await client.query<{ name: string }>('SELECT name FROM dor_migration')).rows.map((r) => r.name))
      const dir = new URL('./migrations/', import.meta.url)
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        if (done.has(file)) continue
        await client.query('BEGIN')
        try {
          await client.query(readFileSync(new URL(file, dir), 'utf8'))
          await client.query('INSERT INTO dor_migration (name) VALUES ($1)', [file])
          await client.query('COMMIT')
          this.log.info({ migration: file }, 'migration applied')
        } catch (e) {
          // The migration's own error is what is reported; a failing ROLLBACK must not replace it.
          broken = await rollback(client, e)
          throw e
        }
      }
    } catch (e) {
      // An error outside a migration (e.g. reading dor_migration) on a dead connection: do not reuse the client.
      broken ??= isBrokenConnection(e) ? (e as Error) : undefined
      throw e
    } finally {
      client.release(broken)
    }
  }

  async ping(): Promise<number> {
    const t = performance.now()
    await this.pool.query('SELECT 1')
    return Math.round(performance.now() - t)
  }

  private closing: Promise<void> | null = null
  /** Ends the pool once; a second call (e.g. two shutdown signals) waits for the same end. */
  close() {
    this.closing ??= this.pool.end()
    return this.closing
  }
}
