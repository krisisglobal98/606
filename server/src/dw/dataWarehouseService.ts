/**
 * Data warehouse connections. DOD Minimal takes them ONLY from the server environment
 * (DOD_DW_CONNECTIONS + DOD_DW_<P>_* in .env): there is no page or API to add, change, delete or test a
 * connection, and the API gives the browser only what it needs to build datasets (id, name, type,
 * default schema, status) — never host, database, account or password.
 */
import { ANALYTIC_DB_TYPES, type SourceConnectionConfig, type SourceDbType } from '../config/config.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import { AppError, notFound, toSourceError } from '../http/errors.ts'
import type { Logger } from '../log/logger.ts'
import { capabilitiesOf, type Capabilities, type MetadataService } from './metadata.ts'
import type { SourceRegistry } from './sourceRegistry.ts'

export type ConnectionStatus = 'untested' | 'connected' | 'failed' | 'not_configured'

export interface ConnectionTest {
  ok: boolean
  status: ConnectionStatus
  testedAt: string
  responseTimeMs: number | null
  serverVersion: string | null
  serverTime: string | null
  database: string | null
  account: string | null
  schema: { name: string; available: boolean; tableCount: number | null }
  readOnly: { session: boolean; account: boolean | null; writableTables: number | null; warning: string | null } | null
  error: { code: string; message: string } | null
}

/** What the browser may know about a connection (no host, database, account or password). */
export interface ConnectionSummary {
  id: string
  name: string
  dbType: SourceDbType
  environment: string
  /** Default schema (PostgreSQL) or database (ClickHouse) offered when building a dataset. */
  schema: string
  /** False when DOD_DW_<P>_PASSWORD is missing in .env (its value is never exposed). */
  secretConfigured: boolean
  capabilities: Capabilities
  status: ConnectionStatus
}

const SCHEMA_WORD: Record<SourceDbType, string> = { postgresql: 'Schema', clickhouse: 'Database', mysql: 'Database', mongodb: 'Database', redis: 'Database' }

interface Row {
  id: string
  status: ConnectionStatus
}

export class DataWarehouseService {
  private readonly db: MetadataDb
  private readonly src: SourceRegistry
  private readonly meta: MetadataService
  private readonly log: Logger

  constructor(db: MetadataDb, src: SourceRegistry, meta: MetadataService, log: Logger) {
    this.db = db
    this.src = src
    this.meta = meta
    this.log = log
  }

  /** Upserts the environment-defined connections into DOD's metadata DB (secret name only). */
  async syncFromConfig() {
    for (const c of this.src.list()) {
      await this.db.query(
        `INSERT INTO dw_connection (id, name, db_type, environment, host, port, database_name, username, password_secret, schema_name, ssl_mode, connect_timeout_ms, command_timeout_ms, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, db_type = EXCLUDED.db_type, environment = EXCLUDED.environment, host = EXCLUDED.host,
           port = EXCLUDED.port, database_name = EXCLUDED.database_name, username = EXCLUDED.username, password_secret = EXCLUDED.password_secret,
           schema_name = EXCLUDED.schema_name, ssl_mode = EXCLUDED.ssl_mode, connect_timeout_ms = EXCLUDED.connect_timeout_ms,
           command_timeout_ms = EXCLUDED.command_timeout_ms,
           status = CASE WHEN EXCLUDED.status = 'not_configured' THEN 'not_configured' WHEN dw_connection.status = 'not_configured' THEN 'untested' ELSE dw_connection.status END,
           updated_at = CASE WHEN (dw_connection.host, dw_connection.port, dw_connection.database_name, dw_connection.username, dw_connection.schema_name, dw_connection.ssl_mode)
                                IS DISTINCT FROM (EXCLUDED.host, EXCLUDED.port, EXCLUDED.database_name, EXCLUDED.username, EXCLUDED.schema_name, EXCLUDED.ssl_mode)
                             THEN now() ELSE dw_connection.updated_at END`,
        [c.id, c.name, c.dbType, c.environment, c.host, c.port, c.database, c.username, c.passwordSecret, c.schema, c.sslMode, c.connectTimeoutMs, c.commandTimeoutMs, this.src.isConfigured(c) ? 'untested' : 'not_configured'],
      )
      this.log.info({ connection: c.id, environment: c.environment, secretConfigured: this.src.isConfigured(c) }, 'source connection registered')
    }
  }

  private audit(userId: string | null, action: string, target: string | null, detail: unknown) {
    return this.db.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [userId, action, target, JSON.stringify(detail)])
  }

  config(id: string): SourceConnectionConfig {
    const c = this.src.get(id)
    if (!c) throw notFound('Koneksi data warehouse tidak ditemukan.')
    return c
  }

  /** The connections of .env, as the browser may see them. */
  async list(): Promise<ConnectionSummary[]> {
    const rows = (await this.db.query<Row>('SELECT id, status FROM dw_connection')).rows
    return this.src.list().map((c) => {
      const secretConfigured = this.src.isConfigured(c)
      const r = rows.find((x) => x.id === c.id)
      return {
        id: c.id,
        name: c.name,
        dbType: c.dbType,
        environment: c.environment,
        schema: c.schema,
        secretConfigured,
        capabilities: capabilitiesOf(c.dbType),
        status: secretConfigured ? (r?.status === 'not_configured' ? 'untested' : (r?.status ?? 'untested')) : 'not_configured',
      }
    })
  }

  /**
   * Connection check (SELECT 1, server version/time, schema availability, the account's write rights).
   * No HTTP route calls it any more (connections are checked on the server, see docs/DATA_WAREHOUSE.md);
   * kept for the automated tests and server-side diagnostics. Errors are reported by category, never
   * with credentials.
   */
  async test(id: string, userId: string | null): Promise<ConnectionTest> {
    const c = this.config(id)
    this.src.clearBackoff(c.id)
    const result = await this.probe(c, new Date().toISOString())
    if (!result.ok && result.status === 'failed') await this.src.reset(c.id)
    await this.db.query('UPDATE dw_connection SET status = $2, last_tested_at = $3, last_test = $4 WHERE id = $1', [c.id, result.status, result.testedAt, JSON.stringify(result)])
    await this.audit(userId, 'dw.connection.test', c.id, { ok: result.ok, code: result.error?.code ?? null, ms: result.responseTimeMs })
    this.log.info({ connection: c.id, ok: result.ok, code: result.error?.code, responseTimeMs: result.responseTimeMs }, 'connection test')
    return result
  }

  /** Ping (response time), server version/time, schema availability and the account's write rights. */
  private async probe(c: SourceConnectionConfig, testedAt: string): Promise<ConnectionTest> {
    if (!this.src.isConfigured(c)) {
      return this.failed(c, testedAt, 'not_configured', {
        code: 'SOURCE_NOT_CONFIGURED',
        message: `Password belum diset di server (variabel ${c.passwordSecret}).`,
      })
    }
    try {
      const ms = await this.ping(c, 'test.ping')
      const i = await this.meta.serverInfo(c)
      this.meta.invalidate(c.id)
      const schemas = await this.meta.schemas(c, undefined, true)
      const sch = schemas.find((s) => s.name === c.schema)
      const priv = await this.meta.privileges(c).catch(() => null)
      return {
        ok: !!sch?.canUse,
        status: sch?.canUse ? 'connected' : 'failed',
        testedAt,
        responseTimeMs: ms,
        serverVersion: i.version,
        serverTime: i.serverTime,
        database: i.database,
        account: i.account,
        schema: { name: c.schema, available: !!sch?.canUse, tableCount: sch?.tableCount ?? null },
        readOnly: priv
          ? {
              session: priv.sessionReadOnly,
              account: priv.accountReadOnly,
              writableTables: priv.writableTables,
              warning:
                priv.accountReadOnly || c.dbType === 'redis'
                  ? null
                  : `Akun ${priv.account} memiliki hak tulis${priv.writableTables ? ` pada ${priv.writableTables} tabel` : ''}${priv.canCreateInSchema ? ' dan dapat membuat objek' : ''}. DOD hanya mengirim perintah baca, tetapi untuk production gunakan akun khusus baca.`,
            }
          : null,
        error: sch?.canUse ? null : { code: 'SOURCE_SCHEMA_UNAVAILABLE', message: `${SCHEMA_WORD[c.dbType]} "${c.schema}" tidak ditemukan atau tidak dapat diakses oleh akun ini.` },
      }
    } catch (e) {
      const err = e instanceof AppError ? e : toSourceError(e)
      return this.failed(c, testedAt, err.code === 'SOURCE_NOT_CONFIGURED' ? 'not_configured' : 'failed', { code: err.code, message: err.message })
    }
  }

  /** SELECT 1 through the SQL engine (PostgreSQL, ClickHouse) or the driver's own ping. */
  private async ping(c: SourceConnectionConfig, kind: string): Promise<number> {
    if (ANALYTIC_DB_TYPES.has(c.dbType)) return (await this.src.run(c, 'SELECT 1 AS ok', [], { kind, timeoutMs: c.connectTimeoutMs })).durationMs
    return this.meta.ping(c)
  }

  private failed(c: SourceConnectionConfig, testedAt: string, status: ConnectionStatus, error: { code: string; message: string }): ConnectionTest {
    return { ok: false, status, testedAt, responseTimeMs: null, serverVersion: null, serverTime: null, database: null, account: null, schema: { name: c.schema, available: false, tableCount: null }, readOnly: null, error }
  }

  /** Lightweight health for /api/health/datawarehouse: SELECT 1 per connection, no catalog reads. */
  async health() {
    return Promise.all(
      this.src.list().map(async (c) => {
        if (!this.src.isConfigured(c)) return { id: c.id, name: c.name, status: 'not_configured' as const, responseTimeMs: null, error: 'SOURCE_NOT_CONFIGURED' }
        try {
          return { id: c.id, name: c.name, status: 'up' as const, responseTimeMs: await this.ping(c, 'health'), error: null }
        } catch (e) {
          return { id: c.id, name: c.name, status: 'down' as const, responseTimeMs: null, error: e instanceof AppError ? e.code : 'SOURCE_QUERY_FAILED' }
        }
      }),
    )
  }
}
