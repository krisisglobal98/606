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
import { AnalyticsQuerySchema, fieldFilters, valueLabel } from './analyticsService.ts'
import { ResultCache, scopeKey, stableKey } from './resultCache.ts'
import { dimCol, levelOf, SqlBuilder, type DateWindow } from './sqlBuilder.ts'

export const GRID_MAX_ROWS = 5000
/** Columns of a matrix (a day per column for a month is 31; a year by day would not be readable). */
export const GRID_MAX_COLUMNS = 100

export const GridRequestSchema = z.object({
  query: AnalyticsQuerySchema,
  depth: z.number().int().min(0).max(30),
  path: z.array(z.string().nullable()).max(30).nullable(),
  withTotal: z.boolean(),
  withCounts: z.boolean().optional(),
  /**
   * Report-date windows to return besides the period (cur) and last year (prev), all from the same statement:
   * hi = the report date (H.I), sdhi = first of its month up to it (S.D.H.I), ytd = first of its year up to it,
   * mon = its whole month (the monthly budget of a pro-rata measure).
   */
  windows: z.array(z.enum(['hi', 'sdhi', 'ytd', 'mon'])).max(4).optional(),
  /**
   * Matrix: a dimension whose values become columns (e.g. hari = day 1–31), each row also keeping its total
   * (the column at the right end) and the grand total per column. At most GRID_MAX_COLUMNS values.
   */
  columnDim: z.string().max(64).nullable().optional(),
})
export type GridRequest = z.infer<typeof GridRequestSchema>
export type ReportWindow = 'hi' | 'sdhi' | 'ytd' | 'mon'

type Values = Record<string, number | null>

/** Today as the server's calendar date (the server runs in the users' time zone, WIB). */
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The report date: as given, otherwise the end of the period or today, whichever is earlier. */
export function reportDateOf(filter: { dateTo: string; reportDate?: string | null }, now: string = today()): string {
  return filter.reportDate ?? (filter.dateTo < now ? filter.dateTo : now)
}

/** Date range of a report-date window (inclusive ISO dates). */
export function reportWindow(id: ReportWindow, reportDate: string): DateWindow {
  if (id === 'hi') return { id, from: reportDate, to: reportDate }
  if (id === 'mon') {
    const [y, m] = reportDate.split('-').map(Number)
    return { id, from: `${reportDate.slice(0, 7)}-01`, to: `${reportDate.slice(0, 7)}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}` }
  }
  return { id, from: id === 'sdhi' ? `${reportDate.slice(0, 7)}-01` : `${reportDate.slice(0, 4)}-01-01`, to: reportDate }
}

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
    const colDim = req.columnDim || null
    if (colDim && !known.has(colDim)) throw badRequest('UNKNOWN_DIMENSION', `Dimensi kolom "${colDim}" tidak dikenal di dataset ini.`)
    if (colDim && q.dimensions.includes(colDim)) throw badRequest('COLUMN_DIM_IN_ROWS', 'Dimensi kolom sudah dipakai sebagai baris. Pilih dimensi lain untuk kolom, atau keluarkan dari baris.')
    const L = req.depth
    // Messages name the expected shape: depth is the index of the level to return; path holds one parent value per
    // level above it (values exactly as an earlier response returned them in rows[].path).
    if (q.dimensions.length && L >= q.dimensions.length)
      throw badRequest('INVALID_DEPTH', `Level hierarki tidak valid: depth harus 0 sampai ${q.dimensions.length - 1} (indeks di query.dimensions).`)
    if (req.path && req.path.length !== L)
      throw badRequest('INVALID_PATH', `Path parent tidak sesuai level: untuk depth ${L} isi path dengan ${L} nilai, satu per level di atasnya, persis seperti rows[].path dari respons sebelumnya (${L ? `mis. path [${q.dimensions.slice(0, L).map((x) => `"<nilai ${x}>"`).join(', ')}]` : 'depth 0: path null'}).`)
    if (req.path?.some((v) => v == null)) throw badRequest('NULL_PATH', 'Baris bernilai kosong tidak dapat dibuka lebih dalam.')
    if (q.filter.dateFrom > q.filter.dateTo) throw badRequest('INVALID_PERIOD', 'Tanggal mulai harus sebelum tanggal akhir.')

    const filters: { dim: string; values?: string[]; like?: string }[] = []
    for (const [dim, values] of Object.entries(q.scope)) if (values.length) filters.push({ dim, values })
    filters.push(...fieldFilters(q.filter.fields))
    for (const f of filters) if (!d.semantic.dimensions.some((x) => x.id === f.dim)) throw badRequest('UNKNOWN_DIMENSION', `Filter "${f.dim}" bukan dimensi dataset ini.`)
    // The parent path is just more filters; values come from a previous response of this endpoint.
    req.path?.forEach((v, i) => filters.push({ dim: q.dimensions[i]!, values: [v as string] }))

    const cur: DateWindow = { id: 'cur', from: q.filter.dateFrom, to: q.filter.dateTo }
    const prev: DateWindow = { id: 'prev', from: shiftYear(cur.from, -1), to: shiftYear(cur.to, -1) }
    const extra = [...new Set(req.windows ?? [])]
    const rd = reportDateOf(q.filter)
    const extraWindows = extra.map((w) => reportWindow(w, rd))
    // Without row dimensions only the grand total is returned.
    const dims = q.dimensions.slice(0, L + 1)
    const base = b.baseMeasures(q.measures)
    // Matrix: the column dimension is grouped last; every row set also comes without it (row total), and on request
    // the grand total with and without it (total per column, overall total).
    const rowSets: number[][] = dims.length ? [dims.map((_, i) => i), ...(req.withTotal ? [[]] : [])] : [[]]
    const c = dims.length
    const groupingSets = colDim ? rowSets.flatMap((set) => [[...set, c], set]) : rowSets
    const built = b.build({
      dims: colDim ? [...dims, colDim] : dims,
      groupingSets,
      measures: base,
      windows: [cur, prev, ...extraWindows],
      filters,
      scope,
      // A matrix has a statement row per row × column (plus the row totals).
      limit: colDim ? (GRID_MAX_ROWS + 2) * (GRID_MAX_COLUMNS + 2) : GRID_MAX_ROWS + 2,
    })
    const res = await this.engine.execute({ connectionId: d.connectionId, sql: built.sql, params: built.params, kind: 'analytics.grid', datasetId: d.id, userId, timeoutMs: this.config.limits.analyticsTimeoutMs }, signal)

    const num = (v: unknown) => (v == null ? null : Number(v))
    const agg = (r: Record<string, unknown>) => {
      const c: Values = {}
      const p: Values = {}
      const w = Object.fromEntries(extra.map((x) => [x, {} as Values])) as Partial<Record<ReportWindow, Values>>
      for (const id of base) {
        c[id] = num(r[built.col(id, 'cur')])
        p[id] = num(r[built.col(id, 'prev')])
        for (const x of extra) w[x]![id] = num(r[built.col(id, x)])
        if (req.withCounts) {
          // Source rows behind this measure (its own table), for Count / Average.
          const src = (b.measure(id) as { source?: string }).source
          if (src) {
            c[`#count:${id}`] = num(r[built.countCol(src, 'cur')])
            p[`#count:${id}`] = num(r[built.countCol(src, 'prev')])
          }
        }
      }
      return { cur: c, prev: p, ...w }
    }
    const n = dims.length
    let total: (ReturnType<typeof agg> & { cols?: Record<string, ReturnType<typeof agg>> }) | null = null
    let sourceRows: number | null = null
    const rows: (ReturnType<typeof agg> & { path: (string | null)[]; label: string; hasChildren: boolean; cols?: Record<string, ReturnType<typeof agg>>; sortKey?: number | null })[] = []
    // Matrix cells (row key → column value → values) and the column values met, merged into the rows below.
    const cells = new Map<string, Record<string, ReturnType<typeof agg>>>()
    const colValues = new Map<string, string>()
    const NULL_COL = '\u0000'
    for (const r of res.rows) {
      // With a column dimension GROUPING() has one more (lowest) bit: 0 = grouped by the column value.
      const g = Number(r.g)
      const byCol = colDim ? (g & 1) === 0 : false
      const lvl = levelOf(colDim ? g >> 1 : g, n)
      const path = dims.map((_, i) => (r[dimCol(i)] as string | null) ?? null)
      if (byCol) {
        const cv = (r[dimCol(n)] as string | null) ?? NULL_COL
        colValues.set(cv, cv === NULL_COL ? '(kosong)' : valueLabel(colDim!, cv))
        const key = lvl === 0 ? '' : JSON.stringify(path)
        if (lvl === 0 || (lvl === n && n)) cells.set(key, { ...(cells.get(key) ?? {}), [cv]: agg(r) })
        continue
      }
      if (lvl === 0) {
        total = agg(r)
        sourceRows = built.sources.reduce((a, s) => a + Number(r[built.countCol(s.alias, 'cur')] ?? 0), 0)
        continue
      }
      if (lvl !== n || !n) continue
      const v = path[L] ?? null
      // A NULL value cannot be used as a parent filter, so such rows are leaves.
      const sc = built.sortCol(L)
      const key = sc && r[sc] != null ? Number(r[sc]) : null
      rows.push({ path, label: valueLabel(dims[L]!, v), hasChildren: L < q.dimensions.length - 1 && v != null, ...agg(r), ...(sc ? { sortKey: key } : {}) })
    }
    let columns: { value: string | null; label: string }[] | undefined
    if (colDim) {
      if (colValues.size > GRID_MAX_COLUMNS)
        throw badRequest('TOO_MANY_COLUMNS', `Dimensi kolom menghasilkan ${colValues.size} kolom (paling banyak ${GRID_MAX_COLUMNS}). Persempit periode atau filter, atau pilih dimensi kolom lain.`)
      columns = [...colValues.entries()]
        .sort(([a], [z]) => (a === NULL_COL ? 1 : z === NULL_COL ? -1 : a.localeCompare(z, 'id', { numeric: true })))
        .map(([value, label]) => ({ value: value === NULL_COL ? null : value, label }))
      for (const row of rows) row.cols = cells.get(JSON.stringify(row.path)) ?? {}
      if (total) total.cols = cells.get('') ?? {}
    }
    const cmp = (a: string | null, c: string | null) => (a == null ? 1 : c == null ? -1 : a.localeCompare(c, 'id', { numeric: true }))
    rows.sort((x, y) => {
      // Parents first (Expand All returns the children of every parent), then the level itself: by its sort key when
      // the dimension has one (rows without a key after), then by value.
      for (let i = 0; i < L; i++) {
        const c = cmp(x.path[i] ?? null, y.path[i] ?? null)
        if (c) return c
      }
      if (x.sortKey !== undefined || y.sortKey !== undefined) {
        const a = x.sortKey ?? null
        const z = y.sortKey ?? null
        if (a !== z) return a == null ? 1 : z == null ? -1 : a - z
      }
      return cmp(x.path[L] ?? null, y.path[L] ?? null)
    })
    return { depth: L, rows: rows.slice(0, GRID_MAX_ROWS), total, truncated: rows.length > GRID_MAX_ROWS || (!!colDim && res.rows.length >= (GRID_MAX_ROWS + 2) * (GRID_MAX_COLUMNS + 2)), sourceRows, ...(extra.length ? { reportDate: rd } : {}), ...(columns ? { columns } : {}) }
  }
}
