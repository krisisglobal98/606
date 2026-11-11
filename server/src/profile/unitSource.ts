/**
 * The unit databases of APIMS (dor_apims_<unit>, one per business unit, on the application database's server and
 * account), read by the Data Profil tabs: FieldOperation (panen, perawatan, pemupukan), TractionWorkshop
 * (aktivitas kendaraan, work order) and Keuangan (alokasi biaya). Every session is read-only with a statement
 * timeout; a pool is opened on first use and closed when idle.
 *
 * A business unit code maps to its database by its first token: "AMS-Kebun1" → dor_apims_ams. When that database
 * does not exist the token without trailing digits is tried ("PISP2-PKS" → dor_apims_pisp). ProfileOps asks the
 * company mapping first (companyDb.ts, table dor_company_db); this name rule is the fallback.
 */
import pg from 'pg'
import type { Config } from '../config/config.ts'
import { AppError, toSourceError } from '../http/errors.ts'
import type { Logger } from '../log/logger.ts'

const PREFIX = 'dor_apims_'
const LIST_TTL_MS = 10 * 60_000
const MAX_POOLS = 12

/** Candidate database names of a business unit code, most specific first. */
export function unitDbCandidates(unitCode: string): string[] {
  const token = unitCode.trim().split(/[^A-Za-z0-9]+/)[0]?.toLowerCase() ?? ''
  if (!token) return []
  const bare = token.replace(/\d+$/, '')
  return [...new Set([token, bare].filter(Boolean).map((t) => `${PREFIX}${t}`))]
}

export class UnitSources {
  private readonly config: Config
  private readonly log: Logger
  private readonly listDatabases: () => Promise<string[]>
  private known: { at: number; names: Set<string> } | null = null
  private readonly pools = new Map<string, pg.Pool>()

  constructor(config: Config, log: Logger, listDatabases: () => Promise<string[]>) {
    this.config = config
    this.log = log
    this.listDatabases = listDatabases
  }

  /** The unit database of a business unit code, or null when the server has none for it. */
  async dbFor(unitCode: string | null): Promise<string | null> {
    if (!unitCode) return null
    if (!this.known || Date.now() - this.known.at > LIST_TTL_MS) this.known = { at: Date.now(), names: new Set((await this.listDatabases()).filter((n) => n.startsWith(PREFIX))) }
    return unitDbCandidates(unitCode).find((n) => this.known!.names.has(n)) ?? null
  }

  async query<R extends pg.QueryResultRow>(database: string, sql: string, params: unknown[] = []): Promise<R[]> {
    try {
      return (await this.pool(database).query<R>(sql, params)).rows
    } catch (e) {
      if (e instanceof AppError) throw e
      // A unit database without the expected table (an older APIMS schema) reads as "no data", not as an error.
      if ((e as { code?: string }).code === '42P01') return []
      this.log.warn({ database, code: (e as { code?: string }).code }, 'unit database read failed')
      throw toSourceError(e)
    }
  }

  private pool(database: string): pg.Pool {
    let p = this.pools.get(database)
    if (p) return p
    if (this.pools.size >= MAX_POOLS) {
      const [oldest, old] = this.pools.entries().next().value as [string, pg.Pool]
      this.pools.delete(oldest)
      void old.end().catch(() => undefined)
    }
    const c = this.config.metadataDb
    p = new pg.Pool({
      host: c.host,
      port: c.port,
      database,
      user: c.user,
      password: c.password,
      ssl: c.ssl ? { rejectUnauthorized: false } : false,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'dod-profile-unit',
      options: '-c default_transaction_read_only=on -c statement_timeout=20000',
    })
    p.on('error', (e) => this.log.warn({ database, code: (e as { code?: string }).code }, 'unit database pool error'))
    this.pools.set(database, p)
    return p
  }

  async close() {
    await Promise.all([...this.pools.values()].map((p) => p.end().catch(() => undefined)))
    this.pools.clear()
  }
}
