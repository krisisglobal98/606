/**
 * DataAccessGuard: the one decision point between a user's access scope and any data DOD returns.
 *
 *   forDataset(scope, dataset, validation) → RowScope ('all' | per-source row predicate) or an AppError
 *   rowPredicate(rowScope, source, expr, params, dialect) → SQL condition for that source (bind parameters only)
 *   coversRecord / profileFilter → Data Profil (blocks, vehicles) by PIMS ids
 *
 * The role of a user never appears here: an application administrator has no data access of its own (K-10).
 */
import { createHash } from 'node:crypto'
import type { DatasetRecord } from '../datasets/datasetService.ts'
import type { SemanticSource } from '../datasets/semantic.ts'
import type { Params, SqlDialect } from '../dw/sql.ts'
import { AppError } from '../http/errors.ts'
import { datasetOrgProfile, datasetOrgStatus, type DatasetOrgProfile, type DatasetOrgStatus, type OrgDim, type ValidationStatus, type ValueForm } from './datasetOrg.ts'
import { grantsCoverRecord, LEVEL_LABEL, NOTIFY_LEVELS, type Grant, type OrgSnapshot, type Problem } from './scope.ts'

export type AccessScope =
  | { kind: 'unrestricted'; fingerprint: 'unrestricted' }
  | { kind: 'none'; reason: 'NO_ASSIGNMENT' | 'ALL_INVALID'; problems: Problem[]; fingerprint: 'none' }
  | { kind: 'scoped'; grants: Grant[]; problems: Problem[]; snapshot: OrgSnapshot; fingerprint: string }

export type RowScope =
  | { kind: 'all'; fingerprint: 'all' }
  | { kind: 'rows'; fingerprint: string; profile: DatasetOrgProfile; grants: Grant[]; snapshot: OrgSnapshot; status: 'OK' | 'PARTIAL' }

export const NOT_STANDARD_MESSAGE = 'Tabel belum standar dan tidak memiliki parameter default untuk pembatasan akses data.'
const NO_DATA_FOR_SCOPE = 'Data tidak tersedia untuk cakupan akses Anda.'

export const fingerprintOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32)

export function scopeUnresolved(scope: Extract<AccessScope, { kind: 'none' }>): AppError {
  const e = new AppError(403, 'SCOPE_UNRESOLVED', 'Cakupan akses data Anda belum ditentukan atau tidak valid. Hubungi pengelola akses data.')
  e.details = { reason: scope.reason, problems: scope.problems.map((p) => ({ code: p.code, message: p.message })) }
  return e
}

export function notStandard(notify: boolean, status: DatasetOrgStatus | 'NO_APPLICABLE_GRANT', reason: string): AppError {
  // Levels 5/8/9 only: no default-parameter wording (requirement §4), but still no data.
  const e = new AppError(409, 'DATASET_NOT_STANDARD', notify ? NOT_STANDARD_MESSAGE : NO_DATA_FOR_SCOPE)
  e.details = { notify, status, reason }
  return e
}

/**
 * The dataset lacks a column the user's access level is defined by (Unit Operasional, Kepemilikan, Rayon, Divisi):
 * the rows cannot be narrowed to that level, so the user has no authority to see them. Always notified (owner's
 * decision 2026-11-12), for every level.
 */
export function fieldMissing(fields: string[]): AppError {
  const list = [...new Set(fields)].join(', ')
  const e = new AppError(403, 'ACCESS_FIELD_MISSING', `Data tidak dapat dilihat karena field ${list} pada dataset ini tidak lengkap, sehingga Anda tidak memiliki otoritas untuk melihat data ini.`)
  e.details = { notify: true, missing: [...new Set(fields)] }
  return e
}

const usable = (dim: OrgDim | 'ambiguous' | null): dim is OrgDim => !!dim && dim !== 'ambiguous'

/** Decides what of a dataset a scope may see. Throws instead of returning an unrestricted scope by mistake. */
export function forDataset(scope: AccessScope, d: DatasetRecord, validation: { status: ValidationStatus; datasetUpdatedAt: string } | null): RowScope {
  if (scope.kind === 'unrestricted') return { kind: 'all', fingerprint: 'all' }
  if (scope.kind === 'none') throw scopeUnresolved(scope)
  const notify = scope.grants.some((g) => NOTIFY_LEVELS.has(g.level))
  const profile = datasetOrgProfile(d.semantic)
  const status = datasetOrgStatus(profile, validation, d.updatedAt)
  // Every level is defined through the Unit Operasional: without that column nothing can be narrowed.
  if (profile.standardProblem?.missingField) throw fieldMissing(['Unit Operasional'])
  if (status !== 'OK' && status !== 'PARTIAL') {
    const reason = profile.standardProblem?.message ?? (status === 'UNVERIFIED' ? 'Nilai Unit Operasional dataset belum divalidasi terhadap master PIMS.' : 'Nilai Unit Operasional dataset tidak cocok dengan master PIMS.')
    throw notStandard(notify, status, reason)
  }
  // A grant whose own column (Kepemilikan / Rayon / Divisi) the dataset lacks gives nothing here: never the whole BU
  // instead. The user's other grants still apply.
  const missing: string[] = []
  const applicable = scope.grants.filter((g) => {
    if (g.ownership && !usable(profile.ownership)) return missing.push(LEVEL_LABEL.OWNERSHIP), false
    if (g.rayon && !usable(profile.rayon)) return missing.push(LEVEL_LABEL.RAYON), false
    if (g.division && !usable(profile.division)) return missing.push(LEVEL_LABEL.DIVISION), false
    return true
  })
  if (!applicable.length) throw fieldMissing(missing)
  return { kind: 'rows', fingerprint: fingerprintOf({ g: applicable.map(grantKey), d: d.id, u: d.updatedAt }), profile, grants: applicable, snapshot: scope.snapshot, status }
}

const grantKey = (g: Grant) => [g.unitCodes, g.ownership, g.rayon?.id ?? null, g.division?.id ?? null]

/** Value of a rayon/division for the column's form. */
const subValue = (form: ValueForm | null, x: { code: string; name: string }) => (form === 'rayon_name' || form === 'division_name' ? x.name : x.code)

/** Expected master value of a consistency column for a BU code (K-09); null = the master has none. */
const byCode = new WeakMap<OrgSnapshot, Map<string, { companyId: string | null }>>()
function expected(form: ValueForm, buCode: string, s: OrgSnapshot): string | null {
  let index = byCode.get(s)
  if (!index) byCode.set(s, (index = new Map([...s.units.values()].map((u) => [u.code, u]))))
  const unit = index.get(buCode)
  const c = unit?.companyId ? s.companies.get(unit.companyId) : undefined
  if (!c) return null
  switch (form) {
    case 'group_code':
      return c.groupId ? (s.groups.get(c.groupId)?.code ?? null) : null
    case 'region_code':
      return c.regionId ? (s.regions.get(c.regionId)?.code ?? null) : null
    case 'company_alias':
      return c.alias
    case 'company_oracle':
      return c.oracle
    default:
      return null
  }
}

/**
 * Row condition for one source of the dataset, applied where the rows are read (before any aggregation,
 * grouping set, snapshot, period window or FULL JOIN). `expr(dim)` is the source's text expression of a
 * dimension (null when the dimension is not mapped in that source). Returns null only for scope 'all'.
 */
export function rowPredicate(rs: RowScope, s: SemanticSource, expr: (dim: string) => string | null, p: Params, D: SqlDialect): string | null {
  if (rs.kind === 'all') return null
  const bu = expr(rs.profile.businessUnit!.dim)
  // forDataset already requires the BU in every source; a source without it gets nothing (fail-closed).
  if (!bu || !rs.profile.businessUnit!.forms[s.alias]) return 'FALSE'
  const inList = (e: string, values: string[]) => (values.length ? D.inList(e, p.add(values, 'text[]')) : 'FALSE')
  const sub = (dim: OrgDim | 'ambiguous' | null) => (dim && dim !== 'ambiguous' && dim.forms[s.alias] ? { e: expr(dim.dim), form: dim.forms[s.alias]! } : null)
  const ray = sub(rs.profile.rayon)
  const div = sub(rs.profile.division)
  const own = sub(rs.profile.ownership)

  // Parameters are added only for conditions that end up in the SQL (placeholders and values stay in step).
  // Grants without an extra condition (whole BUs) are one list: (BU ∈ A) OR (BU ∈ B) ≡ BU ∈ A ∪ B. Grants with an
  // extra condition keep their own pair (BU AND ownership / rayon / division), never mixed with another grant.
  const whole = new Set<string>()
  const pairs: string[] = []
  for (const g of rs.grants) {
    if (g.ownership) pairs.push(own?.e ? `(${inList(bu, g.unitCodes)} AND ${inList(own.e, g.ownership)})` : 'FALSE')
    // Rayon / Divisi: only through the field. A source without it gives none of this grant's rows (never the whole BU).
    else if (g.rayon) pairs.push(ray?.e ? `(${inList(bu, g.unitCodes)} AND ${inList(ray.e, [subValue(ray.form, g.rayon)])})` : 'FALSE')
    else if (g.division) pairs.push(div?.e ? `(${inList(bu, g.unitCodes)} AND ${inList(div.e, [subValue(div.form, g.division)])})` : 'FALSE')
    else for (const c of g.unitCodes) whole.add(c)
  }
  const clauses = [...(whole.size ? [inList(bu, [...whole])] : []), ...pairs]
  const parts = [`(${clauses.length ? clauses.join(' OR ') : 'FALSE'})`]

  // K-09: Group / Region / Company columns, when present and mappable, must agree with the BU's master values.
  // One lookup of the pair (BU, value) per row — `BU <sep> value` in the list of allowed pairs — instead of one branch
  // per master value: the same rows, but a single (hashed) list test however many groups / companies are in scope.
  const sep = '\u0001' // = D.sentinel (chr(1) / char(1)); never part of a BU code or an organization value
  const inScope = [...new Set(rs.grants.flatMap((g) => g.unitCodes))]
  for (const dim of [rs.profile.group, rs.profile.region, rs.profile.company]) {
    const form = dim?.forms[s.alias]
    const e = dim && form ? expr(dim.dim) : null
    if (!e || !form) continue
    const allowed: string[] = []
    for (const code of inScope) {
      const v = expected(form, code, rs.snapshot)
      if (v) allowed.push(`${code}${sep}${v}`)
    }
    // A NULL value cannot be mapped and is not checked; any other value must be the master's for that BU.
    parts.push(`(${e} IS NULL${allowed.length ? ` OR ${inList(`${bu} || ${D.sentinel} || ${e}`, allowed)}` : ''})`)
  }
  return parts.join(' AND ')
}

/* ---------------- Data Profil (blocks, vehicles of the master; PIMS ids) ---------------- */

export interface ProfileRecord {
  kind: 'block' | 'vehicle'
  unitId: string | null
  /** undefined: the record kind has no such field (vehicles) → parent BU only. */
  rayonId?: string | null
  divisionId?: string | null
  ownership?: string | null
}

export function coversRecord(scope: AccessScope, r: ProfileRecord): boolean {
  if (scope.kind === 'unrestricted') return true
  if (scope.kind === 'none') return false
  return grantsCoverRecord(scope.grants, r)
}

/** Restriction for the Data Profil lists: null = no restriction (unrestricted only). */
export interface ProfileFilter {
  fullUnitIds: string[]
  rayonPairs: { unitId: string; rayonId: string }[]
  divisionPairs: { unitId: string; divisionId: string }[]
  ownershipPairs: { unitId: string; ownership: string }[]
}

export function profileFilter(scope: AccessScope): ProfileFilter | null {
  if (scope.kind === 'unrestricted') return null
  if (scope.kind === 'none') throw scopeUnresolved(scope)
  const f: ProfileFilter = { fullUnitIds: [], rayonPairs: [], divisionPairs: [], ownershipPairs: [] }
  for (const g of scope.grants) {
    if (g.ownership) for (const u of g.unitIds) for (const o of g.ownership) f.ownershipPairs.push({ unitId: u, ownership: o })
    else if (g.rayon) for (const u of g.unitIds) f.rayonPairs.push({ unitId: u, rayonId: g.rayon.id })
    else if (g.division) for (const u of g.unitIds) f.divisionPairs.push({ unitId: u, divisionId: g.division.id })
    else f.fullUnitIds.push(...g.unitIds)
  }
  f.fullUnitIds = [...new Set(f.fullUnitIds)]
  return f
}

/** SQL condition on a block row (`k` = ms_block, `ow` = its ms_blockownership) for a filter; params appended to `params`. */
export function blockCondition(f: ProfileFilter | null, params: unknown[], k = 'k', ow = 'ow'): string {
  if (!f) return 'TRUE'
  const ph = (v: unknown) => `$${params.push(v)}`
  const unnest2 = (a: string[], b: string[], cond: string) => `EXISTS (SELECT 1 FROM unnest(${ph(a)}::text[], ${ph(b)}::text[]) AS p(a, b) WHERE ${cond})`
  return `(${[
    `${k}.businessunit_id::text = ANY(${ph(f.fullUnitIds)}::text[])`,
    unnest2(f.rayonPairs.map((x) => x.unitId), f.rayonPairs.map((x) => x.rayonId), `p.a = ${k}.businessunit_id::text AND p.b = ${k}.rayon_id::text`),
    unnest2(f.divisionPairs.map((x) => x.unitId), f.divisionPairs.map((x) => x.divisionId), `p.a = ${k}.businessunit_id::text AND p.b = ${k}.division_id::text`),
    unnest2(f.ownershipPairs.map((x) => x.unitId), f.ownershipPairs.map((x) => x.ownership), `p.a = ${k}.businessunit_id::text AND p.b = upper(trim(${ow}.name))`),
  ].join(' OR ')})`
}

/** Vehicles have no rayon, division or block ownership: full units and the parent BU of rayon/division grants. */
export function vehicleCondition(f: ProfileFilter | null, params: unknown[], v = 'v'): string {
  if (!f) return 'TRUE'
  const ids = [...new Set([...f.fullUnitIds, ...f.rayonPairs.map((x) => x.unitId), ...f.divisionPairs.map((x) => x.unitId)])]
  return `${v}.businessunit_id::text = ANY($${params.push(ids)}::text[])`
}
