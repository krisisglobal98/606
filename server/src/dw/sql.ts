/** SQL helpers. Identifiers are always validated against discovered metadata AND quoted. */
import type { SourceDbType } from '../config/config.ts'

export function quoteIdent(name: string): string {
  if (!name || name.includes('\u0000')) throw new Error('invalid identifier')
  return `"${name.replace(/"/g, '""')}"`
}

/** Logical parameter types; each dialect renders them as a cast or a typed placeholder. */
export type ParamType = 'text' | 'number' | 'date' | 'timestamp' | 'boolean' | 'text[]'

/**
 * Collects parameter values and returns placeholders; values never enter SQL text.
 * PostgreSQL: `$n` (with a `::type` cast when a type is given). ClickHouse: `{pn:Type}` (always typed).
 */
export class Params {
  readonly values: unknown[] = []
  private readonly style: SourceDbType

  constructor(style: SourceDbType = 'postgresql') {
    this.style = style
  }

  add(v: unknown, type?: ParamType): string {
    this.values.push(v)
    const n = this.values.length
    if (this.style === 'postgresql') return type && type !== 'number' && type !== 'boolean' ? `$${n}::${type}` : `$${n}`
    const t = type ?? (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : Array.isArray(v) ? 'text[]' : 'text')
    // Free-form timestamps (YYYY-MM-DD, ISO with T/Z) are parsed server-side rather than by the strict DateTime param parser.
    if (t === 'timestamp') return `parseDateTime64BestEffort({p${n}:String})`
    return `{p${n}:${CH_PARAM[t]}}`
  }
}

const CH_PARAM: Record<Exclude<ParamType, 'timestamp'>, string> = { text: 'String', number: 'Float64', date: 'Date', boolean: 'Bool', 'text[]': 'Array(String)' }

/** The few constructs where PostgreSQL and ClickHouse SQL differ for the statements DOD generates. */
export interface SqlDialect {
  readonly kind: SourceDbType
  params(): Params
  toText(expr: string): string
  toFloat(expr: string): string
  /** First day of the month as 'YYYY-MM-01' text. */
  monthStart(expr: string): string
  /**
   * Optional compact form of the month for grouping inside a statement (a DATE instead of text), with
   * `monthKeyText` turning it into the `monthStart` text where a result is output. Same values, smaller sort/hash
   * keys. Dialects without it group by `monthStart` text directly.
   */
  monthKey?(expr: string): string
  monthKeyText?(key: string): string
  year(expr: string): string
  /** Two-digit month 'MM'. */
  month(expr: string): string
  /** Calendar day as 'YYYY-MM-DD' text. */
  day(expr: string): string
  /** expr is one of the values of an array parameter. */
  inList(expr: string, arrayParam: string): string
  /** Aggregate, optionally restricted to rows matching `cond` (NULL when no row matched, except COUNT). */
  agg(fn: 'SUM' | 'MAX' | 'COUNT', expr: string | null, cond?: string | null): string
  /** Value of `expr` on the row with the largest `order` (among rows matching `cond`); NULL when none matched. */
  lastBy(expr: string, order: string, cond?: string | null): string
  /** A one-character string that never occurs in dimension values (NULL-safe join key). */
  readonly sentinel: string
}

const postgres: SqlDialect = {
  kind: 'postgresql',
  params: () => new Params('postgresql'),
  toText: (e) => `${e}::text`,
  toFloat: (e) => `${e}::float8`,
  monthStart: (e) => `to_char(date_trunc('month', ${e}), 'YYYY-MM-01')`,
  monthKey: (e) => `date_trunc('month', ${e})::date`,
  monthKeyText: (k) => `to_char(${k}, 'YYYY-MM-01')`,
  year: (e) => `to_char(${e}, 'YYYY')`,
  month: (e) => `to_char(${e}, 'MM')`,
  day: (e) => `to_char(${e}, 'YYYY-MM-DD')`,
  inList: (e, p) => `${e} = ANY(${p})`,
  agg: (fn, e, cond) => `${fn}(${e ?? '*'})${cond ? ` FILTER (WHERE ${cond})` : ''}`,
  lastBy: (e, o, cond) => `(array_agg(${e} ORDER BY ${o} DESC)${cond ? ` FILTER (WHERE ${cond})` : ''})[1]`,
  sentinel: 'chr(1)',
}

const clickhouse: SqlDialect = {
  kind: 'clickhouse',
  params: () => new Params('clickhouse'),
  toText: (e) => `toString(${e})`,
  toFloat: (e) => `toFloat64(${e})`,
  monthStart: (e) => `formatDateTime(toStartOfMonth(${e}), '%Y-%m-01')`,
  year: (e) => `formatDateTime(${e}, '%Y')`,
  month: (e) => `formatDateTime(${e}, '%m')`,
  day: (e) => `formatDateTime(${e}, '%Y-%m-%d')`,
  inList: (e, p) => `has(${p}, ${e})`,
  // -IfOrNull keeps PostgreSQL's "NULL when nothing matched" semantics of SUM/MAX ... FILTER.
  agg: (fn, e, cond) => (cond ? (fn === 'COUNT' ? `countIf(${cond})` : `${fn.toLowerCase()}IfOrNull(${e}, ${cond})`) : `${fn}(${e ?? '*'})`),
  lastBy: (e, o, cond) => (cond ? `argMaxIfOrNull(${e}, ${o}, ${cond})` : `argMaxOrNull(${e}, ${o})`),
  sentinel: 'char(1)',
}

export function dialectOf(kind: SourceDbType): SqlDialect {
  return kind === 'clickhouse' ? clickhouse : postgres
}
