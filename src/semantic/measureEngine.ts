/**
 * Semantic measure engine and registry: ONE definition of every measure and display calculation, used
 * by the result table, the KPI tiles, the Layout menus, conditional formatting and CSV export.
 *
 *   base aggregates per row (period + same period last year + row counts, from the grid endpoint)
 *     ↓
 *   measures     raw (dataset field) · derived (dataset ratios, built-ins) · calculated (user formula)
 *     ↓
 *   display calculations chosen by the user in Layout (registry below): Value, Growth YoY, …
 *
 * Nothing is added automatically: with no configuration a measure shows its Value only. Ratios are
 * computed from aggregated numerators/denominators of the same row, so every level is consistent.
 * Calculations the backend cannot compute yet are listed as unavailable, never approximated.
 */
import type { Dataset, Field, GridAgg, Kpi } from '@/types/contracts'
import { tr } from '@/i18n'

/** cur = the filter period, prev = same period last year; hi / sdhi / ytd = report-date windows (H.I, S.D.H.I, YTD). */
export type Window = 'cur' | 'prev' | 'hi' | 'sdhi' | 'ytd'
export type Category = 'raw' | 'derived' | 'calculated'

export interface CalcMeasure {
  /** "cm:<slug>" */
  id: string
  label: string
  formula: string
  decimals: number
  /** Show as a percentage (value × 100, unit %). */
  percent: boolean
  unit: string
}

export interface MeasureDef {
  id: string
  label: string
  unit: string
  decimals: number
  category: Category
  description?: string
  /** Server measure ids whose base aggregates this measure needs. */
  needs: string[]
  /** Value in a window; `total` is the grand total of the current context (for shares). */
  value: (agg: GridAgg, w: Window, total: GridAgg | null) => number | null
  /** % / pp measures: growth is a percentage-point difference, not a relative change. */
  percentLike: boolean
  /** Base (SUM) measures of the dataset: additive, countable. */
  additive: boolean
  /** Built-ins that are already a comparison (no Growth of a growth). */
  comparison?: boolean
}

/* ---------------- Display calculation registry ---------------- */

export type DisplayCalc =
  | 'value'
  | 'growth_yoy'
  | 'growth_mom'
  | 'growth_qoq'
  | 'growth_wow'
  | 'contribution'
  | 'gap'
  | 'count'
  | 'average'
  | 'running_total'
  | 'minimum'
  | 'maximum'
  | 'distinct_count'
  | 'value_hi'
  | 'value_sdhi'
  | 'value_ytd'

export interface DisplayCalcDef {
  id: DisplayCalc
  /** Name in menus and in the header when shown under a measure. */
  label: string
  description: string
  /** null = available whenever `applies` holds; a string = not available yet, with the reason. */
  unavailable: string | null
  applies: (d: MeasureDef) => boolean
}

const NEEDS_BACKEND = tr('Belum tersedia: query grid belum menyediakan')
/** The single list of display calculations (UI, engine, formatting, export, report read this). */
export const DISPLAY_CALCS: DisplayCalcDef[] = [
  { id: 'value', label: tr('Value'), description: tr('Nilai measure pada konteks baris'), unavailable: null, applies: () => true },
  { id: 'growth_yoy', label: tr('Growth YoY'), description: tr('Perubahan terhadap periode sama tahun lalu (pp untuk measure %)'), unavailable: null, applies: (d) => !d.comparison },
  { id: 'growth_mom', label: tr('Growth MoM'), description: tr('Perubahan terhadap bulan sebelumnya'), unavailable: tr('{0} periode pembanding bulanan.', NEEDS_BACKEND), applies: (d) => !d.comparison },
  { id: 'growth_qoq', label: tr('Growth QoQ'), description: tr('Perubahan terhadap kuartal sebelumnya'), unavailable: tr('{0} periode pembanding kuartalan.', NEEDS_BACKEND), applies: (d) => !d.comparison },
  { id: 'growth_wow', label: tr('Growth WoW'), description: tr('Perubahan terhadap minggu sebelumnya'), unavailable: tr('{0} periode pembanding mingguan.', NEEDS_BACKEND), applies: (d) => !d.comparison },
  { id: 'contribution', label: tr('Contribution %'), description: tr('Porsi baris terhadap total konteks'), unavailable: null, applies: (d) => d.additive },
  { id: 'gap', label: tr('Gap'), description: tr('Selisih terhadap 100% (pp)'), unavailable: null, applies: (d) => d.unit === '%' && !d.comparison },
  { id: 'count', label: tr('Count'), description: tr('Jumlah baris sumber yang diagregasi'), unavailable: null, applies: (d) => d.additive },
  { id: 'average', label: tr('Average'), description: tr('Nilai ÷ jumlah baris sumber'), unavailable: null, applies: (d) => d.additive },
  { id: 'running_total', label: tr('Running Total'), description: tr('Akumulasi berurutan'), unavailable: tr('Belum tersedia: butuh urutan waktu di grid.'), applies: (d) => d.additive },
  { id: 'minimum', label: tr('Minimum'), description: tr('Nilai baris sumber terkecil'), unavailable: tr('{0} agregasi MIN.', NEEDS_BACKEND), applies: (d) => d.additive },
  { id: 'maximum', label: tr('Maximum'), description: tr('Nilai baris sumber terbesar'), unavailable: tr('{0} agregasi MAX.', NEEDS_BACKEND), applies: (d) => d.additive },
  // Report-date windows: one measure as several columns (H.I next to S.D.H.I) without another dataset. Ratios and
  // calculated measures are computed from the numerator/denominator of the same window.
  { id: 'value_hi', label: tr('H.I'), description: tr('Nilai pada tanggal laporan (hari ini)'), unavailable: null, applies: (d) => !d.comparison },
  { id: 'value_sdhi', label: tr('S.D.H.I'), description: tr('Akumulasi tanggal 1 bulan tanggal laporan s.d. tanggal laporan'), unavailable: null, applies: (d) => !d.comparison },
  { id: 'value_ytd', label: tr('S.D. Tahun Ini'), description: tr('Akumulasi 1 Januari s.d. tanggal laporan'), unavailable: null, applies: (d) => !d.comparison },
  { id: 'distinct_count', label: tr('Distinct Count'), description: tr('Jumlah nilai unik'), unavailable: tr('{0} agregasi COUNT DISTINCT.', NEEDS_BACKEND), applies: (d) => d.additive },
]
/** Display calculations read from a report-date window, and that window (the grid asks only for these). */
export const WINDOW_CALCS: Partial<Record<DisplayCalc, 'hi' | 'sdhi' | 'ytd'>> = { value_hi: 'hi', value_sdhi: 'sdhi', value_ytd: 'ytd' }
/** Report-date windows needed by the chosen display calculations of all measures. */
export function windowsOf(settings: Record<string, MeasureSetting | undefined>): ('hi' | 'sdhi' | 'ytd')[] {
  const w = new Set<'hi' | 'sdhi' | 'ytd'>()
  for (const st of Object.values(settings)) for (const c of st?.display ?? []) if (WINDOW_CALCS[c]) w.add(WINDOW_CALCS[c]!)
  return (['hi', 'sdhi', 'ytd'] as const).filter((x) => w.has(x))
}
export const DISPLAY_CALC = new Map(DISPLAY_CALCS.map((c) => [c.id, c]))

/** Per-measure presentation chosen in Layout. Absent = raw presentation (Value only, metadata unit). */
export interface MeasureSetting {
  display?: DisplayCalc[]
  alias?: string
  decimals?: number
  unit?: string
}

export interface ColumnMeta {
  /** Label of the measure (alias or field label). */
  measureLabel: string
  /** Label of the display calculation ("Value", "Growth YoY", …). */
  calcLabel: string
  unit: string
  decimals: number
  signed: boolean
}

const pct = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100)
const div = (a: number | null, b: number | null, scale = 1) => (b ? ((a ?? 0) / b) * scale : null)
const get = (agg: GridAgg | null, w: Window, id: string) => (agg ? (agg[w]?.[id] ?? null) : null)
/** Row count of a base measure's source, returned by the grid endpoint under this key. */
export const countKey = (id: string) => `#count:${id}`

export const DERIVED_PREFIX = 'dx:'
/** Names of the built-in derived measures (the engine adds the actual measure's name where relevant). */
export const BUILTIN_DERIVED: Record<string, string> = { growth: 'Growth YoY', contribution: 'Contribution %', variance: 'Variance', variance_pct: 'Variance %', ach_gap: tr('Achievement Gap') }
export const CALC_PREFIX = 'cm:'
export const isServerMeasure = (id: string) => !id.startsWith(DERIVED_PREFIX) && !id.startsWith(CALC_PREFIX)

/* ---------------- Formula parser (no eval) ---------------- */

type Node = { t: 'num'; v: number } | { t: 'ref'; id: string } | { t: 'neg'; e: Node } | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: Node; r: Node }

export type ParseResult = { ok: true; node: Node; refs: string[] } | { ok: false; error: string }

/**
 * Parses e.g. "Produksi / Luas Area" or "([Cost] / [Produksi]) * 1000". Names are measure labels or ids
 * (longest match, case-insensitive); [brackets] are optional.
 */
export function parseFormula(src: string, names: { id: string; label: string }[]): ParseResult {
  type Tok = { k: 'num'; v: number } | { k: 'ref'; id: string } | { k: 'op'; v: string }
  const toks: Tok[] = []
  const cands = names.flatMap((n) => [{ id: n.id, s: n.label.toLowerCase() }, { id: n.id, s: n.id.toLowerCase() }]).sort((a, b) => b.s.length - a.s.length)
  let i = 0
  const text = src.trim()
  if (!text) return { ok: false, error: tr('Formula masih kosong.') }
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if ('+-*/()'.includes(ch)) {
      toks.push({ k: 'op', v: ch })
      i++
      continue
    }
    const num = /^\d+(?:[.,]\d+)?/.exec(text.slice(i))
    if (num) {
      toks.push({ k: 'num', v: Number(num[0].replace(',', '.')) })
      i += num[0].length
      continue
    }
    if (ch === '[') {
      const end = text.indexOf(']', i)
      if (end < 0) return { ok: false, error: tr('Tanda ] tidak ditutup.') }
      const name = text.slice(i + 1, end).trim().toLowerCase()
      const hit = cands.find((c) => c.s === name)
      if (!hit) return { ok: false, error: tr('Measure "{0}" tidak dikenal.', text.slice(i + 1, end).trim()) }
      toks.push({ k: 'ref', id: hit.id })
      i = end + 1
      continue
    }
    const rest = text.slice(i).toLowerCase()
    const hit = cands.find((c) => rest.startsWith(c.s) && !/[\p{L}\p{N}_]/u.test(rest.charAt(c.s.length)))
    if (!hit) return { ok: false, error: tr('Tidak dikenal mulai dari "{0}". Gunakan nama measure, angka, + − × ÷ dan kurung.', text.slice(i, i + 24)) }
    toks.push({ k: 'ref', id: hit.id })
    i += hit.s.length
  }
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => peek()?.k === 'op' && (peek() as { v: string }).v === v
  const expr = (): Node => {
    let l = term()
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: '+' | '-' }).v
      l = { t: 'bin', op, l, r: term() }
    }
    return l
  }
  const term = (): Node => {
    let l = factor()
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: '*' | '/' }).v
      l = { t: 'bin', op, l, r: factor() }
    }
    return l
  }
  const factor = (): Node => {
    const tk = toks[p++]
    if (!tk) throw new Error(tr('Formula berakhir terlalu cepat.'))
    if (tk.k === 'num') return { t: 'num', v: tk.v }
    if (tk.k === 'ref') return { t: 'ref', id: tk.id }
    if (tk.v === '-') return { t: 'neg', e: factor() }
    if (tk.v === '(') {
      const e = expr()
      if (!isOp(')')) throw new Error(tr('Kurung ) tidak ditutup.'))
      p++
      return e
    }
    throw new Error(tr('Operator "{0}" tidak pada tempatnya.', tk.v))
  }
  try {
    const node = expr()
    if (p < toks.length) return { ok: false, error: tr('Ada sisa formula yang tidak dapat dibaca.') }
    const refs = new Set<string>()
    const walk = (n: Node) => {
      if (n.t === 'ref') refs.add(n.id)
      else if (n.t === 'neg') walk(n.e)
      else if (n.t === 'bin') {
        walk(n.l)
        walk(n.r)
      }
    }
    walk(node)
    if (!refs.size) return { ok: false, error: tr('Formula harus memakai minimal satu measure.') }
    return { ok: true, node, refs: [...refs] }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function evalNode(n: Node, v: (id: string) => number | null): number | null {
  if (n.t === 'num') return n.v
  if (n.t === 'ref') return v(n.id)
  if (n.t === 'neg') {
    const x = evalNode(n.e, v)
    return x == null ? null : -x
  }
  const a = evalNode(n.l, v)
  const b = evalNode(n.r, v)
  if (a == null || b == null) return null
  if (n.op === '+') return a + b
  if (n.op === '-') return a - b
  if (n.op === '*') return a * b
  return b === 0 ? null : a / b
}

/* ---------------- Engine ---------------- */

export interface Engine {
  defs: Map<string, MeasureDef>
  list: MeasureDef[]
  /** Fields to show in the Field List for the derived and calculated categories. */
  extraFields: Field[]
  category: (id: string) => Category
  /** Server measure ids needed for a set of (any) measure ids. */
  serverMeasures: (ids: string[]) => string[]
  /** Display calculations that apply to a measure, each with its availability. */
  calcsFor: (id: string) => DisplayCalcDef[]
  /** Chosen display calculations, keeping only available ones; [] → ['value']. */
  displays: (id: string, setting: MeasureSetting | undefined) => DisplayCalc[]
  columnMeta: (id: string, calc: DisplayCalc, setting: MeasureSetting | undefined) => ColumnMeta
  cell: (id: string, calc: DisplayCalc, agg: GridAgg, total: GridAgg | null) => number | null
  kpis: (total: GridAgg | null, empty: boolean) => Kpi[]
}

export function createEngine(dataset: Dataset, calcMeasures: CalcMeasure[]): Engine {
  const defs = new Map<string, MeasureDef>()
  for (const f of dataset.fields.filter((x) => x.kind === 'measure')) {
    const c = f.calc ?? { kind: 'base' as const }
    const unit = f.unit ?? ''
    defs.set(f.id, {
      id: f.id,
      label: f.label,
      unit,
      decimals: f.decimals ?? 1,
      category: c.kind === 'ratio' ? 'derived' : 'raw',
      description: f.description,
      needs: [f.id],
      value: c.kind === 'ratio' ? (agg, w) => div(get(agg, w, c.num), get(agg, w, c.den), c.scale) : (agg, w) => get(agg, w, f.id),
      percentLike: unit === '%',
      additive: c.kind === 'base',
    })
  }

  // Built-in semantic measures on the dataset's KPI pair (from dataset metadata): no formula needed.
  // They exist in the Field List; they appear in the table only when the user adds them.
  const a = dataset.kpi.actual ? defs.get(dataset.kpi.actual) : undefined
  const tg = dataset.kpi.target ? defs.get(dataset.kpi.target) : undefined
  if (a) {
    const builtin = (id: string, label: string, unit: string, decimals: number, description: string, value: MeasureDef['value'], extra: Partial<MeasureDef> = {}) =>
      defs.set(DERIVED_PREFIX + id, { id: DERIVED_PREFIX + id, label, unit, decimals, category: 'derived', description, needs: [a.id, ...(tg ? [tg.id] : [])], value, percentLike: unit === '%' || unit === 'pp', additive: false, comparison: true, ...extra })
    builtin('growth', `${BUILTIN_DERIVED.growth} ${a.label}`, '%', 1, tr('({0} periode ini − periode sama tahun lalu) ÷ tahun lalu', a.label), (g, w) => (w === 'cur' ? pct(a.value(g, 'cur', null), a.value(g, 'prev', null)) : null), { needs: [a.id] })
    builtin('contribution', `${BUILTIN_DERIVED.contribution} ${a.label}`, '%', 1, tr('{0} baris ini ÷ {1} total', a.label, a.label), (g, w, total) => div(a.value(g, w, null), a.value(total ?? g, w, null), 100), { needs: [a.id] })
    if (tg) {
      builtin('variance', BUILTIN_DERIVED.variance!, a.unit, a.decimals, `${a.label} − ${tg.label}`, (g, w) => {
        const x = a.value(g, w, null)
        const y = tg.value(g, w, null)
        return x == null || y == null ? null : x - y
      }, { comparison: false, percentLike: false })
      builtin('variance_pct', BUILTIN_DERIVED.variance_pct!, '%', 1, `(${a.label} − ${tg.label}) ÷ ${tg.label}`, (g, w) => pct(a.value(g, w, null), tg.value(g, w, null)))
      builtin('ach_gap', BUILTIN_DERIVED.ach_gap!, 'pp', 1, tr('Achievement − 100%'), (g, w) => {
        const r = div(a.value(g, w, null), tg.value(g, w, null), 100)
        return r == null ? null : r - 100
      })
    }
  }

  // User-defined calculated measures (formulas over raw and derived dataset measures).
  const names = [...defs.values()].filter((d) => !d.id.startsWith(DERIVED_PREFIX)).map((d) => ({ id: d.id, label: d.label }))
  for (const cm of calcMeasures) {
    const parsed = parseFormula(cm.formula, names)
    if (!parsed.ok) continue
    const refs = parsed.refs.map((r) => defs.get(r)!).filter(Boolean)
    defs.set(cm.id, {
      id: cm.id,
      label: cm.label,
      unit: cm.percent ? '%' : cm.unit,
      decimals: cm.decimals,
      category: 'calculated',
      description: `= ${cm.formula}`,
      needs: [...new Set(refs.flatMap((r) => r.needs))],
      value: (g, w, total) => {
        const v = evalNode(parsed.node, (id) => defs.get(id)?.value(g, w, total) ?? null)
        return v == null ? null : cm.percent ? v * 100 : v
      },
      percentLike: cm.percent,
      additive: false,
    })
  }

  const list = [...defs.values()]
  const calcsFor = (id: string) => {
    const d = defs.get(id)
    return d ? DISPLAY_CALCS.filter((c) => c.applies(d)) : [DISPLAY_CALC.get('value')!]
  }
  const usable = (id: string, c: DisplayCalc) => calcsFor(id).some((x) => x.id === c && !x.unavailable)
  return {
    defs,
    list,
    extraFields: list
      .filter((d) => !isServerMeasure(d.id))
      .map((d) => ({ id: d.id, label: d.label, kind: 'measure' as const, dataType: 'number' as const, unit: d.unit, decimals: d.decimals, description: d.description })),
    category: (id) => defs.get(id)?.category ?? 'raw',
    serverMeasures: (ids) => [...new Set(ids.flatMap((id) => defs.get(id)?.needs ?? []))],
    calcsFor,
    displays: (id, setting) => {
      const chosen = (setting?.display ?? []).filter((c, i, arr) => arr.indexOf(c) === i && usable(id, c))
      return chosen.length ? chosen : ['value']
    },
    columnMeta: (id, calc, setting) => {
      const d = defs.get(id)
      const measureLabel = setting?.alias?.trim() || d?.label || id
      const calcLabel = DISPLAY_CALC.get(calc)?.label ?? calc
      const unit = setting?.unit ?? d?.unit ?? ''
      const decimals = setting?.decimals ?? d?.decimals ?? 1
      if (calc === 'growth_yoy') return d?.percentLike ? { measureLabel, calcLabel, unit: 'pp', decimals: 1, signed: true } : { measureLabel, calcLabel, unit: '%', decimals: 1, signed: true }
      if (calc === 'contribution') return { measureLabel, calcLabel, unit: '%', decimals: 1, signed: false }
      if (calc === 'gap') return { measureLabel, calcLabel, unit: 'pp', decimals: 1, signed: true }
      if (calc === 'count') return { measureLabel, calcLabel, unit: 'baris', decimals: 0, signed: false }
      if (calc === 'average') return { measureLabel, calcLabel, unit: unit ? tr('{0}/baris', unit) : '', decimals: Math.max(decimals, 2), signed: false }
      // Built-in comparisons (growth, variance %, gap) read with a sign; shares do not.
      return { measureLabel, calcLabel, unit, decimals, signed: !!d?.comparison && d.id !== `${DERIVED_PREFIX}contribution` }
    },
    cell: (id, calc, agg, total) => {
      const d = defs.get(id)
      if (!d || !usable(id, calc)) return null
      const c = d.value(agg, 'cur', total)
      if (calc === 'value') return c
      const win = WINDOW_CALCS[calc]
      if (win) return d.value(agg, win, total)
      if (calc === 'gap') return c == null ? null : c - 100
      if (calc === 'contribution') return div(c, total ? d.value(total, 'cur', total) : null, 100)
      if (calc === 'count') return get(agg, 'cur', countKey(d.id))
      if (calc === 'average') return div(c, get(agg, 'cur', countKey(d.id)))
      // growth_yoy
      const p = d.value(agg, 'prev', total)
      return d.percentLike ? (c == null || p == null ? null : c - p) : pct(c, p)
    },
    kpis: (total, empty) => {
      if (!a) return []
      const val = (d: MeasureDef | undefined, w: Window) => (d && total ? d.value(total, w, total) : null)
      const achDef = dataset.kpi.achievement ? defs.get(dataset.kpi.achievement) : undefined
      const ach = (w: Window) => (achDef ? val(achDef, w) : tg ? div(val(a, w), val(tg, w), 100) : null)
      const hasPrev = !!val(a, 'prev')
      const growth = hasPrev ? pct(val(a, 'cur'), val(a, 'prev')) : null
      const out: Kpi[] = [{ id: 'actual', label: a.label, value: empty ? null : val(a, 'cur'), unit: a.unit, decimals: a.decimals, delta: growth, deltaUnit: '%', deltaLabel: tr('vs tahun lalu') }]
      if (tg) {
        out.push({ id: 'target', label: tg.label, value: empty ? null : val(tg, 'cur'), unit: tg.unit, decimals: tg.decimals, delta: hasPrev ? pct(val(tg, 'cur'), val(tg, 'prev')) : null, deltaUnit: '%', deltaLabel: tr('vs tahun lalu') })
        const ac = ach('cur')
        const ap = ach('prev')
        out.push({ id: 'achievement', label: achDef?.label ?? tr('Achievement'), value: empty ? null : ac, unit: '%', decimals: 1, delta: hasPrev && ac != null && ap != null ? ac - ap : null, deltaUnit: 'pp', deltaLabel: tr('vs tahun lalu') })
      }
      out.push({ id: 'growth', label: tr('Growth'), value: empty ? null : growth, unit: '%', decimals: 1, deltaLabel: hasPrev ? tr('YoY, periode sama') : tr('Tidak ada data pembanding') })
      return out
    },
  }
}

/** Server measures the KPI tiles read from the grand total (dataset KPI metadata), or [] when none. */
export function kpiMeasures(dataset: Dataset, engine: Engine): string[] {
  return engine.serverMeasures([dataset.kpi.actual, dataset.kpi.target, dataset.kpi.achievement].filter((x): x is string => !!x && engine.defs.has(x)))
}
