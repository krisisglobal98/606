/**
 * Metadata discovery from PostgreSQL system catalogs. Nothing here is hard-coded per table:
 * schemas, tables, columns, indexes and statistics are read live from pg_catalog / pg_stats.
 * Row counts use planner statistics (reltuples); exact counts and profiles are explicit, bounded actions.
 */
import type { Config, SourceConnectionConfig } from '../config/config.ts'
import { sourceError } from '../http/errors.ts'
import { CachedMetadata, type ColumnInfo, type IndexInfo, type Privileges, type SchemaInfo, type ServerInfo, type SourceMetadata, type TableInfo, type TableMetadata } from './metadata.ts'
import type { SourceRegistry } from './sourceRegistry.ts'

const KIND: Record<string, TableInfo['kind']> = { r: 'table', v: 'view', m: 'materialized_view', p: 'partitioned_table', f: 'foreign_table' }

export function typeCategory(t: string): ColumnInfo['typeCategory'] {
  if (/^(smallint|integer|bigint|numeric|real|double precision|decimal|money)/.test(t)) return 'number'
  if (/^(timestamp|date|time)/.test(t)) return 'date'
  if (t === 'boolean') return 'boolean'
  if (/^(text|character|varchar|char|citext|uuid|name)/.test(t)) return 'string'
  return 'other'
}

export class PostgresMetadataService extends CachedMetadata implements SourceMetadata {
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
      const rows = await this.q<{ name: string; table_count: string; can_use: boolean }>(
        c,
        `SELECT n.nspname AS name,
                count(cl.oid) FILTER (WHERE cl.relkind IN ('r','v','m','p','f')) AS table_count,
                has_schema_privilege(n.oid, 'USAGE') AS can_use
           FROM pg_catalog.pg_namespace n
           LEFT JOIN pg_catalog.pg_class cl ON cl.relnamespace = n.oid
          WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
          GROUP BY n.oid, n.nspname
          ORDER BY (n.nspname = $1) DESC, n.nspname`,
        [c.schema],
        'schemas',
        signal,
      )
      return rows.map((r) => ({ name: r.name, tableCount: Number(r.table_count), canUse: r.can_use, isDefault: r.name === c.schema }))
    }, fresh)
  }

  async tables(c: SourceConnectionConfig, schema: string, signal?: AbortSignal, fresh = false): Promise<TableInfo[]> {
    return this.cached(`${c.id}|tables|${schema}`, 60_000, async () => {
      const rows = await this.q<{
        schema: string
        name: string
        relkind: string
        reltuples: number
        total_bytes: string | null
        column_count: string
        remarks: string | null
        last_analyzed: Date | null
        can_select: boolean
      }>(
        c,
        `SELECT n.nspname AS schema, cl.relname AS name, cl.relkind, cl.reltuples::float8 AS reltuples,
                CASE WHEN cl.relkind IN ('r','m','p') THEN pg_catalog.pg_total_relation_size(cl.oid) END AS total_bytes,
                (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped) AS column_count,
                pg_catalog.obj_description(cl.oid, 'pg_class') AS remarks,
                GREATEST(st.last_analyze, st.last_autoanalyze) AS last_analyzed,
                has_table_privilege(cl.oid, 'SELECT') AS can_select
           FROM pg_catalog.pg_class cl
           JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
           LEFT JOIN pg_catalog.pg_stat_all_tables st ON st.relid = cl.oid
          WHERE n.nspname = $1 AND cl.relkind IN ('r','v','m','p','f') AND NOT cl.relispartition
          ORDER BY cl.relname`,
        [schema],
        'tables',
        signal,
      )
      if (!rows.length) {
        const s = await this.schemas(c, signal)
        if (!s.some((x) => x.name === schema)) throw sourceError('SOURCE_SCHEMA_UNAVAILABLE', 'schema not found')
      }
      return rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        kind: KIND[r.relkind] ?? 'table',
        // reltuples is -1 (PG14+) or 0 when the table was never analysed.
        estimatedRows: r.reltuples > 0 ? Math.round(r.reltuples) : null,
        totalBytes: r.total_bytes == null ? null : Number(r.total_bytes),
        columnCount: Number(r.column_count),
        comment: r.remarks,
        lastAnalyzedAt: r.last_analyzed ? r.last_analyzed.toISOString() : null,
        canSelect: r.can_select,
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

  async columns(c: SourceConnectionConfig, schema: string, table: string, signal?: AbortSignal): Promise<ColumnInfo[]> {
    const rows = await this.q<{
      name: string
      ordinal: number
      data_type: string
      not_null: boolean
      default_value: string | null
      remarks: string | null
      null_frac: number | null
      n_distinct: number | null
      reltuples: number
      common_values: string[] | null
      bounds: string[] | null
    }>(
      c,
      `SELECT a.attname AS name, a.attnum AS ordinal, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              a.attnotnull AS not_null, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value,
              pg_catalog.col_description(a.attrelid, a.attnum) AS remarks,
              s.null_frac::float8 AS null_frac, s.n_distinct::float8 AS n_distinct, cl.reltuples::float8 AS reltuples,
              (s.most_common_vals::text::text[])[1:5] AS common_values,
              CASE WHEN s.histogram_bounds IS NOT NULL THEN ARRAY[(s.histogram_bounds::text::text[])[1], (s.histogram_bounds::text::text[])[array_length(s.histogram_bounds::text::text[], 1)]] END AS bounds
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class cl ON cl.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         LEFT JOIN pg_catalog.pg_stats s ON s.schemaname = n.nspname AND s.tablename = cl.relname AND s.attname = a.attname
        WHERE n.nspname = $1 AND cl.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [schema, table],
      'columns',
      signal,
    )
    if (!rows.length) throw sourceError('SOURCE_TABLE_UNAVAILABLE', 'no columns')
    return rows.map((r) => {
      const hasStats = r.null_frac != null
      const distinct = r.n_distinct == null ? null : r.n_distinct >= 0 ? r.n_distinct : r.reltuples > 0 ? Math.round(-r.n_distinct * r.reltuples) : null
      return {
        name: r.name,
        ordinal: r.ordinal,
        dataType: r.data_type,
        typeCategory: typeCategory(r.data_type),
        nullable: !r.not_null,
        defaultValue: r.default_value,
        comment: r.remarks,
        stats: hasStats ? { nullFraction: r.null_frac, distinctEstimate: distinct, commonValues: r.common_values ?? [], min: r.bounds?.[0] ?? null, max: r.bounds?.[1] ?? null } : null,
      }
    })
  }

  async indexes(c: SourceConnectionConfig, schema: string, table: string, signal?: AbortSignal): Promise<IndexInfo[]> {
    const rows = await this.q<{ name: string; columns: string[]; unique: boolean; primary: boolean; method: string; size_bytes: string | null; definition: string }>(
      c,
      `SELECT ic.relname AS name,
              ARRAY(SELECT COALESCE(a.attname::text, '(ekspresi)') FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(attnum, o)
                      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
                     ORDER BY k.o)::text[] AS columns,
              ix.indisunique AS unique, ix.indisprimary AS primary, am.amname AS method,
              pg_catalog.pg_relation_size(ic.oid) AS size_bytes,
              pg_catalog.pg_get_indexdef(ix.indexrelid) AS definition
         FROM pg_catalog.pg_index ix
         JOIN pg_catalog.pg_class tc ON tc.oid = ix.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = tc.relnamespace
         JOIN pg_catalog.pg_class ic ON ic.oid = ix.indexrelid
         JOIN pg_catalog.pg_am am ON am.oid = ic.relam
        WHERE n.nspname = $1 AND tc.relname = $2
        ORDER BY ix.indisprimary DESC, ic.relname`,
      [schema, table],
      'indexes',
      signal,
    )
    return rows.map((r) => ({ name: r.name, columns: r.columns, unique: r.unique, primary: r.primary, method: r.method, sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes), definition: r.definition }))
  }

  async serverInfo(c: SourceConnectionConfig, signal?: AbortSignal): Promise<ServerInfo> {
    const [i] = await this.q<{ version: string; now: Date | string; db: string; account: string }>(
      c,
      `SELECT current_setting('server_version') AS version, now() AS now, current_database() AS db, current_user AS account`,
      [],
      'server',
      signal,
    )
    if (!i) throw sourceError('SOURCE_QUERY_FAILED')
    return { version: `PostgreSQL ${i.version}`, serverTime: i.now instanceof Date ? i.now.toISOString() : String(i.now), database: i.db, account: i.account }
  }

  /** Privileges of the connection account: used to warn when the account can write. */
  async privileges(c: SourceConnectionConfig, signal?: AbortSignal): Promise<Privileges> {
    const [r] = await this.q<{
      user: string
      superuser: boolean
      can_create_db: boolean
      can_create_schema: boolean
      writable_tables: string
      readable_tables: string
      session_read_only: string
    }>(
      c,
      `SELECT current_user AS user,
              COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user), false) AS superuser,
              COALESCE((SELECT rolcreatedb FROM pg_catalog.pg_roles WHERE rolname = current_user), false) AS can_create_db,
              has_schema_privilege($1, 'CREATE') AS can_create_schema,
              (SELECT count(*) FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
                WHERE n.nspname = $1 AND cl.relkind IN ('r','p')
                  AND (has_table_privilege(cl.oid, 'INSERT') OR has_table_privilege(cl.oid, 'UPDATE') OR has_table_privilege(cl.oid, 'DELETE') OR has_table_privilege(cl.oid, 'TRUNCATE'))) AS writable_tables,
              (SELECT count(*) FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
                WHERE n.nspname = $1 AND cl.relkind IN ('r','p','v','m') AND has_table_privilege(cl.oid, 'SELECT')) AS readable_tables,
              current_setting('transaction_read_only') AS session_read_only`,
      [c.schema],
      'privileges',
      signal,
    )
    if (!r) throw sourceError('SOURCE_QUERY_FAILED')
    const writable = Number(r.writable_tables)
    return {
      account: r.user,
      superuser: r.superuser,
      canCreateDatabase: r.can_create_db,
      canCreateInSchema: r.can_create_schema,
      writableTables: writable,
      readableTables: Number(r.readable_tables),
      accountReadOnly: !r.superuser && !r.can_create_db && !r.can_create_schema && writable === 0,
      /** DOD's own guard: every session/transaction is opened READ ONLY. */
      sessionReadOnly: r.session_read_only === 'on',
    }
  }
}
