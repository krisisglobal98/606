/**
 * Lazy hierarchical grid for the Analysis table.
 *
 * Each call returns ONE level of the row hierarchy (optionally under one parent) with base aggregates
 * for the selected period and the same period last year, plus the grand total on request. Expanding a
 * node in the browser asks for that node's children only; the aggregation runs in the source database,
 * so the browser never receives raw rows. Ratios, growth, contribution, variance and calculated
 * measures are derived from these base aggregates by the frontend measure engine.
 */
import { z } from 'zod'
import type { User } from '../auth/authService.ts'
import type { Config } from '../config/config.ts'
import type { DataAccessService } from '../dataAccess/dataAccessService.ts'
import type { DatasetService } from '../datasets/datasetService.ts'
import type { QueryEngine } from '../dw/queryEngine.ts'
import { dialectOf } from '../dw/sql.ts'
import { AppError, badRequest } from '../http/errors.ts'
import { TIME_DIMENSIONS } from '../datasets/semantic.ts'
import type { RowScope } from '../dataAccess/guard.ts'
import { AnalyticsQuerySchema, valueLabel } from './analyticsService.ts'
import { ResultCache, scopeKey, stableKey } from './resultCache.ts'
import { dimCol, levelOf, SqlBuilder, type DateWindow } from './sqlBuilder.ts'

export const GRID_MAX_ROWS = 5000

export const GridRequestSchema = z.object({
  query: AnalyticsQuerySchema,
  depth: z.number().int().min(0).max(30),
  path: z.array(z.string().nullable()).max(30).nullable(),
  withTotal: z.boolean(),
  withCounts: z.boolean().optional(),
})
export type GridRequest = z.infer<typeof GridRequestSchema>

type Values = Record<string, number | null>

function shiftYear(iso: string, years: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y! + years, m!, 0)).getUTCDate()
  return `${y! + years}-${String(m).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`
}

export class GridService {
  private readonly datasets: DatasetService
  private readonly engine: QueryEngine
  private readonly config: Config
  private readonly access: Pick<DataAccessService, 'rowScope'>
  private readonly cache: ResultCache | undefined

  /** `cache`: optional result cache (see resultCache.ts); without it every request runs at the source. */
  constructor(datasets: DatasetService, engine: QueryEngine, config: Config, access: Pick<DataAccessService, 'rowScope'>, cache?: ResultCache) {
    this.datasets = datasets
    this.engine = engine
    this.config = config
    this.access = access
    this.cache = cache
  }

  async grid(req: GridRequest, signal: AbortSignal | undefined, user: User) {
    const d = await this.datasets.get(req.query.datasetId)
    if (d.status === 'archived') throw new AppError(410, 'DATASET_ARCHIVED', 'Dataset ini sudah diarsipkan.')
    // Data access scope first, on every request: a refused dataset never reaches the source or the cache.
    const { rows: scope } = await this.access.rowScope(user, d)
    const run = () => this.compute(req, d, scope, signal, user.id)
    if (!this.cache?.enabled) return run()
    const key = `g|${d.id}|${d.updatedAt}|${scopeKey(scope)}|${stableKey(req)}`
    const { value, hit } = await this.cache.get(key, run)
    return hit ? { ...value, cached: true } : value
  }

  private async compute(req: GridRequest, d: Awaited<ReturnType<DatasetService['get']>>, scope: RowScope, signal: AbortSignal | undefined, userId: string) {
    const q = req.query
    const tables = await this.datasets.tables(d.connectionId, d.schema, d.semantic.sources.map((s) => s.table), signal)
    const b = new SqlBuilder(d.semantic, d.schema, tables, dialectOf(this.datasets.connection(d.connectionId).dbType))

    const known = new Set([...d.semantic.dimensions.map((x) => x.id), ...TIME_DIMENSIONS.map((t) => t.id)])
    if (q.dimensions.some((x) => !known.has(x))) throw badRequest('UNKNOWN_DIMENSION', 'Ada dimensi yang tidak dikenal di dataset ini.')
    const L = req.depth
    if (q.dimensions.length && L >= q.dimensions.length) throw badRequest('INVALID_DEPTH', 'Level hierarki tidak valid.')
    if (req.path && req.path.length !== L) throw badRequest('INVALID_PATH', 'Path parent tidak sesuai level.')
    if (req.path?.some((v) => v == null)) throw badRequest('NULL_PATH', 'Baris bernilai kosong tidak dapat dibuka lebih dalam.')
    if (q.filter.dateFrom > q.filter.dateTo) throw badRequest('INVALID_PERIOD', 'Tanggal mulai harus sebelum tanggal akhir.')

    const filters: { dim: string; values: string[] }[] = []
    for (const [dim, values] of Object.entries(q.scope)) if (values.length) filters.push({ dim, values })
    for (const [dim, v] of Object.entries(q.filter.fields ?? {})) if (v) filters.push({ dim, values: [v] })
    for (const f of filters) if (!d.semantic.dimensions.some((x) => x.id === f.dim)) throw badRequest('UNKNOWN_DIMENSION', `Filter "${f.dim}" bukan dimensi dataset ini.`)
    // The parent path is just more filters; values come from a previous response of this endpoint.
    req.path?.forEach((v, i) => filters.push({ dim: q.dimensions[i]!, values: [v as string] }))

    const cur: DateWindow = { id: 'cur', from: q.filter.dateFrom, to: q.filter.dateTo }
    const prev: DateWindow = { id: 'prev', from: shiftYear(cur.from, -1), to: shiftYear(cur.to, -1) }
    // Without row dimensions only the grand total is returned.
    const dims = q.dimensions.slice(0, L + 1)
    const base = b.baseMeasures(q.measures)
    const built = b.build({
      dims,
      groupingSets: dims.length ? [dims.map((_, i) => i), ...(req.withTotal ? [[]] : [])] : [[]],
      measures: base,
      windows: [cur, prev],
      filters,
      scope,
      limit: GRID_MAX_ROWS + 2,
    })
    const res = await this.engine.execute({ connectionId: d.connectionId, sql: built.sql, params: built.params, kind: 'analytics.grid', datasetId: d.id, userId, timeoutMs: this.config.limits.analyticsTimeoutMs }, signal)

    const num = (v: unknown) => (v == null ? null : Number(v))
    const agg = (r: Record<string, unknown>) => {
      const c: Values = {}
      const p: Values = {}
      for (const id of base) {
        c[id] = num(r[built.col(id, 'cur')])
        p[id] = num(r[built.col(id, 'prev')])
        if (req.withCounts) {
          // Source rows behind this measure (its own table), for Count / Average.
          const src = (b.measure(id) as { source?: string }).source
          if (src) {
            c[`#count:${id}`] = num(r[built.countCol(src, 'cur')])
            p[`#count:${id}`] = num(r[built.countCol(src, 'prev')])
          }
        }
      }
      return { cur: c, prev: p }
    }
    const n = dims.length
    let total: { cur: Values; prev: Values } | null = null
    let sourceRows: number | null = null
    const rows = []
    for (const r of res.rows) {
      const lvl = levelOf(Number(r.g), n)
      if (lvl === 0) {
        total = agg(r)
        sourceRows = built.sources.reduce((a, s) => a + Number(r[built.countCol(s.alias, 'cur')] ?? 0), 0)
        continue
      }
      if (lvl !== n || !n) continue
      const path = dims.map((_, i) => (r[dimCol(i)] as string | null) ?? null)
      const v = path[L] ?? null
      // A NULL value cannot be used as a parent filter, so such rows are leaves.
      rows.push({ path, label: valueLabel(dims[L]!, v), hasChildren: L < q.dimensions.length - 1 && v != null, ...agg(r) })
    }
    const cmp = (a: string | null, c: string | null) => (a == null ? 1 : c == null ? -1 : a.localeCompare(c, 'id', { numeric: true }))
    rows.sort((x, y) => {
      for (let i = 0; i < n; i++) {
        const c = cmp(x.path[i] ?? null, y.path[i] ?? null)
        if (c) return c
      }
      return 0
    })
    return { depth: L, rows: rows.slice(0, GRID_MAX_ROWS), total, truncated: rows.length > GRID_MAX_ROWS, sourceRows }
  }
}
