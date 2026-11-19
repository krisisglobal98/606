/**
 * Semantic model of a DOD dataset: how business concepts map onto source columns.
 *
 * Stored as DOD metadata (dor_dataset.semantic), never as a change to the source database.
 * Differences between sources are normalised here: a concept may be `regioncode` in one table and
 * `region_code` in another, or `tahuntanam` int8 vs text. Dimensions are compared as text, so both
 * sides of an actual-vs-budget join line up without touching the source schema.
 */
import { z } from 'zod'
import type { ColumnInfo, TableMetadata } from '../dw/metadata.ts'

const Id = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'id hanya huruf kecil, angka, dan _')

export const SourceSchema = z.object({
  alias: Id,
  table: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(['actual', 'budget', 'other']),
  dateColumn: z.string().min(1),
})

export const DimensionSchema = z.object({
  id: Id,
  label: z.string().min(1),
  /** Column per source alias; null when the concept does not exist in that source. */
  columns: z.record(z.string(), z.string().nullable()),
  description: z.string().optional(),
})

const MeasureBase = { id: Id, label: z.string().min(1), unit: z.string(), decimals: z.number().int().min(0).max(6), description: z.string().optional() }

export const MeasureSchema = z.discriminatedUnion('type', [
  /** SUM over the source rows (flows: production, bunches, harvest area, labour). */
  z.object({ ...MeasureBase, type: z.literal('sum'), source: Id, column: z.string().min(1) }),
  /**
   * Stock values repeated on every daily row (planted area, palm count): taken once per entity and then summed,
   * so a month does not count the area 30 times. pick (per entity, within each period window):
   *   max  (default) the largest value: right for stock that only grows or stays (area, palms);
   *   last the value on the entity's latest date in the window, 0 included: right for a daily status (units
   *        standby / down today), where max would count every unit that was ever standby in the period.
   */
  z.object({ ...MeasureBase, type: z.literal('snapshot'), source: Id, column: z.string().min(1), pick: z.enum(['max', 'last']).optional() }),
  /** numerator / denominator × scale, computed after aggregation (never an average of ratios). */
  z.object({ ...MeasureBase, type: z.literal('ratio'), numerator: Id, denominator: Id, scale: z.number() }),
])

export const SemanticModelSchema = z.object({
  version: z.literal(1),
  sources: z.array(SourceSchema).min(1).max(4),
  dimensions: z.array(DimensionSchema),
  measures: z.array(MeasureSchema).min(1),
  /** Dimension ids that identify one physical entity (e.g. business unit + afdeling + block). */
  entity: z.array(Id),
  kpi: z.object({ actual: Id, target: Id.nullable() }),
  scopeFields: z.array(Id),
  filterFields: z.array(Id),
  defaultLayout: z.object({ dimensions: z.array(Id), measures: z.array(Id).min(1) }),
})

export type SemanticSource = z.infer<typeof SourceSchema>
export type SemanticDimension = z.infer<typeof DimensionSchema>
export type SemanticMeasure = z.infer<typeof MeasureSchema>
export type SemanticModel = z.infer<typeof SemanticModelSchema>

/** Time dimensions derived from each source's date column (not stored in the model). */
export const TIME_DIMENSIONS = [
  { id: 'tanggal', label: 'Tanggal', description: 'Periode bulanan (awal bulan)' },
  { id: 'tahun', label: 'Tahun', description: 'Tahun kalender' },
  { id: 'bulan', label: 'Bulan', description: 'Bulan kalender (Jan–Des), lintas tahun' },
  { id: 'hari', label: 'Hari', description: 'Tanggal harian' },
] as const
export type TimeDimensionId = (typeof TIME_DIMENSIONS)[number]['id']
export const isTimeDim = (id: string): id is TimeDimensionId => TIME_DIMENSIONS.some((t) => t.id === id)

/* ------------------------------------------------------------------ */
/* Business concept dictionary used to suggest a mapping.              */
/* A suggestion only; every mapping can be edited before saving.       */
/* ------------------------------------------------------------------ */

const DIM_CONCEPTS: { id: string; label: string; names: string[] }[] = [
  { id: 'bisnis_unit', label: 'Kode Bisnis Unit', names: ['kodebisnisunit', 'kode_bisnis_unit', 'bisnisunit', 'business_unit', 'kodebu'] },
  { id: 'group', label: 'Group', names: ['groupcode', 'group_code', 'grup', 'group'] },
  { id: 'region', label: 'Region', names: ['regioncode', 'region_code', 'region'] },
  { id: 'company', label: 'Perusahaan', names: ['companycodeora', 'companycode', 'company_code', 'perusahaan'] },
  { id: 'afdeling', label: 'Afdeling', names: ['afdeling', 'afd', 'divisi'] },
  { id: 'blok', label: 'Blok', names: ['blok', 'blokcode', 'blok_code', 'block', 'blockcode'] },
  { id: 'kepemilikan', label: 'Kepemilikan', names: ['ownershipname', 'statuskepemilikan', 'ownership', 'kepemilikan'] },
  { id: 'tahun_tanam', label: 'Tahun Tanam', names: ['tahuntanam', 'tahun_tanam', 'planting_year'] },
]

/** Production measures. `budget` names are tried on budget-role sources. */
const MEASURE_CONCEPTS: { id: string; label: string; unit: string; decimals: number; type: 'sum' | 'snapshot'; actual: string[]; budget: string[] }[] = [
  { id: 'produksi', label: 'Produksi', unit: 'Kg', decimals: 0, type: 'sum', actual: ['produksi_harian', 'produksi'], budget: ['produksi_harian'] },
  { id: 'janjang', label: 'Janjang', unit: 'Jjg', decimals: 0, type: 'sum', actual: ['janjang', 'janjang_harian'], budget: ['janjang_harian'] },
  { id: 'ha_panen', label: 'Ha Panen', unit: 'Ha', decimals: 1, type: 'sum', actual: ['hapanen', 'hapanen_harian'], budget: ['hapanen_harian'] },
  { id: 'hk_panen', label: 'HK Panen', unit: 'HK', decimals: 0, type: 'sum', actual: ['hkpanen', 'hkpanen_harian'], budget: ['hkpanen_harian'] },
  { id: 'luas', label: 'Luas', unit: 'Ha', decimals: 1, type: 'snapshot', actual: ['luas'], budget: ['luas'] },
  { id: 'jumlah_pokok', label: 'Jumlah Pokok', unit: 'Pokok', decimals: 0, type: 'snapshot', actual: ['jmlpkk', 'jumlah_pokok'], budget: ['jmlpkk'] },
]

const DATE_NAMES = ['tanggal', 'tgl', 'date', 'tanggal_transaksi']
const BUDGET_HINT = /(budget|target|rencana|plan)/i

const find = (cols: ColumnInfo[], names: string[]) => names.map((n) => cols.find((c) => c.name.toLowerCase() === n)).find(Boolean) ?? null
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
const safeId = (s: string) => {
  const id = s.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 60)
  return id || 'kolom'
}

/** Suggests a semantic model for the chosen tables from their discovered metadata. */
export function suggestModel(tables: TableMetadata[]): SemanticModel {
  const sources: SemanticSource[] = []
  for (const t of tables) {
    const role = BUDGET_HINT.test(t.name) ? 'budget' : sources.some((s) => s.role === 'actual') ? 'other' : 'actual'
    const date = find(t.columns, DATE_NAMES) ?? t.columns.find((c) => c.typeCategory === 'date')
    if (!date) continue
    const alias = role === 'other' ? safeId(t.name).slice(0, 20) : role
    if (sources.some((s) => s.alias === alias)) continue
    sources.push({ alias, table: t.name, label: role === 'actual' ? 'Aktual' : role === 'budget' ? 'Budget' : pretty(t.name), role, dateColumn: date.name })
  }
  const colsOf = (alias: string) => tables.find((t) => t.name === sources.find((s) => s.alias === alias)?.table)?.columns ?? []

  const dimensions: SemanticDimension[] = []
  for (const k of DIM_CONCEPTS) {
    const columns: Record<string, string | null> = {}
    for (const s of sources) columns[s.alias] = find(colsOf(s.alias), k.names)?.name ?? null
    // With several sources, only concepts present in all of them are suggested: a dimension missing in
    // one source cannot split that source's measures (it can still be added by hand).
    const mapped = Object.values(columns).filter(Boolean).length
    if (mapped && (sources.length === 1 || mapped === sources.length)) dimensions.push({ id: k.id, label: k.label, columns })
  }
  const measures: SemanticMeasure[] = []
  for (const s of sources) {
    const prefix = s.role === 'budget' ? 'budget_' : s.role === 'other' ? `${s.alias}_` : ''
    for (const k of MEASURE_CONCEPTS) {
      const col = find(colsOf(s.alias), s.role === 'budget' ? k.budget : k.actual)
      if (!col || col.typeCategory !== 'number') continue
      measures.push({ id: `${prefix}${k.id}`, label: s.role === 'actual' ? k.label : `${k.label} (${s.label})`, unit: k.unit, decimals: k.decimals, type: k.type, source: s.alias, column: col.name })
    }
  }

  // Generic fallback for tables outside the production dictionary: text columns become dimensions,
  // numeric columns become SUM measures.
  if (!measures.length) {
    for (const s of sources) {
      for (const c of colsOf(s.alias)) {
        if (c.name === s.dateColumn) continue
        if (c.typeCategory === 'number' && !/(^|_)(id|row_id|kode)$/.test(c.name)) {
          measures.push({ id: safeId(`${s.alias === 'actual' ? '' : `${s.alias}_`}${c.name}`), label: pretty(c.name), unit: '', decimals: 2, type: 'sum', source: s.alias, column: c.name })
        } else if (c.typeCategory === 'string' && !dimensions.some((d) => d.columns[s.alias] === c.name)) {
          const id = safeId(c.name)
          if (!dimensions.some((d) => d.id === id)) dimensions.push({ id, label: pretty(c.name), columns: Object.fromEntries(sources.map((x) => [x.alias, x.alias === s.alias ? c.name : null])) })
        }
      }
    }
  }

  const has = (id: string) => measures.some((m) => m.id === id)
  if (has('produksi') && has('budget_produksi')) measures.push({ id: 'achievement', label: 'Achievement', unit: '%', decimals: 1, type: 'ratio', numerator: 'produksi', denominator: 'budget_produksi', scale: 100, description: 'Produksi aktual terhadap budget' })
  if (has('produksi') && has('janjang')) measures.push({ id: 'bjr', label: 'BJR', unit: 'Kg/Jjg', decimals: 2, type: 'ratio', numerator: 'produksi', denominator: 'janjang', scale: 1, description: 'Berat janjang rata-rata: produksi dibagi janjang' })
  if (has('produksi') && has('ha_panen')) measures.push({ id: 'produktivitas', label: 'Produktivitas Panen', unit: 'Kg/Ha', decimals: 0, type: 'ratio', numerator: 'produksi', denominator: 'ha_panen', scale: 1, description: 'Produksi per hektar yang dipanen' })
  if (has('produksi') && has('hk_panen')) measures.push({ id: 'output_hk', label: 'Output per HK', unit: 'Kg/HK', decimals: 0, type: 'ratio', numerator: 'produksi', denominator: 'hk_panen', scale: 1, description: 'Produksi per hari kerja panen' })

  const firstSum = measures.find((m) => m.type === 'sum')
  const kpiActual = has('produksi') ? 'produksi' : (firstSum?.id ?? measures[0]!.id)
  // A target must be a different measure than the actual (a budget-only table has no separate target).
  const kpiTarget = has('budget_produksi') && kpiActual !== 'budget_produksi' ? 'budget_produksi' : null
  const dimIds = dimensions.map((d) => d.id)
  const pick = (ids: string[]) => ids.filter((i) => dimIds.includes(i))
  return {
    version: 1,
    sources,
    dimensions,
    measures,
    entity: pick(['bisnis_unit', 'afdeling', 'blok']).length === 3 ? ['bisnis_unit', 'afdeling', 'blok'] : [],
    kpi: { actual: kpiActual, target: kpiTarget },
    scopeFields: pick(['group', 'region', 'bisnis_unit', 'kepemilikan']).slice(0, 4),
    filterFields: pick(['bisnis_unit', 'afdeling']).slice(0, 2),
    defaultLayout: {
      dimensions: pick(['region', 'bisnis_unit']).length ? pick(['region', 'bisnis_unit']) : dimIds.slice(0, 1),
      measures: [...new Set([kpiActual, ...(kpiTarget ? [kpiTarget, 'achievement'] : [])])].filter((id) => measures.some((m) => m.id === id)),
    },
  }
}

/** Removes repeated ids from the ordered field lists (an older suggestion could repeat the KPI). */
export function normalizeModel(m: SemanticModel): SemanticModel {
  const u = (xs: string[]) => [...new Set(xs)]
  return { ...m, entity: u(m.entity), scopeFields: u(m.scopeFields), filterFields: u(m.filterFields), defaultLayout: { dimensions: u(m.defaultLayout.dimensions), measures: u(m.defaultLayout.measures) } }
}

/**
 * Checks a model against live metadata: every referenced table/column exists, date columns are dates,
 * measures are numeric, ids are unique and references resolve. Returns readable problems.
 */
export function validateModel(m: SemanticModel, tables: TableMetadata[]): string[] {
  const out: string[] = []
  const table = (alias: string) => {
    const s = m.sources.find((x) => x.alias === alias)
    return s ? tables.find((t) => t.name === s.table) : undefined
  }
  const col = (alias: string, name: string) => table(alias)?.columns.find((c) => c.name === name)
  const ids = new Set<string>()
  const dup = (id: string) => {
    if (ids.has(id) || isTimeDim(id)) out.push(`Id "${id}" dipakai lebih dari sekali.`)
    ids.add(id)
  }
  for (const s of m.sources) {
    const t = tables.find((x) => x.name === s.table)
    if (!t) out.push(`Tabel ${s.table} tidak ditemukan di sumber.`)
    else {
      const dc = t.columns.find((c) => c.name === s.dateColumn)
      if (!dc) out.push(`Kolom tanggal ${s.table}.${s.dateColumn} tidak ditemukan.`)
      else if (dc.typeCategory !== 'date') out.push(`Kolom ${s.table}.${s.dateColumn} bukan tipe tanggal (${dc.dataType}).`)
    }
  }
  if (new Set(m.sources.map((s) => s.alias)).size !== m.sources.length) out.push('Alias sumber harus unik.')
  for (const d of m.dimensions) {
    dup(d.id)
    for (const [alias, name] of Object.entries(d.columns)) {
      if (!m.sources.some((s) => s.alias === alias)) out.push(`Dimensi ${d.label}: sumber "${alias}" tidak dikenal.`)
      else if (name && !col(alias, name)) out.push(`Dimensi ${d.label}: kolom ${table(alias)?.name ?? alias}.${name} tidak ditemukan.`)
    }
    if (!Object.values(d.columns).some(Boolean)) out.push(`Dimensi ${d.label} belum dipetakan ke kolom mana pun.`)
  }
  for (const me of m.measures) {
    dup(me.id)
    if (me.type === 'ratio') {
      for (const ref of [me.numerator, me.denominator]) {
        const r = m.measures.find((x) => x.id === ref)
        if (!r) out.push(`Measure ${me.label}: "${ref}" tidak ditemukan.`)
        else if (r.type === 'ratio') out.push(`Measure ${me.label}: rasio harus dibentuk dari measure dasar, bukan rasio lain.`)
      }
    } else {
      const c = col(me.source, me.column)
      if (!m.sources.some((s) => s.alias === me.source)) out.push(`Measure ${me.label}: sumber "${me.source}" tidak dikenal.`)
      else if (!c) out.push(`Measure ${me.label}: kolom ${table(me.source)?.name ?? me.source}.${me.column} tidak ditemukan.`)
      else if (c.typeCategory !== 'number') out.push(`Measure ${me.label}: kolom ${me.column} bertipe ${c.dataType}, bukan angka.`)
      if (me.type === 'snapshot') {
        if (!m.entity.length) out.push(`Measure ${me.label} bertipe snapshot memerlukan kunci entitas (mis. bisnis unit + afdeling + blok).`)
        for (const e of m.entity) if (!m.dimensions.find((d) => d.id === e)?.columns[me.source]) out.push(`Measure ${me.label}: kunci entitas "${e}" tidak dipetakan di sumber ${me.source}.`)
      }
    }
  }
  const measureIds = new Set(m.measures.map((x) => x.id))
  const dimIds = new Set([...m.dimensions.map((d) => d.id), ...TIME_DIMENSIONS.map((t) => t.id)])
  if (!measureIds.has(m.kpi.actual)) out.push(`KPI aktual "${m.kpi.actual}" bukan measure dataset.`)
  if (m.kpi.target && !measureIds.has(m.kpi.target)) out.push(`KPI target "${m.kpi.target}" bukan measure dataset.`)
  for (const e of m.entity) if (!m.dimensions.some((d) => d.id === e)) out.push(`Kunci entitas "${e}" bukan dimensi dataset.`)
  for (const f of [...m.scopeFields, ...m.filterFields, ...m.defaultLayout.dimensions]) if (!dimIds.has(f)) out.push(`Field "${f}" bukan dimensi dataset.`)
  for (const f of m.defaultLayout.measures) if (!measureIds.has(f)) out.push(`Field "${f}" bukan measure dataset.`)
  return [...new Set(out)]
}
