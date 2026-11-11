/**
 * Metadata discovery from ClickHouse system tables (system.databases / tables / columns /
 * data_skipping_indices). A ClickHouse database plays the role of a PostgreSQL schema.
 * Row counts come from system.tables.total_rows (exact for MergeTree, unknown for views); ClickHouse
 * keeps no per-column planner statistics, so column stats are left to the explicit profile action.
 */
import type { Config, SourceConnectionConfig } from '../config/config.ts'
import { sourceError } from '../http/errors.ts'
import { CachedMetadata, type ColumnInfo, type IndexInfo, type Privileges, type SchemaInfo, type ServerInfo, type SourceMetadata, type TableInfo, type TableMetadata } from './metadata.ts'
import { Params } from './sql.ts'
import type { SourceRegistry } from './sourceRegistry.ts'

const SYSTEM_DATABASES = ['system', 'INFORMATION_SCHEMA', 'information_schema']

/** Nullable(...) / LowCardinality(...) wrappers removed. */
export function baseType(t: string): string {
  const m = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(t)
  return m ? baseType(m[1]!) : t
}

export function clickhouseTypeCategory(t: string): ColumnInfo['typeCategory'] {
  const b = baseType(t)
  if (/^(U?Int\d+|Float\d+|BFloat16|Decimal)/.test(b)) return 'number'
  if (/^(Date|DateTime)/.test(b)) return 'date'
  if (b === 'Bool') return 'boolean'
  // UUID / IPv4 / IPv6 are not text in ClickHouse (no LIKE); they are compared via toString like other types.
  if (/^(String|FixedString|Enum8|Enum16)/.test(b)) return 'string'
  return 'other'
}

/** Splits a key expression list on top-level commas: "a, ifNull(b, 0)" → ["a", "ifNull(b, 0)"]. */
function splitKey(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let cur = ''
  for (const ch of expr) {
    if (ch === "'") quoted = !quoted
    else if (!quoted && ch === '(') depth++
    else if (!quoted && ch === ')') depth--
    else if (!quoted && depth === 0 && ch === ',') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function tableKind(engine: string): TableInfo['kind'] {
  if (engine === 'View') return 'view'
  if (engine === 'MaterializedView') return 'materialized_view'
  if (/MergeTree$|^(Memory|Log|TinyLog|StripeLog|Set|Join)$/.test(engine)) return 'table'
  return 'foreign_table'
}

const WRITE_PRIVILEGE = /\b(ALL|INSERT|ALTER|CREATE|DROP|TRUNCATE|OPTIMIZE)\b/

export class ClickHouseMetadataService extends CachedMetadata implements SourceMetadata {
  private readonly src: SourceRegistry
  private readonly timeoutMs: number

  constructor(src: SourceRegistry, config: Config) {
    super()
    this.src = src
    this.timeoutMs = config.limits.metadataTimeoutMs
  }

  private q<R extends Record<string, unknown>>(c: SourceConnectionConfig, sql: string, values: unknown[], kind: string, signal?: AbortSignal) {
    return this.src.run<R>(c, sql, values, { kind: `metadata.${kind}`, timeoutMs: this.timeoutMs, signal }).then((r) => r.rows)
  }

  async schemas(c: SourceConnectionConfig, signal?: AbortSignal, fresh = false): Promise<SchemaInfo[]> {
    return this.cached(`${c.id}|schemas`, 60_000, async () => {
      const p = new Params('clickhouse')
      const excluded = p.add(SYSTEM_DATABASES)
      const [dbs, counts] = await Promise.all([
        this.q<{ name: string }>(c, `SELECT name FROM system.databases WHERE NOT has(${excluded}, name) ORDER BY name`, p.values, 'schemas', signal),
        this.q<{ database: string; n: number }>(c, `SELECT database, count() AS n FROM system.tables WHERE NOT is_temporary AND NOT startsWith(name, '.inner') GROUP BY database`, [], 'schemas', signal),
      ])
      // system.databases only lists databases the account can access.
      return dbs
        .map((d) => ({ name: d.name, tableCount: Number(counts.find((x) => x.database === d.name)?.n ?? 0), canUse: true, isDefault: d.name === c.schema }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    }, fresh)
  }

  async tables(c: SourceConnectionConfig, schema: string, signal?: AbortSignal, fresh = false): Promise<TableInfo[]> {
    return this.cached(`${c.id}|tables|${schema}`, 60_000, async () => {
      const p = new Params('clickhouse')
      const db = p.add(schema)
      const [rows, counts] = await Promise.all([
        this.q<{ name: string; engine: string; total_rows: number | null; total_bytes: number | null; comment: string }>(
          c,
          `SELECT name, engine, total_rows, total_bytes, comment FROM system.tables
            WHERE database = ${db} AND NOT is_temporary AND NOT startsWith(name, '.inner') ORDER BY name`,
          p.values,
          'tables',
          signal,
        ),
        this.q<{ table: string; n: number }>(c, `SELECT table, count() AS n FROM system.columns WHERE database = ${db} GROUP BY table`, p.values, 'tables', signal),
      ])
      const columnCount = new Map(counts.map((x) => [x.table, Number(x.n)]))
      if (!rows.length) {
        const s = await this.schemas(c, signal)
        if (!s.some((x) => x.name === schema)) throw sourceError('SOURCE_SCHEMA_UNAVAILABLE', 'database not found')
      }
      return rows.map((r) => ({
        schema,
        name: r.name,
        kind: tableKind(r.engine),
        estimatedRows: r.total_rows == null ? null : Number(r.total_rows),
        totalBytes: r.total_bytes == null ? null : Number(r.total_bytes),
        columnCount: columnCount.get(r.name) ?? 0,
        comment: r.comment || null,
        lastAnalyzedAt: null,
        canSelect: true,
      }))
    }, fresh)
  }

  async table(c: SourceConnectionConfig, schema: string, name: string, signal?: AbortSignal, fresh = false): Promise<TableMetadata> {
    return this.cached(`${c.id}|table|${schema}.${name}`, 60_000, async () => {
      const info = (await this.tables(c, schema, signal, fresh)).find((t) => t.name === name)
      if (!info) throw sourceError('SOURCE_TABLE_UNAVAILABLE', 'table not found in catalog')
      const [columns, indexes] = await Promise.all([this.columns(c, schema, name, signal), this.indexes(c, schema, name, signal)])
      return { ...info, columns, indexes }
    }, fresh)
  }

  private async columns(c: SourceConnectionConfig, schema: string, table: string, signal?: AbortSignal): Promise<ColumnInfo[]> {
    const p = new Params('clickhouse')
    const rows = await this.q<{ name: string; position: number; type: string; default_kind: string; default_expression: string; comment: string }>(
      c,
      `SELECT name, position, type, default_kind, default_expression, comment FROM system.columns WHERE database = ${p.add(schema)} AND table = ${p.add(table)} ORDER BY position`,
      p.values,
      'columns',
      signal,
    )
    if (!rows.length) throw sourceError('SOURCE_TABLE_UNAVAILABLE', 'no columns')
    return rows.map((r) => ({
      name: r.name,
      ordinal: Number(r.position),
      dataType: r.type,
      typeCategory: clickhouseTypeCategory(r.type),
      nullable: r.type.startsWith('Nullable(') || r.type.startsWith('LowCardinality(Nullable('),
      defaultValue: r.default_kind ? `${r.default_kind} ${r.default_expression}` : null,
      comment: r.comment || null,
      stats: null,
    }))
  }

  /** The sorting (primary) key plus data-skipping indexes; a table without ORDER BY key has none. */
  private async indexes(c: SourceConnectionConfig, schema: string, table: string, signal?: AbortSignal): Promise<IndexInfo[]> {
    const p = new Params('clickhouse')
    const db = p.add(schema)
    const tb = p.add(table)
    const [keys, skipping] = await Promise.all([
      this.q<{ engine: string; primary_key: string; sorting_key: string }>(c, `SELECT engine, primary_key, sorting_key FROM system.tables WHERE database = ${db} AND name = ${tb}`, p.values, 'indexes', signal),
      this.q<{ name: string; type: string; expr: string; granularity: number; bytes: number | null }>(
        c,
        `SELECT name, type, expr, granularity, data_compressed_bytes AS bytes FROM system.data_skipping_indices WHERE database = ${db} AND table = ${tb} ORDER BY name`,
        p.values,
        'indexes',
        signal,
      ),
    ])
    const out: IndexInfo[] = []
    const k = keys[0]
    if (k?.sorting_key) {
      out.push({
        name: 'ORDER BY',
        columns: splitKey(k.sorting_key),
        unique: false,
        primary: true,
        method: k.engine,
        sizeBytes: null,
        definition: `ORDER BY (${k.sorting_key})${k.primary_key && k.primary_key !== k.sorting_key ? ` PRIMARY KEY (${k.primary_key})` : ''}`,
      })
    }
    for (const s of skipping) {
      out.push({ name: s.name, columns: [s.expr], unique: false, primary: false, method: s.type, sizeBytes: s.bytes == null ? null : Number(s.bytes), definition: `INDEX ${s.name} ${s.expr} TYPE ${s.type} GRANULARITY ${s.granularity}` })
    }
    return out
  }

  async serverInfo(c: SourceConnectionConfig, signal?: AbortSignal): Promise<ServerInfo> {
    const [i] = await this.q<{ version: string; now: string; tz: string; db: string; account: string }>(
      c,
      `SELECT version() AS version, toString(now()) AS now, timezone() AS tz, currentDatabase() AS db, currentUser() AS account`,
      [],
      'server',
      signal,
    )
    if (!i) throw sourceError('SOURCE_QUERY_FAILED')
    return { version: `ClickHouse ${i.version}`, serverTime: `${i.now} (${i.tz})`, database: i.db, account: i.account }
  }

  /**
   * Write privileges of the account from its direct grants (SHOW GRANTS). Privileges inherited
   * through roles are not expanded. Every DOD statement runs with readonly=2 regardless.
   */
  async privileges(c: SourceConnectionConfig, signal?: AbortSignal): Promise<Privileges> {
    const [grants, [who], tables] = await Promise.all([
      this.q<Record<string, string>>(c, 'SHOW GRANTS', [], 'privileges', signal),
      this.q<{ account: string; readonly: string }>(c, `SELECT currentUser() AS account, toString(getSetting('readonly')) AS readonly`, [], 'privileges', signal),
      this.tables(c, c.schema, signal),
    ])
    if (!who) throw sourceError('SOURCE_QUERY_FAILED')
    const stmts = grants.map((g) => String(Object.values(g)[0] ?? ''))
    let all = false
    const writable = new Set<string>()
    let canCreateInSchema = false
    let canCreateDatabase = false
    let superuser = false
    for (const g of stmts) {
      const m = /^GRANT (.+) ON (\S+) TO /.exec(g)
      if (!m) continue
      const [, privs, scope] = m as unknown as [string, string, string]
      if (/\b(ACCESS MANAGEMENT|CREATE USER|ROLE ADMIN)\b/.test(privs) || (/\bALL\b/.test(privs) && scope === '*.*')) superuser = true
      if (!WRITE_PRIVILEGE.test(privs)) continue
      const [db, tb] = scope.split('.') as [string, string | undefined]
      if (/\b(ALL|CREATE)\b/.test(privs) && (db === '*' || db === c.schema)) canCreateInSchema = true
      if (/\b(ALL|CREATE)\b/.test(privs) && db === '*') canCreateDatabase = true
      if (db === '*' || (db === c.schema && (tb === '*' || tb == null))) all = true
      else if (db === c.schema && tb) writable.add(tb)
    }
    const writableTables = all ? tables.length : tables.filter((t) => writable.has(t.name)).length
    return {
      account: who.account,
      superuser,
      canCreateDatabase,
      canCreateInSchema,
      writableTables,
      readableTables: tables.length,
      accountReadOnly: !superuser && !canCreateDatabase && !canCreateInSchema && writableTables === 0,
      sessionReadOnly: who.readonly !== '0',
    }
  }
}
