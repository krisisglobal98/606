/**
 * Organization parameters of a dataset (docs/DATA_ACCESS.md), derived from the semantic model:
 * which dimension is the Business Unit, Group, Region, Company, Rayon, Divisi and Kepemilikan, and in which
 * form the source column holds the value (code or name). Pure.
 *
 * - Business Unit is ONE dimension: `business_unit` and `kodebisnisunit` are spellings of the same concept.
 * - Recognised only by the source column names verified in the audit; a dimension id or label is never trusted.
 * - Two dimensions of one kind are ambiguous: for BU that makes the dataset non-standard; for Rayon/Divisi the
 *   matching grants then return nothing (no fallback to the whole BU: that would widen access).
 */
import type { SemanticModel } from '../datasets/semantic.ts'

export type OrgDimKind = 'businessUnit' | 'group' | 'region' | 'company' | 'rayon' | 'division' | 'ownership'
/** How a column's values relate to the PIMS master. */
export type ValueForm = 'bu_code' | 'group_code' | 'region_code' | 'company_alias' | 'company_oracle' | 'rayon_code' | 'rayon_name' | 'division_code' | 'division_name' | 'ownership_name'

/** Column name (lower case) → kind and value form. Evidence: the dataset audit of 2026-11-10 (row-level consistency of the organization columns). */
export const ORG_COLUMNS: Record<string, { kind: OrgDimKind; form: ValueForm }> = {
  business_unit: { kind: 'businessUnit', form: 'bu_code' },
  kodebisnisunit: { kind: 'businessUnit', form: 'bu_code' },
  groupcode: { kind: 'group', form: 'group_code' },
  group_code: { kind: 'group', form: 'group_code' },
  regioncode: { kind: 'region', form: 'region_code' },
  region_code: { kind: 'region', form: 'region_code' },
  company: { kind: 'company', form: 'company_alias' },
  companycodeora: { kind: 'company', form: 'company_oracle' },
  ray: { kind: 'rayon', form: 'rayon_code' },
  rayon: { kind: 'rayon', form: 'rayon_name' },
  afd: { kind: 'division', form: 'division_code' },
  afdeling: { kind: 'division', form: 'division_code' },
  divisi: { kind: 'division', form: 'division_name' },
  ownership: { kind: 'ownership', form: 'ownership_name' },
  ownershipname: { kind: 'ownership', form: 'ownership_name' },
  statuskepemilikan: { kind: 'ownership', form: 'ownership_name' },
}
/** Business-unit-like columns that do NOT hold PIMS BU codes (dummy sources). */
const NON_PIMS_UNIT = new Set(['kebun_id', 'kebun', 'unit_id', 'bisnisunit', 'kodebu', 'kode_bisnis_unit'])

export interface OrgDim {
  dim: string
  /** Value form per source alias (null where the dimension is not mapped in that source). */
  forms: Record<string, ValueForm | null>
}

export interface DatasetOrgProfile {
  /** null = the dataset has no usable Business Unit parameter (reason in `standardProblem`). */
  businessUnit: OrgDim | null
  group: OrgDim | null
  region: OrgDim | null
  company: OrgDim | null
  /** 'ambiguous' = more than one dimension of that kind. */
  rayon: OrgDim | 'ambiguous' | null
  division: OrgDim | 'ambiguous' | null
  ownership: OrgDim | 'ambiguous' | null
  /** NONPIMS / NONE reason when there is no usable BU; null when the BU parameter is structurally fine. */
  /** missingField: the Unit Operasional column is absent (in the dataset or in one of its sources), not just unusable. */
  standardProblem: { status: 'NONPIMS' | 'NONE'; message: string; missingField?: boolean } | null
}

export function datasetOrgProfile(m: SemanticModel): DatasetOrgProfile {
  const aliases = m.sources.map((s) => s.alias)
  const byKind = new Map<OrgDimKind, OrgDim[]>()
  let nonPims = false
  for (const d of m.dimensions) {
    const cols = Object.entries(d.columns).filter(([, c]) => !!c) as [string, string][]
    if (!cols.length) continue
    const kinds = new Set(cols.map(([, c]) => ORG_COLUMNS[c.toLowerCase()]?.kind ?? null))
    if (cols.some(([, c]) => NON_PIMS_UNIT.has(c.toLowerCase()))) nonPims = true
    // One kind across all its mapped sources, and every mapped column recognised.
    if (kinds.size !== 1 || kinds.has(null)) continue
    const kind = [...kinds][0] as OrgDimKind
    const forms = Object.fromEntries(aliases.map((a) => [a, d.columns[a] ? ORG_COLUMNS[d.columns[a]!.toLowerCase()]!.form : null])) as Record<string, ValueForm | null>
    byKind.set(kind, [...(byKind.get(kind) ?? []), { dim: d.id, forms }])
  }
  const one = (k: OrgDimKind) => (byKind.get(k)?.length === 1 ? byKind.get(k)![0]! : null)
  const oneOrAmbiguous = (k: OrgDimKind) => ((byKind.get(k)?.length ?? 0) > 1 ? ('ambiguous' as const) : one(k))

  let businessUnit = one('businessUnit')
  let standardProblem: DatasetOrgProfile['standardProblem'] = null
  if ((byKind.get('businessUnit')?.length ?? 0) > 1) {
    businessUnit = null
    standardProblem = { status: 'NONE', message: 'Dataset memiliki lebih dari satu dimensi Unit Operasional; parameter default tidak dapat ditentukan.' }
  } else if (businessUnit && aliases.some((a) => !businessUnit!.forms[a])) {
    // Every source must be restricted; a source without BU would bring unfiltered rows through the FULL JOIN.
    businessUnit = null
    standardProblem = { status: 'NONE', message: 'Salah satu sumber dataset tidak memiliki kolom Unit Operasional (business_unit / kodebisnisunit).', missingField: true }
  } else if (!businessUnit) {
    standardProblem = nonPims
      ? { status: 'NONPIMS', message: 'Kolom unit pada dataset ini bukan kode Unit Operasional PIMS.' }
      : { status: 'NONE', message: 'Dataset tidak memiliki kolom Unit Operasional (business_unit / kodebisnisunit).', missingField: true }
  }
  return { businessUnit, group: one('group'), region: one('region'), company: one('company'), rayon: oneOrAmbiguous('rayon'), division: oneOrAmbiguous('division'), ownership: oneOrAmbiguous('ownership'), standardProblem }
}

/* ---------------- Validation of the BU values against the master (K-13) ---------------- */

export type ValidationStatus = 'ok' | 'partial' | 'failed'
export type DatasetOrgStatus = 'OK' | 'PARTIAL' | 'UNVERIFIED' | 'NONPIMS' | 'NONE' | 'FAILED'

export interface ValidationResult {
  status: ValidationStatus
  /** Share of source rows whose BU value is not an active PIMS BU code (hidden for scoped users). */
  unmappedShare: number
  rows: number
  unmappedRows: number
  /** At most 50 of the values that are not BU codes (e.g. company codes), for the dataset owner. */
  unmappedValues: string[]
  perSource: { alias: string; rows: number; unmappedRows: number; distinct: number; unmappedDistinct: number }[]
}

/** counts: per source alias, BU value (null = empty) → row count. */
export function validateUnitValues(counts: Record<string, { value: string | null; rows: number }[]>, unitCodes: ReadonlySet<string>): ValidationResult {
  const perSource = Object.entries(counts).map(([alias, list]) => {
    const unmapped = list.filter((x) => x.value == null || !unitCodes.has(x.value))
    return { alias, rows: sum(list), unmappedRows: sum(unmapped), distinct: list.length, unmappedDistinct: unmapped.length, values: unmapped.map((x) => x.value ?? '(kosong)') }
  })
  const rows = perSource.reduce((a, s) => a + s.rows, 0)
  const unmappedRows = perSource.reduce((a, s) => a + s.unmappedRows, 0)
  const mappedRows = rows - unmappedRows
  const status: ValidationStatus = mappedRows === 0 ? 'failed' : unmappedRows === 0 ? 'ok' : 'partial'
  return {
    status,
    unmappedShare: rows ? unmappedRows / rows : 0,
    rows,
    unmappedRows,
    unmappedValues: [...new Set(perSource.flatMap((s) => s.values))].sort().slice(0, 50),
    perSource: perSource.map((s) => ({ alias: s.alias, rows: s.rows, unmappedRows: s.unmappedRows, distinct: s.distinct, unmappedDistinct: s.unmappedDistinct })),
  }
}

const sum = (l: { rows: number }[]) => l.reduce((a, x) => a + x.rows, 0)

/** Status of a dataset for restricted users: structure first, then the stored validation of this dataset version. */
export function datasetOrgStatus(p: DatasetOrgProfile, v: { status: ValidationStatus; datasetUpdatedAt: string } | null, datasetUpdatedAt: string): DatasetOrgStatus {
  if (p.standardProblem) return p.standardProblem.status
  if (!v || new Date(v.datasetUpdatedAt).getTime() !== new Date(datasetUpdatedAt).getTime()) return 'UNVERIFIED'
  return v.status === 'ok' ? 'OK' : v.status === 'partial' ? 'PARTIAL' : 'FAILED'
}
