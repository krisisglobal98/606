/**
 * DOD datasets over external source tables. A dataset references a connection by id (never copies
 * credentials) and stores its semantic model in DOD's metadata DB. Source data is not copied.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { MetadataDb } from '../db/metadataDb.ts'
import type { DataWarehouseService } from '../dw/dataWarehouseService.ts'
import { requireCapability, type MetadataService, type TableMetadata } from '../dw/metadata.ts'
import type { SourceRegistry } from '../dw/sourceRegistry.ts'
import { dialectOf, quoteIdent } from '../dw/sql.ts'
import { SqlBuilder } from '../analytics/sqlBuilder.ts'
import type { RowScope } from '../dataAccess/guard.ts'
import { AppError, badRequest, notFound } from '../http/errors.ts'
import type { Config } from '../config/config.ts'
import { normalizeModel, SemanticModelSchema, suggestModel, TIME_DIMENSIONS, validateModel, type SemanticModel } from './semantic.ts'

export interface DatasetRecord {
  id: string
  name: string
  description: string
  connectionId: string
  connectionName: string
  environment: string
  schema: string
  sourceTables: string[]
  status: 'draft' | 'active' | 'archived'
  semantic: SemanticModel
  /** Category (or sub-category) of the master list; parent filled for a sub-category. */
  category: { id: string; name: string; parentId: string | null; parentName: string | null } | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type DatasetSummary = Omit<DatasetRecord, 'semantic'> & { dimensionCount: number; measureCount: number }

/** Field definition in the shape the Analysis page already uses. */
export interface CatalogField {
  id: string
  label: string
  kind: 'dimension' | 'measure'
  dataType: 'date' | 'string' | 'number'
  unit?: string
  decimals?: number
  description?: string
}

export const CreateDatasetSchema = z.object({
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
  description: z.string().trim().max(1000).default(''),
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  tables: z.array(z.string().min(1)).min(1).max(4),
  semantic: SemanticModelSchema.optional(),
  categoryId: z.string().min(1).nullable().default(null),
})

export const UpdateDatasetSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  semantic: SemanticModelSchema.optional(),
  /** null removes the category. */
  categoryId: z.string().min(1).nullable().optional(),
})

interface Row {
  id: string
  name: string
  description: string
  connection_id: string
  schema_name: string
  source_tables: string[]
  status: DatasetRecord['status']
  semantic: SemanticModel
  category_id: string | null
  category_name: string | null
  parent_id: string | null
  parent_name: string | null
  created_by: string | null
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT d.*, c.name AS category_name, p.id AS parent_id, p.name AS parent_name
  FROM dor_dataset d LEFT JOIN dor_category c ON c.id = d.category_id LEFT JOIN dor_category p ON p.id = c.parent_id`

export class DatasetService {
  private readonly db: MetadataDb
  private readonly dw: DataWarehouseService
  private readonly src: SourceRegistry
  private readonly meta: MetadataService
  private readonly config: Config
  private readonly cache = new Map<string, { at: number; value: unknown }>()

  constructor(db: MetadataDb, dw: DataWarehouseService, src: SourceRegistry, meta: MetadataService, config: Config) {
    this.db = db
    this.dw = dw
    this.src = src
    this.meta = meta
    this.config = config
  }

  private toRecord(r: Row): DatasetRecord {
    const c = this.src.get(r.connection_id)
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      connectionId: r.connection_id,
      connectionName: c?.name ?? r.connection_id,
      environment: c?.environment ?? 'unknown',
      schema: r.schema_name,
      sourceTables: r.source_tables,
      status: r.status,
      semantic: r.semantic,
      category: r.category_id ? { id: r.category_id, name: r.category_name ?? '', parentId: r.parent_id, parentName: r.parent_name } : null,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<DatasetSummary[]> {
    const rows = (await this.db.query<Row>(`${SELECT} ${opts.includeArchived ? '' : "WHERE d.status <> 'archived'"} ORDER BY d.updated_at DESC`)).rows
    return rows.map((r) => {
      const { semantic, ...rest } = this.toRecord(r)
      return { ...rest, dimensionCount: semantic.dimensions.length + TIME_DIMENSIONS.length, measureCount: semantic.measures.length }
    })
  }

  /** Every active dataset with its model, in one query (the catalog; list() + get() per dataset was 1 + N queries). */
  async activeRecords(): Promise<DatasetRecord[]> {
    const rows = (await this.db.query<Row>(`${SELECT} WHERE d.status = 'active' ORDER BY d.updated_at DESC`)).rows
    return rows.map((r) => this.toRecord(r))
  }

  async get(id: string): Promise<DatasetRecord> {
    const r = (await this.db.query<Row>(`${SELECT} WHERE d.id = $1`, [id])).rows[0]
    if (!r) throw notFound('Dataset tidak ditemukan.')
    return this.toRecord(r)
  }

  /** Configuration of a dataset's source connection. */
  connection(connectionId: string) {
    return this.dw.config(connectionId)
  }

  /** Live metadata of the dataset's source tables (cached briefly by the metadata service). */
  async tables(connectionId: string, schema: string, names: string[], signal?: AbortSignal): Promise<TableMetadata[]> {
    const c = this.dw.config(connectionId)
    return Promise.all(names.map((t) => this.meta.table(c, schema, t, signal)))
  }

  private async assertCategory(id: string | null | undefined) {
    if (id && !(await this.db.query('SELECT 1 FROM dor_category WHERE id = $1', [id])).rowCount) throw badRequest('UNKNOWN_CATEGORY', 'Kategori yang dipilih tidak ditemukan.')
  }

  async suggest(connectionId: string, schema: string, tables: string[], signal?: AbortSignal) {
    requireCapability(this.dw.config(connectionId), 'dataset', 'Dataset analitik')
    const meta = await this.tables(connectionId, schema, tables, signal)
    const model = suggestModel(meta)
    if (!model.sources.length) throw badRequest('NO_DATE_COLUMN', 'Tabel yang dipilih tidak memiliki kolom tanggal, sehingga belum bisa dijadikan dataset analitik.')
    return { semantic: model, problems: validateModel(model, meta), tables: meta.map((t) => ({ name: t.name, columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType, typeCategory: c.typeCategory })) })) }
  }

  async create(input: z.infer<typeof CreateDatasetSchema>, userId: string | null): Promise<DatasetRecord> {
    requireCapability(this.dw.config(input.connectionId), 'dataset', 'Dataset analitik')
    await this.assertCategory(input.categoryId)
    const meta = await this.tables(input.connectionId, input.schema, input.tables)
    const semantic = normalizeModel(input.semantic ?? suggestModel(meta))
    const problems = validateModel(semantic, meta)
    if (problems.length) throw new AppError(422, 'INVALID_MAPPING', `Pemetaan dataset belum valid: ${problems.slice(0, 5).join(' ')}`)
    const id = `wh-${randomBytes(5).toString('hex')}`
    try {
      await this.db.query(
        `INSERT INTO dor_dataset (id, name, description, connection_id, schema_name, source_tables, status, semantic, created_by, category_id) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9)`,
        [id, input.name, input.description, input.connectionId, input.schema, semantic.sources.map((s) => s.table), JSON.stringify(semantic), userId, input.categoryId],
      )
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'DATASET_EXISTS', `Dataset bernama "${input.name}" sudah ada.`)
      throw e
    }
    await this.audit(userId, 'dataset.create', id, { name: input.name, tables: input.tables })
    return this.get(id)
  }

  async update(id: string, patch: z.infer<typeof UpdateDatasetSchema>, userId: string | null): Promise<DatasetRecord> {
    const cur = await this.get(id)
    await this.assertCategory(patch.categoryId)
    if (patch.semantic) patch = { ...patch, semantic: normalizeModel(patch.semantic) }
    if (patch.semantic) {
      const meta = await this.tables(cur.connectionId, cur.schema, patch.semantic.sources.map((s) => s.table))
      const problems = validateModel(patch.semantic, meta)
      if (problems.length) throw new AppError(422, 'INVALID_MAPPING', `Pemetaan dataset belum valid: ${problems.slice(0, 5).join(' ')}`)
    }
    try {
      await this.db.query(
        `UPDATE dor_dataset SET name = COALESCE($2, name), description = COALESCE($3, description), status = COALESCE($4, status),
                semantic = COALESCE($5::jsonb, semantic), source_tables = COALESCE($6, source_tables),
                category_id = CASE WHEN $7 THEN $8 ELSE category_id END, updated_at = now() WHERE id = $1`,
        [id, patch.name ?? null, patch.description ?? null, patch.status ?? null, patch.semantic ? JSON.stringify(patch.semantic) : null, patch.semantic ? patch.semantic.sources.map((s) => s.table) : null, patch.categoryId !== undefined, patch.categoryId ?? null],
      )
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'DATASET_EXISTS', 'Nama dataset sudah dipakai.')
      throw e
    }
    this.cache.clear()
    await this.audit(userId, 'dataset.update', id, { fields: Object.keys(patch) })
    return this.get(id)
  }

  /** Deletes the dataset's definition from DOD (the source tables are not touched). */
  async remove(id: string, userId: string | null) {
    const d = await this.get(id)
    await this.db.query('DELETE FROM dor_dataset WHERE id = $1', [id])
    this.cache.clear()
    await this.audit(userId, 'dataset.delete', id, { name: d.name, connectionId: d.connectionId })
  }

  private audit(userId: string | null, action: string, target: string, detail: unknown) {
    return this.db.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1,$2,$3,$4)', [userId, action, target, JSON.stringify(detail)])
  }

  /** Field List for the Analysis page, built from the semantic model. */
  fields(d: DatasetRecord): CatalogField[] {
    const m = d.semantic
    return [
      ...TIME_DIMENSIONS.map((t) => ({ id: t.id, label: t.label, kind: 'dimension' as const, dataType: t.id === 'tanggal' || t.id === 'hari' ? ('date' as const) : ('string' as const), description: t.description })),
      ...m.dimensions.map((x) => ({ id: x.id, label: x.label, kind: 'dimension' as const, dataType: 'string' as const, description: x.description ?? `Kolom: ${Object.entries(x.columns).filter(([, c]) => c).map(([a, c]) => `${m.sources.find((s) => s.alias === a)?.label ?? a}.${c}`).join(', ')}` })),
      ...m.measures.map((x) => ({
        id: x.id,
        label: x.label,
        kind: 'measure' as const,
        dataType: 'number' as const,
        unit: x.unit,
        decimals: x.decimals,
        description:
          x.description ??
          (x.type === 'ratio'
            ? `${m.measures.find((y) => y.id === x.numerator)?.label} ÷ ${m.measures.find((y) => y.id === x.denominator)?.label}${x.scale !== 1 ? ` × ${x.scale}` : ''}`
            : `${x.type === 'snapshot' ? 'Nilai per blok (tidak dijumlah per hari)' : 'SUM'} dari ${m.sources.find((s) => s.alias === x.source)?.label}.${x.column}`),
      })),
    ]
  }

  /** Date coverage of the dataset (MIN/MAX of each date column; uses the date index when present). */
  async coverage(d: DatasetRecord, scope: RowScope, signal?: AbortSignal, opts: { fresh?: boolean } = {}): Promise<{ from: string; to: string } | null> {
    // fresh: read now (and refresh the cache), e.g. to notice data an upstream load just added.
    // Scoped: MIN/MAX over the rows the scope may see only; the scope fingerprint is part of the key.
    // After 5 minutes the entry is refreshed in the background while the previous value (at most 30 minutes old)
    // is still answered, so the catalog does not wait on dozens of MIN/MAX queries every 5 minutes.
    const key = `cov|${d.id}|${d.updatedAt}|${scope.fingerprint}`
    return this.cachedStale(key, opts.fresh ? 0 : 5 * 60_000, opts.fresh ? 0 : 30 * 60_000, signal, async (signal) => {
      const c = this.dw.config(d.connectionId)
      const b = scope.kind === 'rows' ? new SqlBuilder(d.semantic, d.schema, await this.tables(d.connectionId, d.schema, d.semantic.sources.map((s) => s.table), signal), dialectOf(c.dbType)) : null
      const parts = await Promise.all(
        d.semantic.sources.map((s) => {
          const p = (b?.dialect ?? dialectOf(c.dbType)).params()
          const sc = b ? b.scopeCondition(scope, s, p) : null
          return this.src
            .run<{ mn: string | Date | null; mx: string | Date | null }>(c, `SELECT min(${quoteIdent(s.dateColumn)}) AS mn, max(${quoteIdent(s.dateColumn)}) AS mx FROM ${quoteIdent(d.schema)}.${quoteIdent(s.table)}${sc ? ` WHERE ${sc}` : ''}`, p.values, {
              kind: 'dataset.coverage',
              timeoutMs: this.config.limits.metadataTimeoutMs,
              signal,
              datasetId: d.id,
            })
            .then((r) => ({ role: s.role, ...r.rows[0] }))
        }),
      )
      // Coverage follows the actual data when there is any; budget usually extends to year end.
      const main = parts.filter((x) => x.role === 'actual' && x.mn && x.mx)
      const use = main.length ? main : parts.filter((x) => x.mn && x.mx)
      if (!use.length) return null
      // Wall-clock dates (timestamp without time zone) compare correctly as YYYY-MM-DD strings.
      const day = (x: string | Date) => (x instanceof Date ? x.toISOString() : String(x)).slice(0, 10)
      const froms = use.map((x) => day(x.mn!)).sort()
      const tos = use.map((x) => day(x.mx!)).sort()
      return { from: froms[0]!, to: tos.at(-1)! }
    })
  }

  /**
   * The coverage coverage() would answer from its cache (at most 30 minutes old), without any query; undefined when
   * there is none. The catalog lists datasets with this only, so opening Analisis/Laporan never waits on the source.
   */
  peekCoverage(d: DatasetRecord, scope: RowScope): { from: string; to: string } | null | undefined {
    const hit = this.cache.get(`cov|${d.id}|${d.updatedAt}|${scope.fingerprint}`)
    return hit && Date.now() - hit.at < 30 * 60_000 ? (hit.value as { from: string; to: string } | null) : undefined
  }

  /** Drops cached coverage, e.g. after the datasets of a connection were deleted. */
  invalidate() {
    this.cache.clear()
  }

  async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < ttl) return hit.value as T
    const value = await load()
    this.cache.set(key, { at: Date.now(), value })
    return value
  }

  private readonly refreshing = new Map<string, Promise<unknown>>()

  /**
   * Like cached(), with stale-while-revalidate: an entry older than `ttl` but younger than `maxStale` is answered
   * at once while ONE background reload (without the request's abort signal, so it outlives the request) replaces
   * it; a failed reload keeps the old entry until `maxStale`. A missing or too old entry is loaded for the caller.
   */
  async cachedStale<T>(key: string, ttl: number, maxStale: number, signal: AbortSignal | undefined, load: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    const age = hit ? Date.now() - hit.at : Infinity
    if (hit && age < ttl) return hit.value as T
    if (hit && age < maxStale) {
      if (!this.refreshing.has(key)) {
        const p = load()
          .then((value) => void this.cache.set(key, { at: Date.now(), value }))
          .catch(() => undefined)
          .finally(() => this.refreshing.delete(key))
        this.refreshing.set(key, p)
      }
      return hit.value as T
    }
    const value = await load(signal)
    this.cache.set(key, { at: Date.now(), value })
    return value
  }

  /** Test hook: settles the background reloads started by cachedStale. */
  async settled() {
    await Promise.all([...this.refreshing.values()])
  }
}
