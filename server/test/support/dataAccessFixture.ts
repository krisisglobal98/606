/**
 * Shared fixture for the data access tests: a small organization snapshot shaped like the PIMS master, datasets
 * shaped like the audited ones (business_unit / kodebisnisunit, groupcode, regioncode, company = alias, ray, afd,
 * ownership; an actual + budget pair), their table metadata, the rows of the TEMP source tables, and an
 * in-memory MetadataDb for DataAccessService (assignments, validations, audit).
 */
import type { User } from '../../src/auth/authService.ts'
import type { Config } from '../../src/config/config.ts'
import type { MetadataDb } from '../../src/db/metadataDb.ts'
import type { DatasetRecord } from '../../src/datasets/datasetService.ts'
import type { SemanticModel } from '../../src/datasets/semantic.ts'
import { buildSnapshot } from '../../src/dataAccess/orgMaster.ts'
import type { Assignment, ScopeRules } from '../../src/dataAccess/scope.ts'
import type { TableMetadata } from '../../src/dw/metadata.ts'

/* ---------------- Organization (ids are strings of digits, like PIMS snowflakes) ---------------- */
export const ID = {
  FRG: '101', FAP: '102',
  PKU: '201', BPN: '202',
  SAM: '301', CLP: '302', BHP: '303',
  SAM1: '401', SAM2: '402', CLP1: '403', BHP1: '404',
  GMK1: '501', FR_RIAU_1: '502',
  RAYON_A: '601', RAYON_B: '602',
  DIV01: '701', DIV02: '702',
  S_REGION: '801', S_KEDP: '802',
  N_DP_RIAU_1: '901', N_MD_RIAU: '902', N_HMILL: '903',
} as const

export const snapshot = (loadedAt = 0) =>
  buildSnapshot(
    {
      groups: [{ id: ID.FRG, code: 'FRG', name: 'FIRST RESOURCES GROUP' }, { id: ID.FAP, code: 'FAP', name: 'FAP AGRI' }],
      regions: [{ id: ID.PKU, code: 'PKU', name: 'RIAU', group_id: ID.FRG }, { id: ID.BPN, code: 'BPN', name: 'BALIKPAPAN', group_id: ID.FAP }],
      companies: [
        { id: ID.SAM, code: 'A06', name: 'PT. SUBUR ARUM MAKMUR', alias: 'SAM', oracle: 'A06', group_id: ID.FRG, region_id: ID.PKU },
        { id: ID.CLP, code: '01', name: 'PT. CILIANDRA PERKASA', alias: 'CLP', oracle: '01', group_id: ID.FRG, region_id: ID.PKU },
        { id: ID.BHP, code: 'B01', name: 'PT. BULUNGAN HIJAU PERKASA', alias: 'BHP', oracle: 'B01', group_id: ID.FAP, region_id: ID.BPN },
      ],
      units: [
        { id: ID.SAM1, code: 'SAM-1', name: 'SAM - Kebun 1', company_id: ID.SAM },
        { id: ID.SAM2, code: 'SAM-2', name: 'SAM - Kebun 2', company_id: ID.SAM },
        { id: ID.CLP1, code: 'CLP-1', name: 'CLP - Kebun 1', company_id: ID.CLP },
        { id: ID.BHP1, code: 'BHP-1', name: 'BHP - Kebun 1', company_id: ID.BHP },
      ],
      gmks: [{ id: ID.GMK1, name: 'GMK 1', group_id: ID.FAP }, { id: ID.FR_RIAU_1, name: 'FR-RIAU-1', group_id: ID.FRG }],
      gmkUnits: [{ gmk_id: ID.GMK1, unit_id: ID.BHP1 }, { gmk_id: ID.FR_RIAU_1, unit_id: ID.SAM1 }, { gmk_id: ID.FR_RIAU_1, unit_id: ID.CLP1 }],
      rayons: [{ id: ID.RAYON_A, code: 'A', name: 'Rayon A' }, { id: ID.RAYON_B, code: 'B', name: 'Rayon B' }],
      divisions: [{ id: ID.DIV01, code: '01', name: 'AFDELING-01' }, { id: ID.DIV02, code: '02', name: 'AFDELING-02' }],
      // Incomplete like PIMS: only SAM-1 / 01 is related.
      unitDivisions: [{ unit_id: ID.SAM1, division_id: ID.DIV01 }],
      structures: [{ id: ID.S_REGION, code: 'REGION', name: 'Region', level: 2 }, { id: ID.S_KEDP, code: 'KEDP', name: 'Area - DP', level: 4 }],
      nodes: [
        { id: ID.N_DP_RIAU_1, structure_id: ID.S_KEDP, parent_id: null, code: 'DP-RIAU-1', name: 'DP-RIAU-1', is_virtual: false },
        { id: ID.N_MD_RIAU, structure_id: ID.S_REGION, parent_id: null, code: 'MD-RIAU', name: 'MD-RIAU', is_virtual: false },
        { id: ID.N_HMILL, structure_id: ID.S_KEDP, parent_id: null, code: 'HMILL', name: 'HEAD MILL', is_virtual: false },
      ],
      nodeUnits: [
        { node_id: ID.N_DP_RIAU_1, unit_id: ID.SAM1 }, { node_id: ID.N_DP_RIAU_1, unit_id: ID.CLP1 },
        { node_id: ID.N_MD_RIAU, unit_id: ID.SAM1 }, { node_id: ID.N_MD_RIAU, unit_id: ID.SAM2 }, { node_id: ID.N_MD_RIAU, unit_id: ID.CLP1 },
        { node_id: ID.N_HMILL, unit_id: ID.SAM1 }, { node_id: ID.N_HMILL, unit_id: ID.SAM2 }, { node_id: ID.N_HMILL, unit_id: ID.CLP1 }, { node_id: ID.N_HMILL, unit_id: ID.BHP1 },
      ],
      ownerships: [{ id: '1', name: 'INTI' }, { id: '2', name: 'PLASMA' }, { id: '3', name: 'KKPA' }],
    },
    loadedAt,
  )

/** Approved lists as the owner would set them: only DP-RIAU-1 is a Direktur area; only GMK 1 is a GMK. */
export const rules: ScopeRules = { regionSource: 'ms_region', wilayahNodeIds: new Set([ID.N_DP_RIAU_1]), gmkHeaderIds: new Set([ID.GMK1]) }

let seq = 0
export function asg(p: Partial<Assignment> & Pick<Assignment, 'level' | 'orgKind' | 'orgId'>): Assignment {
  const orgLevel = p.orgLevel ?? (p.level === 'RAYON' || p.level === 'DIVISION' ? 'BUSINESS_UNIT' : (p.level as Assignment['orgLevel']))
  return { id: p.id ?? `a${++seq}`, label: '', active: true, subKind: null, subId: null, ownership: null, ...p, orgLevel }
}

/* ---------------- Datasets ---------------- */
const actual = { alias: 'actual', table: 't_act', label: 'Aktual', role: 'actual' as const, dateColumn: 'tanggal' }
const budget = { alias: 'budget', table: 't_bud', label: 'Budget', role: 'budget' as const, dateColumn: 'tanggal' }
const measures: SemanticModel['measures'] = [
  { id: 'produksi', label: 'Produksi', unit: 'Kg', decimals: 0, type: 'sum', source: 'actual', column: 'produksi' },
  { id: 'budget_produksi', label: 'Budget', unit: 'Kg', decimals: 0, type: 'sum', source: 'budget', column: 'produksi_b' },
]
const dims: SemanticModel['dimensions'] = [
  { id: 'bisnis_unit', label: 'Kode Bisnis Unit', columns: { actual: 'business_unit', budget: 'kodebisnisunit' } },
  { id: 'group', label: 'Group', columns: { actual: 'groupcode', budget: null } },
  { id: 'region', label: 'Region', columns: { actual: 'regioncode', budget: null } },
  { id: 'company', label: 'Perusahaan', columns: { actual: 'company', budget: null } },
  { id: 'ray', label: 'Ray', columns: { actual: 'ray', budget: null } },
  { id: 'afdeling', label: 'Afdeling', columns: { actual: 'afd', budget: null } },
  { id: 'kepemilikan', label: 'Kepemilikan', columns: { actual: 'ownership', budget: null } },
]
export const model = (over: Partial<SemanticModel> = {}): SemanticModel => ({
  version: 1,
  sources: [actual, budget],
  dimensions: dims,
  measures,
  entity: ['bisnis_unit'],
  kpi: { actual: 'produksi', target: 'budget_produksi' },
  scopeFields: ['bisnis_unit'],
  filterFields: [],
  defaultLayout: { dimensions: ['bisnis_unit'], measures: ['produksi'] },
  ...over,
})
export const UPDATED = '2026-11-01T00:00:00.000Z'
export const dataset = (id: string, m: SemanticModel = model()): DatasetRecord => ({
  id, name: id, description: '', connectionId: 'pg', connectionName: 'PG', environment: 'test', schema: 'pg_temp', sourceTables: m.sources.map((s) => s.table),
  status: 'active', semantic: m, category: null, createdBy: null, createdAt: UPDATED, updatedAt: UPDATED,
})
/** Variants of the matrix: no BU (NONE), a non-PIMS unit column (NONPIMS), a source without BU (multi-source NONE). */
export const noBu = () => model({ sources: [actual], measures: [measures[0]!], dimensions: [{ id: 'region', label: 'Region', columns: { actual: 'regioncode' } }], entity: [], scopeFields: [], kpi: { actual: 'produksi', target: null } })
export const nonPims = () => model({ sources: [actual], measures: [measures[0]!], dimensions: [{ id: 'kebun', label: 'Kebun', columns: { actual: 'kebun_id' } }], entity: [], scopeFields: [], kpi: { actual: 'produksi', target: null } })
export const budgetWithoutBu = () => model({ dimensions: dims.map((d) => (d.id === 'bisnis_unit' ? { ...d, columns: { actual: 'business_unit', budget: null } } : d)) })

const col = (name: string, dataType: string, typeCategory: 'string' | 'number' | 'date', ordinal: number) => ({ name, ordinal, dataType, typeCategory, nullable: true, defaultValue: null, comment: null, stats: null })
const tbl = (name: string, cols: ReturnType<typeof col>[]) => ({ schema: 'pg_temp', name, kind: 'table', estimatedRows: null, totalBytes: null, columnCount: cols.length, comment: null, lastAnalyzedAt: null, canSelect: true, columns: cols, indexes: [] }) as unknown as TableMetadata
export const tables: Record<string, TableMetadata> = {
  t_act: tbl('t_act', [col('tanggal', 'date', 'date', 1), col('business_unit', 'text', 'string', 2), col('groupcode', 'text', 'string', 3), col('regioncode', 'text', 'string', 4), col('company', 'text', 'string', 5), col('ray', 'text', 'string', 6), col('afd', 'text', 'string', 7), col('ownership', 'text', 'string', 8), col('produksi', 'numeric', 'number', 9), col('kebun_id', 'text', 'string', 10)]),
  t_bud: tbl('t_bud', [col('tanggal', 'date', 'date', 1), col('kodebisnisunit', 'text', 'string', 2), col('produksi_b', 'numeric', 'number', 3)]),
}

/**
 * Source rows. The comments give the expected visibility; totals are asserted in the SQL/API tests.
 * actual total 450, budget total 1200.
 */
export const ACTUAL_ROWS: [string, string, string | null, string, string, string, string, string, number][] = [
  ['2026-01-05', 'SAM-1', 'FRG', 'PKU', 'SAM', 'A', '01', 'INTI', 10],
  ['2026-01-06', 'SAM-1', 'FRG', 'PKU', 'SAM', 'B', '02', 'PLASMA', 20],
  ['2026-01-07', 'SAM-2', 'FRG', 'PKU', 'SAM', 'A', '01', 'INTI', 30],
  ['2026-01-08', 'CLP-1', 'FRG', 'PKU', 'CLP', 'A', '01', 'PLASMA', 40],
  ['2026-01-09', 'BHP-1', 'FAP', 'BPN', 'BHP', 'A', '01', 'INTI', 50],
  // A company code in the BU column (PARTIAL): hidden from every scoped user.
  ['2026-01-10', 'CLP', 'FRG', 'PKU', 'CLP', 'A', '01', 'INTI', 60],
  // Group inconsistent with SAM-1's master group (K-09): hidden from every scoped user.
  ['2026-01-11', 'SAM-1', 'FAP', 'PKU', 'SAM', 'A', '01', 'INTI', 70],
  ['2026-01-12', 'SAM-2', 'FRG', 'PKU', 'SAM', 'A', '01', 'PLASMA', 80],
  // FRG + INTI outside SAM: must never appear for "FRG+PLASMA" and "SAM+INTI" together.
  ['2026-01-13', 'CLP-1', 'FRG', 'PKU', 'CLP', 'A', '01', 'INTI', 90],
]
export const BUDGET_ROWS: [string, string, number][] = [
  ['2026-01-05', 'SAM-1', 100],
  ['2026-01-05', 'BHP-1', 500],
  ['2026-01-05', 'CLP', 600],
]
export const TEMP_SQL = [
  'CREATE TEMP TABLE t_act (tanggal date, business_unit text, groupcode text, regioncode text, company text, ray text, afd text, ownership text, produksi numeric, kebun_id text) ON COMMIT DROP',
  'CREATE TEMP TABLE t_bud (tanggal date, kodebisnisunit text, produksi_b numeric) ON COMMIT DROP',
]

/* ---------------- Users ---------------- */
export const user = (username: string, role: User['role'] = 'viewer'): User => ({ id: `id-${username}`, username, name: username, role })

/* ---------------- In-memory MetadataDb for DataAccessService ---------------- */
export interface FakeDb {
  db: MetadataDb
  assignments: Map<string, Assignment[]>
  validations: Map<string, { status: 'ok' | 'partial' | 'failed'; dataset_updated_at: Date; checked_at: Date; detail: unknown }>
  audit: { user_id: string | null; action: string; target: string; detail: unknown }[]
  settings: Map<string, unknown>
  users: Map<string, string>
}

export function fakeDb(): FakeDb {
  const f: FakeDb = { assignments: new Map(), validations: new Map(), audit: [], settings: new Map(), users: new Map(), db: null as unknown as MetadataDb }
  const rowOf = (userId: string, a: Assignment) => ({ id: a.id, user_id: userId, level: a.level, org_level: a.orgLevel, org_kind: a.orgKind, org_id: a.orgId, sub_kind: a.subKind, sub_id: a.subId, ownership: a.ownership, label: a.label, active: a.active, created_at: new Date(0), created_by: null })
  const query = async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim()
    if (s.startsWith('SELECT * FROM dor_user_access WHERE user_id = $1')) return { rows: (f.assignments.get(params[0] as string) ?? []).map((a) => rowOf(params[0] as string, a)), rowCount: 0 }
    if (s.startsWith('SELECT status, dataset_updated_at')) {
      const v = f.validations.get(params[0] as string)
      return { rows: v ? [v] : [], rowCount: v ? 1 : 0 }
    }
    if (s.startsWith('INSERT INTO dor_audit')) {
      f.audit.push({ user_id: params[0] as string | null, action: params[1] as string, target: params[2] as string, detail: params[3] ? JSON.parse(params[3] as string) : null })
      return { rows: [], rowCount: 1 }
    }
    if (s.startsWith('SELECT value FROM dor_setting')) return { rows: f.settings.has(params[0] as string) ? [{ value: f.settings.get(params[0] as string) }] : [], rowCount: 0 }
    if (s.startsWith('INSERT INTO dor_setting')) {
      f.settings.set(params[0] as string, JSON.parse(params[1] as string))
      return { rows: [], rowCount: 1 }
    }
    if (s.startsWith('SELECT username FROM dor_user WHERE id = $1')) return { rows: f.users.has(params[0] as string) ? [{ username: f.users.get(params[0] as string) }] : [], rowCount: 0 }
    if (s.startsWith('INSERT INTO dor_dataset_org_validation')) {
      f.validations.set(params[0] as string, { dataset_updated_at: new Date(params[1] as string), status: params[2] as 'ok', checked_at: new Date(), detail: JSON.parse(params[4] as string) })
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`fake db: unexpected SQL ${s.slice(0, 80)}`)
  }
  // A transaction client for putAssignments (BEGIN/SELECT … FOR UPDATE/DELETE/INSERT/COMMIT).
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] }
      if (s.startsWith('SELECT id FROM dor_user WHERE id = $1 FOR UPDATE')) return { rows: f.users.has(params[0] as string) ? [{ id: params[0] }] : [] }
      if (s.startsWith('SELECT * FROM dor_user_access WHERE user_id = $1')) return query(sql, params)
      if (s.startsWith('DELETE FROM dor_user_access WHERE user_id = $1')) return (f.assignments.set(params[0] as string, []), { rows: [] })
      if (s.startsWith('INSERT INTO dor_user_access')) {
        const [userId, level, orgLevel, orgKind, orgId, subKind, subId, ownership, label] = params as [string, string, string, string, string, string | null, string | null, string[] | null, string]
        const list = f.assignments.get(userId) ?? []
        list.push({ id: `db${list.length + 1}`, level, orgLevel, orgKind, orgId, subKind, subId, ownership, label, active: true } as Assignment)
        f.assignments.set(userId, list)
        return { rows: [] }
      }
      return query(sql, params)
    },
    release: () => {},
  }
  f.db = { query, pool: { connect: async () => client } } as unknown as MetadataDb
  return f
}

export const accessConfig = (over: Partial<Config['dataAccess']> = {}): Config =>
  ({
    orgDb: { host: 'x', port: 5432, database: 'dor_apims_master', user: 'dod_org_ro', password: 'x', ssl: false },
    dataAccess: { cacheMs: 300_000, regionSource: 'ms_region', wilayahNodeIds: [ID.N_DP_RIAU_1], gmkHeaderIds: [ID.GMK1], unrestrictedUsers: ['auditor'], managers: ['manager'], ...over },
    limits: { analyticsTimeoutMs: 30_000, metadataTimeoutMs: 15_000, resultDefaultLimit: 3000, resultMaxLimit: 20_000, exportMaxRows: 50_000, distinctValuesMax: 500, resultCacheMs: 0 },
  }) as unknown as Config
