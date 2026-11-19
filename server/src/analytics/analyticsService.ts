/**
 * Real analytics over a warehouse dataset. Aggregation happens in the source database; this service
 * only shapes small aggregated results into the AnalyticsResult contract the Analysis page renders.
 *
 *   millions of source rows ─▶ source GROUP BY / GROUPING SETS ─▶ ≤ a few thousand rows ─▶ JSON
 *   (PostgreSQL or ClickHouse; the SQL builder speaks the source's dialect)
 */
import { z } from 'zod'
import type { User } from '../auth/authService.ts'
import type { Config } from '../config/config.ts'
import type { DataAccessService } from '../dataAccess/dataAccessService.ts'
import type { DatasetService } from '../datasets/datasetService.ts'
import { isTimeDim, TIME_DIMENSIONS } from '../datasets/semantic.ts'
import type { QueryEngine } from '../dw/queryEngine.ts'
import { dialectOf, quoteIdent } from '../dw/sql.ts'
import { AppError, badRequest } from '../http/errors.ts'
import type { RowScope } from '../dataAccess/guard.ts'
import { ResultCache, scopeKey, stableKey } from './resultCache.ts'
import { dimCol, levelOf, SqlBuilder, type DateWindow } from './sqlBuilder.ts'

type Ctx = Awaited<ReturnType<AnalyticsService['context']>>

// A real calendar date (2026-02-30 is refused here, not by the source database as a 500).
const ISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'tanggal tidak valid')

export const AnalyticsQuerySchema = z.object({
  datasetId: z.string().min(1),
  scope: z.record(z.string(), z.array(z.string().max(200)).max(500)).default({}),
  filter: z.object({
    dateFrom: ISO,
    dateTo: ISO,
    /** Report date (tanggal laporan) of the H.I / S.D.H.I / YTD windows; null or absent = min(dateTo, today). */
    reportDate: ISO.nullable().optional(),
    fields: z.record(z.string(), z.string().max(200).nullable()).optional(),
  }).passthrough(),
  // Bounded by what a dataset defines (validated against the semantic model), not by a fixed count.
  // 31: PostgreSQL GROUPING() takes at most 31 arguments (one per hierarchy level).
  dimensions: z.array(z.string()).max(31),
  measures: z.array(z.string()).min(1).max(256),
  chartBy: z.string(),
})
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>

type Num = number | null
interface Field { id: string; label: string; kind: 'dimension' | 'measure'; dataType: 'date' | 'string' | 'number'; unit?: string; decimals?: number; description?: string }
interface ResultRow { id: string; parentId: string | null; level: number; label: string; hasChildren: boolean; values: Record<string, Num> }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const num = (v: unknown): Num => (v == null ? null : Number(v))
const dateLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m! - 1]} ${y}`
}

/** Display label of a normalised dimension value. */
export function valueLabel(dim: string, v: string | null): string {
  if (v == null || v === '') return '(kosong)'
  if (dim === 'tanggal') return `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`
  if (dim === 'bulan') return MONTHS[Number(v) - 1] ?? v
  if (dim === 'hari') return dateLabel(v)
  return v
}


export class AnalyticsService {
  private readonly datasets: DatasetService
  private readonly engine: QueryEngine
  private readonly config: Config
  private readonly access: Pick<DataAccessService, 'rowScope'>
  private readonly cache: ResultCache | undefined

  /** `cache`: optional result cache (see resultCache.ts); without it every query runs at the source. */
  constructor(datasets: DatasetService, engine: QueryEngine, config: Config, access: Pick<DataAccessService, 'rowScope'>, cache?: ResultCache) {
    this.datasets = datasets
    this.engine = engine
    this.config = config
    this.access = access
    this.cache = cache
  }

  /**
   * The dataset, the user's data access to it, then the source metadata. Access comes before anything touches the
   * source: a refused user gets the refusal (audited), never a source lookup or a source error.
   */
  private async context(datasetId: string, signal: AbortSignal | undefined, user: User, before?: (d: Awaited<ReturnType<DatasetService['get']>>) => void) {
    const d = await this.datasets.get(datasetId)
    if (d.status === 'archived') throw new AppError(410, 'DATASET_ARCHIVED', 'Dataset ini sudah diarsipkan.')
    before?.(d)
    const { rows: scope } = await this.access.rowScope(user, d)
    const tables = await this.datasets.tables(d.connectionId, d.schema, d.semantic.sources.map((s) => s.table), signal)
    return { d, scope, b: new SqlBuilder(d.semantic, d.schema, tables, dialectOf(this.datasets.connection(d.connectionId).dbType)) }
  }

  /** Distinct values of one dimension (for scope and filter pickers), bounded and cached. */
  async values(datasetId: string, field: string, q: string | null, signal: AbortSignal | undefined, user: User) {
    const { d, b, scope } = await this.context(datasetId, signal, user, (d) => {
      if (isTimeDim(field) || !d.semantic.dimensions.some((x) => x.id === field)) throw badRequest('UNKNOWN_DIMENSION', `Dimensi "${field}" tidak ada di dataset ini.`)
    })
    const max = this.config.limits.distinctValuesMax
    // The scope fingerprint is part of the key: values of one scope are never served to another.
    const key = `vals|${d.id}|${d.updatedAt}|${field}|${q ?? ''}|${scope.fingerprint}`
    return this.datasets.cached(key, 5 * 60_000, async () => {
      const parts: string[] = []
      const p = b.dialect.params()
      for (const s of d.semantic.sources) {
        const e = b.dimExpr(s, field)
        if (!e) continue
        let where = `${e} IS NOT NULL`
        if (q) where += ` AND ${e} ILIKE ${p.add(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}`
        const sc = b.scopeCondition(scope, s, p)
        if (sc) where += ` AND (${sc})`
        parts.push(`SELECT DISTINCT ${e} AS v FROM ${quoteIdent(d.schema)}.${quoteIdent(s.table)} WHERE ${where}`)
      }
      if (!parts.length) return { values: [] as string[], truncated: false }
      const r = await this.engine.execute({ connectionId: d.connectionId, sql: `SELECT v FROM (${parts.join(' UNION DISTINCT ')}) u ORDER BY v LIMIT ${max + 1}`, params: p.values, kind: 'dataset.values', datasetId: d.id, userId: user.id, timeoutMs: this.config.limits.metadataTimeoutMs * 2 }, signal)
      const values = r.rows.map((x) => String(x.v))
      return { values: values.slice(0, max), truncated: values.length > max }
    })
  }

  async query(input: AnalyticsQuery, signal: AbortSignal | undefined, user: User) {
    const t0 = performance.now()
    // Data access is checked on every request (in context), before the cache: a refused user never gets a cached result.
    const { d, b, scope } = await this.context(input.datasetId, signal, user)
    const run = () => this.compute(input, d, b, scope, signal, user.id, t0)
    if (!this.cache?.enabled) return run()
    const key = `q|${d.id}|${d.updatedAt}|${scopeKey(scope)}|${stableKey(input)}`
    const { value, hit } = await this.cache.get(key, run)
    return hit ? { ...value, execution: { ...value.execution, durationMs: Math.round(performance.now() - t0), cached: true } } : value
  }

  private async compute(input: AnalyticsQuery, d: Ctx['d'], b: Ctx['b'], scope: RowScope, signal: AbortSignal | undefined, userId: string, t0: number) {
    const m = d.semantic
    const dimIds = new Set([...m.dimensions.map((x) => x.id), ...TIME_DIMENSIONS.map((t) => t.id)])
    const dims = input.dimensions.filter((x) => dimIds.has(x))
    if (dims.length !== input.dimensions.length) throw badRequest('UNKNOWN_DIMENSION', 'Ada dimensi yang tidak dikenal di dataset ini.')
    const measures = input.measures.map((id) => b.measure(id))
    if (input.filter.dateFrom > input.filter.dateTo) throw badRequest('INVALID_PERIOD', 'Tanggal mulai harus sebelum tanggal akhir.')
    const filters: { dim: string; values: string[] }[] = []
    for (const [dim, values] of Object.entries(input.scope)) if (values.length) filters.push({ dim, values })
    for (const [dim, v] of Object.entries(input.filter.fields ?? {})) if (v) filters.push({ dim, values: [v] })
    for (const f of filters) if (!m.dimensions.some((x) => x.id === f.dim)) throw badRequest('UNKNOWN_DIMENSION', `Filter "${f.dim}" bukan dimensi dataset ini.`)

    const cur: DateWindow = { id: 'cur', from: input.filter.dateFrom, to: input.filter.dateTo }
    const exec = (sql: string, params: unknown[], kind: string, timeoutMs?: number) =>
      this.engine.execute({ connectionId: d.connectionId, sql, params, kind, datasetId: d.id, userId, timeoutMs }, signal)

    const n = dims.length
    const base = b.baseMeasures(measures.map((x) => x.id))
    const limit = this.config.limits.resultMaxLimit
    const main = b.build({ dims, groupingSets: Array.from({ length: n + 1 }, (_, L) => Array.from({ length: L }, (_, i) => i)), measures: base, windows: [cur], filters, scope, limit: limit + 1 })

    const chartBy = input.chartBy === 'trend' ? 'tanggal' : input.chartBy
    if (input.chartBy !== 'trend' && !dims.includes(chartBy)) throw badRequest('INVALID_CHART', 'Grafik hanya bisa dipecah per dimensi yang dipilih.')
    const unit = measures[0]?.unit ?? ''
    const plotted = measures.filter((x) => x.unit === unit).slice(0, 4)
    const reuseChart = dims[0] === chartBy
    const chartQ = reuseChart ? null : b.build({ dims: [chartBy], groupingSets: [[0]], measures: b.baseMeasures(plotted.map((x) => x.id)), windows: [cur], filters, scope, limit: 1000 })

    const [mainR, chartR] = await Promise.all([
      exec(main.sql, main.params, 'analytics.main'),
      chartQ ? exec(chartQ.sql, chartQ.params, 'analytics.chart') : Promise.resolve(null),
    ])

    /* ---------- measure evaluation ---------- */
    const evalMeasure = (row: Record<string, unknown>, id: string, w: string, q = main): Num => {
      const me = b.measure(id)
      if (me.type !== 'ratio') return num(row[q.col(id, w)])
      const nu = num(row[q.col(me.numerator, w)])
      const de = num(row[q.col(me.denominator, w)])
      return de ? ((nu ?? 0) / de) * me.scale : null
    }
    const count = (row: Record<string, unknown>, w: string, q = main) => q.sources.reduce((a, s) => a + Number(row[q.countCol(s.alias, w)] ?? 0), 0)

    /* ---------- hierarchical rows ---------- */
    const truncatedSql = mainR.rows.length > limit
    const raw = mainR.rows.slice(0, limit)
    const grand = raw.find((r) => levelOf(Number(r.g), n) === 0) ?? {}
    type Node = { key: string; level: number; dimsVals: (string | null)[]; row: Record<string, unknown>; children: Node[] }
    const root: Node = { key: '', level: 0, dimsVals: [], row: grand, children: [] }
    const index = new Map<string, Node>([['', root]])
    for (const r of raw) {
      const L = levelOf(Number(r.g), n)
      if (L <= 0) continue
      const vals = dims.slice(0, L).map((_, i) => (r[dimCol(i)] as string | null) ?? null)
      const key = vals.map((v) => v ?? '\u0000').join('␟')
      const parent = index.get(vals.slice(0, -1).map((v) => v ?? '\u0000').join('␟'))
      if (!parent) continue
      const node: Node = { key, level: L, dimsVals: vals, row: r, children: [] }
      parent.children.push(node)
      index.set(key, node)
    }
    const cmp = (a: string | null, b2: string | null) => (a == null ? 1 : b2 == null ? -1 : a.localeCompare(b2, 'id', { numeric: true }))
    const rows: ResultRow[] = []
    let truncated = truncatedSql
    const cap = this.config.limits.resultDefaultLimit
    const walk = (node: Node, parentId: string | null) => {
      for (const ch of node.children.sort((x, y) => cmp(x.dimsVals.at(-1) ?? null, y.dimsVals.at(-1) ?? null))) {
        if (rows.length >= cap) {
          truncated = true
          return
        }
        const dim = dims[ch.level - 1]!
        const label = valueLabel(dim, ch.dimsVals.at(-1) ?? null)
        const id = parentId ? `${parentId}␟${label}` : label
        rows.push({ id, parentId, level: ch.level - 1, label, hasChildren: ch.level < n, values: Object.fromEntries(measures.map((x) => [x.id, evalMeasure(ch.row, x.id, 'cur')])) })
        walk(ch, id)
      }
    }
    walk(root, null)
    const sourceRowCount = count(grand, 'cur')

    /* ---------- chart ---------- */
    let chartRows: Record<string, unknown>[] = []
    let chartQuery = main
    if (reuseChart) {
      chartRows = root.children.map((c) => c.row).sort((x, y) => cmp(x[dimCol(0)] as string | null, y[dimCol(0)] as string | null))
    } else if (chartR && chartQ) {
      chartQuery = chartQ
      chartRows = chartR.rows.filter((r) => levelOf(Number(r.g), 1) === 1).sort((x, y) => cmp(x[dimCol(0)] as string | null, y[dimCol(0)] as string | null))
    }
    const categories = chartRows.map((r) => valueLabel(chartBy, (r[dimCol(0)] as string | null) ?? null))
    const chart = {
      categories,
      series: plotted.map((x) => ({ id: x.id, name: x.label, unit: x.unit, values: chartRows.map((r) => evalMeasure(r, x.id, 'cur', chartQuery)) })),
      omitted: measures.filter((x) => !plotted.includes(x)).map((x) => x.label),
    }

    const fields = this.datasets.fields(d)
    const fieldOf = (id: string) => fields.find((f) => f.id === id)!
    const result = {
      datasetId: d.id,
      dimensions: dims.map(fieldOf),
      measures: measures.map((x) => fieldOf(x.id)) as Field[],
      rows,
      grandTotal: Object.fromEntries(measures.map((x) => [x.id, evalMeasure(grand, x.id, 'cur')])),
      truncated,
      chart,
      summary: { periodLabel: `${dateLabel(cur.from)} – ${dateLabel(cur.to)}`, sourceRowCount },
      execution: {
        engine: b.dialect.kind,
        source: d.connectionName,
        durationMs: Math.round(performance.now() - t0),
        queries: [mainR, chartR].filter(Boolean).length,
        sourceRows: sourceRowCount,
        resultRows: rows.length,
      },
    }
    return result
  }
}
