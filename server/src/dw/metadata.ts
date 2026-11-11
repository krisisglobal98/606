/**
 * Source metadata contract shared by every source type, and the dispatcher that routes a connection
 * to its catalog reader (PostgreSQL system catalogs, ClickHouse system tables, MySQL
 * information_schema, MongoDB collections, Redis key groups).
 */
import { ANALYTIC_DB_TYPES, type SourceConnectionConfig, type SourceDbType } from '../config/config.ts'
import { AppError } from '../http/errors.ts'
import type { ClickHouseMetadataService } from './clickhouseMetadataService.ts'
import type { MongoMetadataService } from './mongoMetadataService.ts'
import type { MysqlMetadataService } from './mysqlMetadataService.ts'
import type { PostgresMetadataService } from './postgresMetadataService.ts'
import type { RedisMetadataService } from './redisMetadataService.ts'

/** What DOD can do with a source type today. Connect, test and browse work for every type. */
export interface Capabilities {
  preview: boolean
  profile: boolean
  exactCount: boolean
  dataset: boolean
}

export function capabilitiesOf(t: SourceDbType): Capabilities {
  const sql = ANALYTIC_DB_TYPES.has(t)
  return { preview: sql, profile: sql, exactCount: sql, dataset: sql }
}

const TYPE_NAME: Record<SourceDbType, string> = { postgresql: 'PostgreSQL', clickhouse: 'ClickHouse', mysql: 'MySQL', mongodb: 'MongoDB', redis: 'Redis' }

/** A feature that is not implemented for a source type yet (stated, never faked). */
export const unsupported = (c: Pick<SourceConnectionConfig, 'dbType'>, feature: string) =>
  new AppError(501, 'SOURCE_FEATURE_UNAVAILABLE', `${feature} belum tersedia untuk ${TYPE_NAME[c.dbType]}. Saat ini DOD dapat menghubungkan, menguji, dan menjelajahi struktur sumber ini.`)

export function requireCapability(c: SourceConnectionConfig, cap: keyof Capabilities, feature: string) {
  if (!capabilitiesOf(c.dbType)[cap]) throw unsupported(c, feature)
}

export interface SchemaInfo {
  name: string
  tableCount: number
  canUse: boolean
  isDefault: boolean
}

export interface TableInfo {
  schema: string
  name: string
  kind: 'table' | 'view' | 'materialized_view' | 'partitioned_table' | 'foreign_table'
  estimatedRows: number | null
  totalBytes: number | null
  columnCount: number
  comment: string | null
  lastAnalyzedAt: string | null
  canSelect: boolean
}

export interface ColumnStats {
  nullFraction: number | null
  distinctEstimate: number | null
  commonValues: string[]
  min: string | null
  max: string | null
}

export interface ColumnInfo {
  name: string
  ordinal: number
  dataType: string
  typeCategory: 'number' | 'string' | 'date' | 'boolean' | 'other'
  nullable: boolean
  defaultValue: string | null
  comment: string | null
  stats: ColumnStats | null
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  method: string
  sizeBytes: number | null
  definition: string
}

export interface TableMetadata extends TableInfo {
  columns: ColumnInfo[]
  indexes: IndexInfo[]
}

export interface Privileges {
  account: string
  superuser: boolean
  canCreateDatabase: boolean
  canCreateInSchema: boolean
  writableTables: number
  readableTables: number
  accountReadOnly: boolean
  /** DOD's own guard: every session/statement runs read-only. */
  sessionReadOnly: boolean
}

export interface ServerInfo {
  version: string
  serverTime: string
  database: string
  account: string
}

/** Catalog reader of one source type. */
export interface SourceMetadata {
  schemas(c: SourceConnectionConfig, signal?: AbortSignal, fresh?: boolean): Promise<SchemaInfo[]>
  tables(c: SourceConnectionConfig, schema: string, signal?: AbortSignal, fresh?: boolean): Promise<TableInfo[]>
  table(c: SourceConnectionConfig, schema: string, name: string, signal?: AbortSignal, fresh?: boolean): Promise<TableMetadata>
  privileges(c: SourceConnectionConfig, signal?: AbortSignal): Promise<Privileges>
  serverInfo(c: SourceConnectionConfig, signal?: AbortSignal): Promise<ServerInfo>
  invalidate(connectionId: string): void
}

/** Short-lived in-memory cache keyed by `<connectionId>|...`. */
export abstract class CachedMetadata {
  private readonly cache = new Map<string, { at: number; value: unknown }>()

  protected async cached<T>(key: string, ttlMs: number, load: () => Promise<T>, fresh = false): Promise<T> {
    const hit = this.cache.get(key)
    if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value as T
    const value = await load()
    this.cache.set(key, { at: Date.now(), value })
    return value
  }

  invalidate(connectionId: string) {
    for (const k of this.cache.keys()) if (k.startsWith(`${connectionId}|`)) this.cache.delete(k)
  }
}

export interface OtherSources {
  mysql: MysqlMetadataService
  mongodb: MongoMetadataService
  redis: RedisMetadataService
}

/** Routes each call to the catalog reader of the connection's database type. */
export class MetadataService implements SourceMetadata {
  private readonly pg: PostgresMetadataService
  private readonly ch: ClickHouseMetadataService
  private readonly other: Partial<OtherSources>

  /** `other` is optional so PostgreSQL/ClickHouse-only setups (and tests) keep working. */
  constructor(pg: PostgresMetadataService, ch: ClickHouseMetadataService, other: Partial<OtherSources> = {}) {
    this.pg = pg
    this.ch = ch
    this.other = other
  }

  private of(c: SourceConnectionConfig): SourceMetadata {
    if (c.dbType === 'postgresql') return this.pg
    if (c.dbType === 'clickhouse') return this.ch
    const m = this.other[c.dbType]
    if (!m) throw unsupported(c, 'Koneksi')
    return m
  }

  /** Round trip in ms for the non-SQL-engine sources (PostgreSQL/ClickHouse use SourceRegistry.run). */
  async ping(c: SourceConnectionConfig): Promise<number> {
    const m = this.other[c.dbType as keyof OtherSources]
    if (!m) throw unsupported(c, 'Koneksi')
    return m.ping(c)
  }

  schemas(c: SourceConnectionConfig, signal?: AbortSignal, fresh = false) {
    return this.of(c).schemas(c, signal, fresh)
  }
  tables(c: SourceConnectionConfig, schema: string, signal?: AbortSignal, fresh = false) {
    return this.of(c).tables(c, schema, signal, fresh)
  }
  table(c: SourceConnectionConfig, schema: string, name: string, signal?: AbortSignal, fresh = false) {
    return this.of(c).table(c, schema, name, signal, fresh)
  }
  privileges(c: SourceConnectionConfig, signal?: AbortSignal) {
    return this.of(c).privileges(c, signal)
  }
  serverInfo(c: SourceConnectionConfig, signal?: AbortSignal) {
    return this.of(c).serverInfo(c, signal)
  }
  invalidate(connectionId: string) {
    this.pg.invalidate(connectionId)
    this.ch.invalidate(connectionId)
    for (const m of Object.values(this.other)) m.invalidate(connectionId)
  }
}
