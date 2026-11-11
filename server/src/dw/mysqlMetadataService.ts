/**
 * MySQL / MariaDB: connection, test and metadata discovery (information_schema).
 *
 * - One mysql2 pool per connection, created lazily and reused.
 * - Every session runs `SET SESSION TRANSACTION READ ONLY` and a statement time limit, so a write
 *   fails in MySQL itself. DOD sends only its own catalog queries; there is no preview or dataset on
 *   MySQL yet (the analytics SQL builder needs GROUPING SETS).
 * - A MySQL database plays the role of a PostgreSQL schema.
 */
import mysql from 'mysql2/promise'
import type { Config, SourceConnectionConfig } from '../config/config.ts'
import { toSourceError } from '../http/errors.ts'
import { CachedMetadata, type ColumnInfo, type IndexInfo, type Privileges, type SchemaInfo, type ServerInfo, type SourceMetadata, type TableInfo, type TableMetadata } from './metadata.ts'
import type { SourceRegistry } from './sourceRegistry.ts'

const SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys']

export function mysqlTypeCategory(t: string): ColumnInfo['typeCategory'] {
  const b = t.toLowerCase()
  if (/^(tinyint\(1\)|bool)/.test(b)) return 'boolean'
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit)/.test(b)) return 'number'
  if (/^(date|datetime|timestamp|time|year)/.test(b)) return 'date'
  if (/^(char|varchar|text|tinytext|mediumtext|longtext|enum|set)/.test(b)) return 'string'
  return 'other'
}

type Row = Record<string, unknown>

export class MysqlMetadataService extends CachedMetadata implements SourceMetadata {
  private readonly src: SourceRegistry
  private readonly timeoutMs: number
  private readonly pools = new Map<string, mysql.Pool>()

  constructor(src: SourceRegistry, config: Config) {
    super()
    this.src = src
    this.timeoutMs = config.limits.metadataTimeoutMs
    src.onReset(async (id) => {
      const p = this.pools.get(id)
      this.pools.delete(id)
      await p?.end()
    })
  }

  private pool(c: SourceConnectionConfig): mysql.Pool {
    let p = this.pools.get(c.id)
    if (p) return p
    p = mysql.createPool({
      host: c.host,
      port: c.port,
      user: c.username,
      password: this.src.secret(c) ?? undefined,
      database: c.database || undefined,
      connectTimeout: c.connectTimeoutMs,
      connectionLimit: c.pool.max,
      maxIdle: Math.max(c.pool.min, 1),
      idleTimeout: c.pool.idleTimeoutMs,
      ssl: c.sslMode === 'disable' ? undefined : { rejectUnauthorized: c.sslMode === 'verify-full', ca: c.sslRootCert ?? undefined },
      dateStrings: true,
      supportBigNumbers: true,
    })
    // Read-only session and a statement ceiling on every new connection.
    p.on('connection', (conn) => {
      conn.query('SET SESSION TRANSACTION READ ONLY')
      conn.query(`SET SESSION max_execution_time = ${Math.max(1000, c.commandTimeoutMs)}`)
    })
    this.pools.set(c.id, p)
    return p
  }

  private async q<R extends Row>(c: SourceConnectionConfig, sql: string, values: unknown[] = []): Promise<R[]> {
    try {
      const [rows] = await this.pool(c).query({ sql, values, timeout: this.timeoutMs })
      return rows as R[]
    } catch (e) {
      throw toSourceError(e)
    }
  }

  async ping(c: SourceConnectionConfig): Promise<number> {
    const t = performance.now()
    await this.q(c, 'SELECT 1 AS ok')
    return Math.round(performance.now() - t)
  }

  async schemas(c: SourceConnectionConfig, _signal?: AbortSignal, fresh = false): Promise<SchemaInfo[]> {
    return this.cached(`${c.id}|schemas`, 60_000, async () => {
      const rows = await this.q<{ name: string; n: number }>(
        c,
        `SELECT s.SCHEMA_NAME AS name, COUNT(t.TABLE_NAME) AS n FROM information_schema.SCHEMATA s
         LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
         WHERE s.SCHEMA_NAME NOT IN (?) GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME`,
        [SYSTEM],
      )
      return rows.map((r) => ({ name: r.name, tableCount: Number(r.n), canUse: true, isDefault: r.name === c.schema }))
    }, fresh)
  }

  async tables(c: SourceConnectionConfig, schema: string, _signal?: AbortSignal, fresh = false): Promise<TableInfo[]> {
    return this.cached(`${c.id}|tables|${schema}`, 60_000, async () => {
      const rows = await this.q<Row>(
        c,
        `SELECT t.TABLE_NAME AS name, t.TABLE_TYPE AS type, t.TABLE_ROWS AS est, t.DATA_LENGTH + t.INDEX_LENGTH AS bytes,
                t.TABLE_COMMENT AS comment, COALESCE(t.UPDATE_TIME, t.CREATE_TIME) AS analyzed,
                (SELECT COUNT(*) FROM information_schema.COLUMNS k WHERE k.TABLE_SCHEMA = t.TABLE_SCHEMA AND k.TABLE_NAME = t.TABLE_NAME) AS cols
         FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = ? ORDER BY t.TABLE_NAME`,
        [schema],
      )
      return rows.map((r) => this.info(schema, r))
    }, fresh)
  }

  private info(schema: string, r: Row): TableInfo {
    const view = r.type === 'VIEW'
    return {
      schema,
      name: String(r.name),
      kind: view ? 'view' : 'table',
      estimatedRows: view || r.est == null ? null : Number(r.est),
      totalBytes: view || r.bytes == null ? null : Number(r.bytes),
      columnCount: Number(r.cols ?? 0),
      comment: r.comment ? String(r.comment) : null,
      lastAnalyzedAt: r.analyzed ? new Date(String(r.analyzed).replace(' ', 'T')).toISOString() : null,
      canSelect: true,
    }
  }

  async table(c: SourceConnectionConfig, schema: string, name: string, _signal?: AbortSignal, fresh = false): Promise<TableMetadata> {
    return this.cached(`${c.id}|table|${schema}.${name}`, 60_000, async () => {
      const t = (await this.tables(c, schema, undefined, fresh)).find((x) => x.name === name)
      if (!t) throw toSourceError({ code: 'ER_NO_SUCH_TABLE' })
      const cols = await this.q<Row>(
        c,
        `SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ord, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, COLUMN_COMMENT AS comment
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [schema, name],
      )
      const idx = await this.q<Row>(
        c,
        `SELECT INDEX_NAME AS name, COLUMN_NAME AS col, NON_UNIQUE AS nonUnique, INDEX_TYPE AS method
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [schema, name],
      )
      const indexes = new Map<string, IndexInfo>()
      for (const r of idx) {
        const n = String(r.name)
        const i = indexes.get(n) ?? { name: n, columns: [], unique: Number(r.nonUnique) === 0, primary: n === 'PRIMARY', method: String(r.method).toLowerCase(), sizeBytes: null, definition: '' }
        i.columns.push(String(r.col))
        i.definition = `${i.primary ? 'PRIMARY KEY' : i.unique ? 'UNIQUE INDEX' : 'INDEX'} (${i.columns.join(', ')}) USING ${r.method}`
        indexes.set(n, i)
      }
      return {
        ...t,
        columns: cols.map((r) => ({
          name: String(r.name),
          ordinal: Number(r.ord),
          dataType: String(r.type),
          typeCategory: mysqlTypeCategory(String(r.type)),
          nullable: r.nullable === 'YES',
          defaultValue: r.def == null ? null : String(r.def),
          comment: r.comment ? String(r.comment) : null,
          stats: null,
        })),
        indexes: [...indexes.values()],
      }
    }, fresh)
  }

  async serverInfo(c: SourceConnectionConfig): Promise<ServerInfo> {
    const [r] = await this.q<Row>(c, 'SELECT VERSION() AS v, DATE_FORMAT(UTC_TIMESTAMP(), "%Y-%m-%dT%H:%i:%sZ") AS t, DATABASE() AS d, CURRENT_USER() AS u')
    return { version: `MySQL ${r!.v}`, serverTime: String(r!.t), database: String(r!.d ?? c.database), account: String(r!.u) }
  }

  async privileges(c: SourceConnectionConfig): Promise<Privileges> {
    const grants = (await this.q<Row>(c, 'SHOW GRANTS')).map((r) => String(Object.values(r)[0]))
    const writes = grants.filter((g) => /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/.test(g.split(' ON ')[0] ?? ''))
    const account = (await this.serverInfo(c)).account
    return {
      account,
      superuser: grants.some((g) => /ALL PRIVILEGES ON \*\.\*/.test(g)),
      canCreateDatabase: grants.some((g) => /\b(ALL PRIVILEGES|CREATE)\b.* ON \*\.\*/.test(g)),
      canCreateInSchema: writes.some((g) => /\bCREATE\b|ALL PRIVILEGES/.test(g)),
      writableTables: 0,
      readableTables: (await this.tables(c, c.schema).catch(() => [])).length,
      accountReadOnly: writes.length === 0,
      sessionReadOnly: true,
    }
  }
}
