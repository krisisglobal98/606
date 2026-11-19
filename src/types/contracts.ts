/**
 * API contracts of the DOD backend, used by the frontend services.
 * Schemas are the single source of truth; TypeScript types are inferred from them,
 * and the API client validates every response against its schema.
 */
import { z } from 'zod'
import { tr } from '@/i18n'

/* ---------------- Errors ---------------- */
export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})

/* ---------------- Auth ---------------- */
export const RoleSchema = z.enum(['admin', 'analyst', 'publisher', 'viewer'])
export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  role: RoleSchema,
  /** Menu ids the role may open (Settings → Hak Akses Menu); absent from an older server: every menu of the role. */
  menus: z.array(z.string()).optional(),
  /** Own data access privileges (flags only; the scope is decided by the server on every request). */
  dataAccess: z.object({ unrestricted: z.boolean(), manager: z.boolean() }).optional(),
})
export type User = z.infer<typeof UserSchema>

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, tr('Username wajib diisi')),
  password: z.string().min(1, tr('Password wajib diisi')),
  /** One device, one user: sign the other user of this device out first. */
  takeOver: z.boolean().optional(),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const AuthSessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: UserSchema,
})
export type AuthSession = z.infer<typeof AuthSessionSchema>

/* ---------------- Dataset & fields ---------------- */
export const FieldKindSchema = z.enum(['dimension', 'measure'])
export type FieldKind = z.infer<typeof FieldKindSchema>

/** How a measure is computed from base aggregates (the semantic measure engine reads this). */
export const MeasureCalcSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('base') }),
  z.object({ kind: z.literal('ratio'), num: z.string(), den: z.string(), scale: z.number() }),
])

export const FieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: FieldKindSchema,
  dataType: z.enum(['date', 'string', 'number']),
  /** Display unit for measures, e.g. "Ton", "%". */
  unit: z.string().optional(),
  decimals: z.number().int().optional(),
  description: z.string().optional(),
  /** Measures only: base aggregate or ratio of two base aggregates. */
  calc: MeasureCalcSchema.optional(),
})
export type Field = z.infer<typeof FieldSchema>

/** Where a dataset's data comes from. `warehouse` = a real source queried by the DOD backend. */
export const DatasetSourceSchema = z.object({
  kind: z.enum(['mock', 'warehouse']),
  connectionId: z.string().optional(),
  connectionName: z.string().optional(),
  environment: z.string().optional(),
  tables: z.array(z.string()).optional(),
  available: z.boolean(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})

export const DatasetAccessSchema = z.object({
  status: z.enum(['ok', 'partial', 'denied']),
  code: z.string().nullable(),
  message: z.string().nullable(),
  notify: z.boolean(),
  unmappedShare: z.number().nullable(),
})

export const DatasetSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  description: z.string(),
  fields: z.array(FieldSchema),
  /** Measure used for the "actual" KPI, its plan counterpart, and the ratio KPI. */
  kpi: z.object({ actual: z.string(), target: z.string().nullable(), achievement: z.string().nullable() }),
  defaultLayout: z.object({ dimensions: z.array(z.string()), measures: z.array(z.string()) }),
  /** Date range of the user's rows; null until the dataset is chosen (GET /dw/catalog/:id) or when it has no rows. */
  coverage: z.object({ from: z.string(), to: z.string() }).nullable(),
  /** Absent for the built-in samples (they use the fixed organisation scope). */
  source: DatasetSourceSchema.optional(),
  /**
   * The signed-in user's data access to this dataset, decided by the server: denied = no data (reason in message:
   * dataset not standard, or no access scope); partial = rows without a valid Business Unit are hidden.
   */
  access: DatasetAccessSchema.optional(),
  /** Warehouse datasets: dimensions offered in Pengaturan Data and in the filter bar. */
  scopeFields: z.array(z.string()).optional(),
  filterFields: z.array(z.string()).optional(),
  /** Kategori → Sub-kategori of the master list (Data › Kategori); null when not categorised. */
  category: z.object({ name: z.string(), sub: z.string().nullable() }).nullable().optional(),
})
export type Dataset = z.infer<typeof DatasetSchema>

export const WarehouseCatalogSchema = z.object({ datasets: z.array(DatasetSchema) })
export type DatasetCatalog = z.infer<typeof WarehouseCatalogSchema>

/* ---------------- Analytics query ---------------- */
/** Dimension id → selected values. Samples use group/region/wilayah/perusahaan; warehouse datasets their own dimensions. */
export const DataScopeSchema = z.record(z.string(), z.array(z.string()))
export type DataScope = z.infer<typeof DataScopeSchema>

export const FilterSchema = z.object({
  perusahaan: z.string().nullable(),
  wilayah: z.string().nullable(),
  /** ISO dates, inclusive. */
  dateFrom: z.string(),
  dateTo: z.string(),
  /** Report date (tanggal laporan) of the H.I / S.D.H.I / YTD columns; null or absent = min(dateTo, today). */
  reportDate: z.string().nullable().optional(),
  /** Warehouse datasets: single-value filters by dimension id (filter bar). */
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.object({ like: z.string() })]).nullable()).optional(),
})
export type Filter = z.infer<typeof FilterSchema>

export const ChartTypeSchema = z.enum(['line', 'bar', 'area'])
export type ChartType = z.infer<typeof ChartTypeSchema>

export const AnalyticsQuerySchema = z.object({
  datasetId: z.string().min(1),
  scope: DataScopeSchema,
  filter: FilterSchema,
  dimensions: z.array(z.string()),
  measures: z.array(z.string()).min(1),
  /** "trend" = monthly along Tanggal; otherwise a dimension id. */
  chartBy: z.string(),
})
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>

/* ---------------- Analytics result ---------------- */
export const KpiSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  decimals: z.number().int(),
  /** Relative change in percent against the comparison period. */
  delta: z.number().nullable().optional(),
  deltaLabel: z.string().optional(),
  /** "%" = relative change, "pp" = percentage-point difference. */
  deltaUnit: z.enum(['%', 'pp']).optional(),
  /** true when a lower value is better (e.g. cost). */
  invert: z.boolean().optional(),
})
export type Kpi = z.infer<typeof KpiSchema>

export const ChartSeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  values: z.array(z.number().nullable()),
})
export const ChartDataSchema = z.object({
  categories: z.array(z.string()),
  series: z.array(ChartSeriesSchema),
  /** Measures left out of the chart because their unit differs from the first measure. */
  omitted: z.array(z.string()),
})

export const ResultRowSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  level: z.number().int(),
  label: z.string(),
  hasChildren: z.boolean(),
  values: z.record(z.string(), z.number().nullable()),
})
export type ResultRow = z.infer<typeof ResultRowSchema>

export const AnalyticsSummarySchema = z.object({
  periodLabel: z.string(),
  sourceRowCount: z.number().int(),
})

/** How a warehouse result was produced (shown to make the bounded transfer visible). */
export const ExecutionInfoSchema = z.object({
  engine: z.string(),
  source: z.string(),
  durationMs: z.number(),
  queries: z.number().int(),
  sourceRows: z.number(),
  resultRows: z.number().int(),
})

export const AnalyticsResultSchema = z.object({
  datasetId: z.string(),
  dimensions: z.array(FieldSchema),
  measures: z.array(FieldSchema),
  rows: z.array(ResultRowSchema),
  grandTotal: z.record(z.string(), z.number().nullable()),
  truncated: z.boolean(),
  chart: ChartDataSchema,
  summary: AnalyticsSummarySchema,
  execution: ExecutionInfoSchema.optional(),
})
export type AnalyticsResult = z.infer<typeof AnalyticsResultSchema>

/* ---------------- Settings ---------------- */
export const SettingsSchema = z.object({
  theme: z.enum(['light', 'dark']),
  // '/dashboard' and '/peta-kebun' (removed menus) are still accepted for saved preferences; the store moves them.
  landingPage: z.enum(['/beranda', '/executive-summary', '/analisis', '/peta-kebun', '/dashboard']),
  defaultChartType: ChartTypeSchema,
  density: z.enum(['comfortable', 'compact']),
})
export type Settings = z.infer<typeof SettingsSchema>

/* ---------------- Hierarchical grid (lazy) ---------------- */
/**
 * One level of the result hierarchy, optionally restricted to one parent. Values are base aggregates
 * for the period and the same period last year; every derived number is computed from them by the
 * frontend measure engine, so table, KPI and totals share one definition.
 */
export const GridRequestSchema = z.object({
  query: AnalyticsQuerySchema,
  /** Index into query.dimensions of the level to return. */
  depth: z.number().int().min(0),
  /** Parent values for levels 0..depth-1; null = every parent at that level. */
  path: z.array(z.string().nullable()).nullable(),
  withTotal: z.boolean(),
  /** Also return source row counts per base measure ("#count:<id>"), for Count / Average. */
  withCounts: z.boolean().optional(),
  /** Report-date windows: hi = H.I (the report date), sdhi = S.D.H.I (month to the report date), ytd = year to it. */
  windows: z.array(z.enum(['hi', 'sdhi', 'ytd'])).optional(),
})
export type GridRequest = z.infer<typeof GridRequestSchema>
export type ReportWindow = 'hi' | 'sdhi' | 'ytd'

const BaseValuesSchema = z.record(z.string(), z.number().nullable())
export const GridAggSchema = z.object({ cur: BaseValuesSchema, prev: BaseValuesSchema, hi: BaseValuesSchema.optional(), sdhi: BaseValuesSchema.optional(), ytd: BaseValuesSchema.optional() })
export type GridAgg = z.infer<typeof GridAggSchema>

export const GridRowSchema = GridAggSchema.extend({
  /** Raw dimension values from level 0 to this row's level. */
  path: z.array(z.string().nullable()),
  label: z.string(),
  hasChildren: z.boolean(),
})

export const GridResponseSchema = z.object({
  depth: z.number().int(),
  rows: z.array(GridRowSchema),
  total: GridAggSchema.nullable(),
  truncated: z.boolean(),
  sourceRows: z.number().nullable(),
  /** The report date the H.I / S.D.H.I / YTD windows used (present when windows were asked). */
  reportDate: z.string().optional(),
})
export type GridResponse = z.infer<typeof GridResponseSchema>
