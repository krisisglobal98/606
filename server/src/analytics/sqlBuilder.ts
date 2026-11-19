/**
 * Builds aggregate SQL from a structured request and a dataset's semantic model, in the dialect of the
 * dataset's source (PostgreSQL or ClickHouse; see SqlDialect for the constructs that differ).
 *
 * Users never send SQL. Column names come from the validated semantic model and are quoted; every
 * user value (dates, filter values) is a bind parameter.
 *
 * Shape of the generated statement, per source (e.g. aktual, budget):
 *
 *   src_r  : rows in the date windows + filters, projected to normalised dimension expressions (text)
 *   src_e  : (only with snapshot measures) one row per entity, MAX(stock) / SUM(flow)
 *   src_a  : GROUPING SETS rollup (subtotals per hierarchy level)
 *
 * then the per-source aggregates are FULL JOINed on (grouping level, dimension values), so actual and
 * budget line up even though their columns are named and typed differently.
 */
import type { TableMetadata } from '../dw/metadata.ts'
import { quoteIdent, type SqlDialect } from '../dw/sql.ts'
import { AppError } from '../http/errors.ts'
import { isTimeDim, type SemanticMeasure, type SemanticModel, type SemanticSource } from '../datasets/semantic.ts'
import { rowPredicate, type RowScope } from '../dataAccess/guard.ts'

export interface DateWindow {
  id: string
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string
  /** Inclusive ISO date (YYYY-MM-DD). */
  to: string
}

export interface AggregateRequest {
  dims: string[]
  /** Each set lists indices into `dims`; [] is the grand total. */
  groupingSets: number[][]
  /** Base measure ids (sum / snapshot). */
  measures: string[]
  windows: DateWindow[]
  /** User filters: they only narrow (AND), the data access scope below decides what may be seen. */
  filters: { dim: string; values?: string[]; like?: string }[]
  /**
   * Data access scope (dataAccess/guard.ts), REQUIRED: applied to the rows of every source where they are read
   * (src_r), before snapshot, grouping sets, period windows and the FULL JOIN of the sources.
   */
  scope: RowScope
  limit: number
}

export interface BuiltQuery {
  sql: string
  params: unknown[]
  /** Column holding a base measure for a window. */
  col: (measureId: string, windowId: string) => string
  /** Column holding the source row count for a window. */
  countCol: (alias: string, windowId: string) => string
  sources: SemanticSource[]
}

export const dimCol = (i: number) => `d${i}`
const mcol = (id: string, w: string) => `m_${id}__${w}`
const ncol = (alias: string, w: string) => `n_${alias}__${w}`

export class SqlBuilder {
  private readonly model: SemanticModel
  private readonly schema: string
  private readonly tables: Map<string, TableMetadata>
  readonly dialect: SqlDialect

  constructor(model: SemanticModel, schema: string, tables: TableMetadata[], dialect: SqlDialect) {
    this.model = model
    this.schema = schema
    this.tables = new Map(tables.map((t) => [t.name, t]))
    this.dialect = dialect
  }

  measure(id: string): SemanticMeasure {
    const m = this.model.measures.find((x) => x.id === id)
    if (!m) throw new AppError(400, 'UNKNOWN_MEASURE', `Measure "${id}" tidak ada di dataset ini.`)
    return m
  }

  /** Expands ratio measures into the base measures they need. */
  baseMeasures(ids: string[]): string[] {
    const out = new Set<string>()
    for (const id of ids) {
      const m = this.measure(id)
      if (m.type === 'ratio') out.add(m.numerator).add(m.denominator)
      else out.add(m.id)
    }
    return [...out]
  }

  private source(alias: string): SemanticSource {
    const s = this.model.sources.find((x) => x.alias === alias)
    if (!s) throw new AppError(500, 'MODEL_INVALID', 'Model dataset tidak valid.')
    return s
  }

  private column(s: SemanticSource, name: string) {
    const c = this.tables.get(s.table)?.columns.find((x) => x.name === name)
    if (!c) throw new AppError(409, 'MODEL_OUT_OF_DATE', `Kolom ${s.table}.${name} tidak lagi ada di sumber. Perbarui pemetaan dataset.`)
    return c
  }

  /** Normalised text expression of a dimension in one source, or null when it is not mapped there. */
  dimExpr(s: SemanticSource, dim: string): string | null {
    const D = this.dialect
    const dc = quoteIdent(this.column(s, s.dateColumn).name)
    if (dim === 'tanggal') return D.monthStart(dc)
    if (dim === 'tahun') return D.year(dc)
    if (dim === 'bulan') return D.month(dc)
    if (dim === 'hari') return D.day(dc)
    const d = this.model.dimensions.find((x) => x.id === dim)
    if (!d) throw new AppError(400, 'UNKNOWN_DIMENSION', `Dimensi "${dim}" tidak ada di dataset ini.`)
    const name = d.columns[s.alias]
    if (!name) return null
    const c = this.column(s, name)
    // Text stays as-is (index-friendly); other types are cast so e.g. int8 2010 and text '2010' match.
    return c.typeCategory === 'string' ? quoteIdent(c.name) : D.toText(quoteIdent(c.name))
  }

  /** Raw (index-friendly) filter expression: the column itself when it is text. */
  private filterExpr(s: SemanticSource, dim: string): string | null {
    return this.dimExpr(s, dim)
  }

  dimLabel(dim: string) {
    return isTimeDim(dim) ? dim : (this.model.dimensions.find((d) => d.id === dim)?.label ?? dim)
  }

  /** Row condition of the data access scope for one source (null only for unrestricted access). */
  scopeCondition(scope: RowScope, s: SemanticSource, p: ReturnType<SqlDialect['params']>): string | null {
    if (!scope || (scope.kind !== 'all' && scope.kind !== 'rows')) throw new AppError(500, 'SCOPE_MISSING', 'Cakupan akses data tidak ditentukan.')
    return rowPredicate(scope, s, (dim) => this.dimExpr(s, dim), p, this.dialect)
  }

  build(r: AggregateRequest): BuiltQuery {
    const D = this.dialect
    const p = D.params()
    const base = r.measures.map((id) => this.measure(id)).filter((m): m is Exclude<SemanticMeasure, { type: 'ratio' }> => m.type !== 'ratio')
    const aliases = [...new Set(base.map((m) => m.source))]
    if (!aliases.length) aliases.push(this.source(this.model.sources[0]!.alias).alias)
    const sources = aliases.map((a) => this.source(a))
    const multi = r.windows.length > 1
    const winParams = r.windows.map((w) => ({ id: w.id, from: p.add(w.from, 'date'), to: p.add(w.to, 'date') }))
    const filterParams = r.filters.map((f) => (f.like != null ? { dim: f.dim, like: true, ph: p.add(D.containsValue(f.like), 'text') } : { dim: f.dim, like: false, ph: p.add(f.values ?? [], 'text[]') }))
    const n = r.dims.length

    const ctes: string[] = []
    for (const s of sources) {
      const t = `${quoteIdent(this.schema)}.${quoteIdent(s.table)}`
      const dc = quoteIdent(this.column(s, s.dateColumn).name)
      // Inside the statement the month is grouped as a DATE where the dialect allows it (smaller sort/hash keys,
      // notably for snapshot measures); it becomes the usual 'YYYY-MM-01' text where src_a outputs it.
      const asKey = (d: string) => (d === 'tanggal' && D.monthKey && D.monthKeyText ? D.monthKey(dc) : this.dimExpr(s, d))
      const dims = r.dims.map((d) => {
        const e = asKey(d)
        if (e == null) throw new AppError(400, 'DIMENSION_NOT_AVAILABLE', `Dimensi ${this.dimLabel(d)} tidak tersedia di sumber ${s.label}, sehingga measure dari sumber itu tidak dapat dipecah per ${this.dimLabel(d)}.`)
        return e
      })
      const ms = base.filter((m) => m.source === s.alias)
      const snapshot = ms.some((m) => m.type === 'snapshot')
      const entity = snapshot
        ? this.model.entity.map((e) => {
            const x = asKey(e)
            if (x == null) throw new AppError(400, 'ENTITY_NOT_MAPPED', `Kunci entitas ${this.dimLabel(e)} tidak dipetakan di sumber ${s.label}.`)
            return x
          })
        : []
      const where = [`(${winParams.map((w) => `(${dc} >= ${w.from} AND ${dc} < ${w.to} + 1)`).join(' OR ')})`]
      for (const f of filterParams) {
        const e = this.filterExpr(s, f.dim)
        if (e == null) throw new AppError(400, 'DIMENSION_NOT_AVAILABLE', `Filter ${this.dimLabel(f.dim)} tidak dapat diterapkan pada sumber ${s.label} karena kolomnya tidak dipetakan.`)
        where.push(f.like ? D.contains(e, f.ph) : D.inList(e, f.ph))
      }
      // Data access scope of this source's rows (before every aggregation and the FULL JOIN below).
      const sc = this.scopeCondition(r.scope, s, p)
      if (sc) where.push(`(${sc})`)
      const proj = [
        ...dims.map((e, i) => `${e} AS ${dimCol(i)}`),
        ...entity.map((e, i) => `${e} AS e${i}`),
        `${dc} AS dt`,
        ...ms.map((m) => `${D.toFloat(quoteIdent(this.column(s, m.column).name))} AS ${quoteIdent(`c_${m.id}`)}`),
      ]
      ctes.push(`${s.alias}_r AS (SELECT ${proj.join(', ')} FROM ${t} WHERE ${where.join(' AND ')})`)

      const win = (w: (typeof winParams)[number]) => (multi ? `dt >= ${w.from} AND dt < ${w.to} + 1` : null)
      const dimList = r.dims.map((_, i) => dimCol(i))
      // Output list of src_a: the month key back to text (GROUP BY / GROUPING still refer to the input column).
      const dimOut = r.dims.map((d, i) => (d === 'tanggal' && D.monthKey && D.monthKeyText ? `${D.monthKeyText(dimCol(i))} AS ${dimCol(i)}` : dimCol(i)))
      const sets = `GROUPING SETS (${r.groupingSets.map((g) => `(${g.map(dimCol).join(', ')})`).join(', ')})`
      const grouping = n ? `GROUPING(${dimList.join(', ')})` : '0'
      if (snapshot) {
        const eList = entity.map((_, i) => `e${i}`)
        const inner = [
          ...dimList,
          ...eList,
          ...winParams.flatMap((w) => [
            ...ms.map((m) => {
              const c = quoteIdent(`c_${m.id}`)
              const e = m.type !== 'snapshot' ? D.agg('SUM', c, win(w)) : m.pick === 'last' ? D.lastBy(c, 'dt', win(w)) : D.agg('MAX', c, win(w))
              return `${e} AS ${quoteIdent(mcol(m.id, w.id))}`
            }),
            `${D.agg('COUNT', null, win(w))} AS ${quoteIdent(ncol(s.alias, w.id))}`,
          ]),
        ]
        ctes.push(`${s.alias}_e AS (SELECT ${inner.join(', ')} FROM ${s.alias}_r GROUP BY ${[...dimList, ...eList].join(', ')})`)
        const outer = [...dimOut, `${grouping} AS g`, ...winParams.flatMap((w) => [...ms.map((m) => `SUM(${quoteIdent(mcol(m.id, w.id))}) AS ${quoteIdent(mcol(m.id, w.id))}`), `SUM(${quoteIdent(ncol(s.alias, w.id))}) AS ${quoteIdent(ncol(s.alias, w.id))}`])]
        ctes.push(`${s.alias}_a AS (SELECT ${outer.join(', ')} FROM ${s.alias}_e GROUP BY ${sets})`)
      } else {
        const outer = [...dimOut, `${grouping} AS g`, ...winParams.flatMap((w) => [...ms.map((m) => `${D.agg('SUM', quoteIdent(`c_${m.id}`), win(w))} AS ${quoteIdent(mcol(m.id, w.id))}`), `${D.agg('COUNT', null, win(w))} AS ${quoteIdent(ncol(s.alias, w.id))}`])]
        ctes.push(`${s.alias}_a AS (SELECT ${outer.join(', ')} FROM ${s.alias}_r GROUP BY ${sets})`)
      }
    }

    // FULL JOIN the per-source aggregates on grouping level + every dimension value.
    const [first, ...rest] = sources
    const coalesce = (expr: (a: string) => string, upto: number) => (upto === 0 ? expr(first!.alias) : `COALESCE(${sources.slice(0, upto + 1).map((s) => expr(s.alias)).join(', ')})`)
    let from = `${first!.alias}_a ${first!.alias}`
    rest.forEach((s, k) => {
      const prev = k // index of last joined source
      const on = [`${coalesce((a) => `${a}.g`, prev)} = ${s.alias}.g`, ...r.dims.map((_, i) => `COALESCE(${coalesce((a) => `${a}.${dimCol(i)}`, prev)}, ${D.sentinel}) = COALESCE(${s.alias}.${dimCol(i)}, ${D.sentinel})`)]
      from += ` FULL JOIN ${s.alias}_a ${s.alias} ON ${on.join(' AND ')}`
    })
    const last = sources.length - 1
    const select = [
      ...r.dims.map((_, i) => `${coalesce((a) => `${a}.${dimCol(i)}`, last)} AS ${dimCol(i)}`),
      `${coalesce((a) => `${a}.g`, last)} AS g`,
      ...sources.flatMap((s) =>
        r.windows.flatMap((w) => [...base.filter((m) => m.source === s.alias).map((m) => `${s.alias}.${quoteIdent(mcol(m.id, w.id))}`), `${s.alias}.${quoteIdent(ncol(s.alias, w.id))}`]),
      ),
    ]
    const order = ['g DESC', ...r.dims.map((_, i) => `${dimCol(i)} NULLS FIRST`)].join(', ')
    const sql = `WITH ${ctes.join(',\n')}\nSELECT ${select.join(', ')} FROM ${from} ORDER BY ${order} LIMIT ${Math.max(1, Math.floor(r.limit))}`
    return { sql, params: p.values, col: mcol, countCol: ncol, sources }
  }
}

/** Grouping bitmask → number of leading dimensions grouped (hierarchy depth), for prefix grouping sets. */
export function levelOf(g: number, nDims: number): number {
  for (let L = 0; L <= nDims; L++) if (g === 2 ** (nDims - L) - 1) return L
  return -1
}
