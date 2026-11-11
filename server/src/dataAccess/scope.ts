/**
 * Data access scope: the nine access levels, a user's assignments, and how an assignment resolves to the
 * Business Units (Unit Operasional) it grants, against a snapshot of the PIMS organization reference.
 * Pure: no database, no clock (tested directly in test/dataAccessScope.test.ts).
 *
 * Rules (docs/DATA_ACCESS.md):
 * - An assignment points at PIMS ids (org_kind + org_id), never at a code or a name.
 * - Every assignment is one independent grant. Several assignments are a union of grants; their parts are
 *   never mixed (FRG+PLASMA and SAM+INTI never become FRG+INTI) (K-01, K-11).
 * - Rayon / Divisi: the pair (BU id, rayon/division id); a master relation is never proof of access (K-07).
 * - Only active rows (is_active AND NOT is_deleted, within valid_from/valid_to) count; an assignment whose
 *   organization is missing or inactive grants nothing (fail-closed).
 */

export const LEVELS = ['OWNERSHIP', 'GROUP', 'WILAYAH', 'REGION', 'GMK', 'COMPANY', 'BUSINESS_UNIT', 'RAYON', 'DIVISION'] as const
export type Level = (typeof LEVELS)[number]
/** Levels whose organization part is an organization node (OWNERSHIP picks one of these as its scope). */
export const ORG_LEVELS = ['GROUP', 'WILAYAH', 'REGION', 'GMK', 'COMPANY', 'BUSINESS_UNIT'] as const
export type OrgLevel = (typeof ORG_LEVELS)[number]
export const ORG_KINDS = ['ms_group', 'ms_so_node', 'ms_region', 'ms_gmk_header', 'ms_company', 'ms_businessunit'] as const
export type OrgKind = (typeof ORG_KINDS)[number]

export const LEVEL_LABEL: Record<Level, string> = {
  OWNERSHIP: 'Kepemilikan',
  GROUP: 'Group',
  WILAYAH: 'Wilayah Administrasi',
  REGION: 'Region',
  GMK: 'GMK',
  COMPANY: 'Perusahaan',
  BUSINESS_UNIT: 'Unit Operasional',
  RAYON: 'Rayon',
  DIVISION: 'Divisi',
}
/** Levels whose missing default parameter is reported to the user ("Tabel belum standar …"); 5, 8, 9 are not. */
export const NOTIFY_LEVELS: ReadonlySet<Level> = new Set(['OWNERSHIP', 'GROUP', 'WILAYAH', 'REGION', 'COMPANY', 'BUSINESS_UNIT'])

/* ---------------- Organization snapshot (read-only copy in memory, never persisted) ---------------- */

export interface OrgSnapshot {
  loadedAt: number
  groups: Map<string, { id: string; code: string; name: string }>
  regions: Map<string, { id: string; code: string; name: string; groupId: string | null }>
  companies: Map<string, { id: string; code: string; name: string; alias: string | null; oracle: string | null; groupId: string | null; regionId: string | null }>
  units: Map<string, { id: string; code: string; name: string; companyId: string | null }>
  /** GMK header → BU ids (active details whose BU is active). */
  gmks: Map<string, { id: string; name: string; groupId: string | null; unitIds: Set<string> }>
  rayons: Map<string, { id: string; code: string; name: string }>
  divisions: Map<string, { id: string; code: string; name: string }>
  /** `${buId}|${divisionId}` of active ms_businessunitdivision rows (a hint for the form, never proof of access). */
  unitDivisions: Set<string>
  structures: Map<string, { id: string; code: string; name: string; level: number | null }>
  /** SO nodes with their own BU ids (ms_so_node_businessunit). */
  nodes: Map<string, { id: string; structureId: string | null; parentId: string | null; code: string; name: string; isVirtual: boolean; unitIds: Set<string> }>
  /** Ownership categories by upper-case name (INTI, PLASMA, KKPA). */
  ownerships: Map<string, { id: string; name: string }>
}

export interface ScopeRules {
  regionSource: 'ms_region' | 'so_region' | null
  wilayahNodeIds: ReadonlySet<string>
  gmkHeaderIds: ReadonlySet<string>
}

/* ---------------- Assignments ---------------- */

export interface Assignment {
  id: string
  level: Level
  /** Level of the organization part: = level, BUSINESS_UNIT for RAYON/DIVISION, chosen for OWNERSHIP. */
  orgLevel: OrgLevel
  orgKind: OrgKind
  orgId: string
  subKind: 'ms_rayon' | 'ms_division' | null
  subId: string | null
  ownership: string[] | null
  label: string
  active: boolean
}

export interface Problem {
  assignmentId: string | null
  code: string
  message: string
}

/** One independent grant. All parts must hold together (AND); grants are combined with OR. */
export interface Grant {
  assignmentId: string
  level: Level
  /** PIMS ids and codes of the granted Business Units. */
  unitIds: string[]
  unitCodes: string[]
  /** Level 1: the row's ownership must be one of these (upper case). */
  ownership: string[] | null
  /** Level 8: the rayon inside the single parent BU. */
  rayon: { id: string; code: string; name: string } | null
  /** Level 9: the division inside the single parent BU. */
  division: { id: string; code: string; name: string } | null
}

const isId = (v: string | null | undefined): v is string => !!v && /^\d{1,20}$/.test(v)

/** The organization kinds each organization level accepts (Region follows the approved source, K-04). */
export function kindsFor(level: OrgLevel, rules: ScopeRules): OrgKind[] {
  switch (level) {
    case 'GROUP':
      return ['ms_group']
    case 'WILAYAH':
      return ['ms_so_node']
    case 'REGION':
      return rules.regionSource === 'ms_region' ? ['ms_region'] : rules.regionSource === 'so_region' ? ['ms_so_node'] : []
    case 'GMK':
      return ['ms_gmk_header']
    case 'COMPANY':
      return ['ms_company']
    case 'BUSINESS_UNIT':
      return ['ms_businessunit']
  }
}

/** BU ids of an organization node, or a problem. Never guesses: unknown, inactive or unapproved = no BU. */
export function unitsOf(level: OrgLevel, kind: OrgKind, id: string, s: OrgSnapshot, rules: ScopeRules): { ids: Set<string> } | { problem: string; message: string } {
  if (!isId(id)) return { problem: 'INVALID_ORG_ID', message: 'Id organisasi tidak valid.' }
  if (!(ORG_LEVELS as readonly string[]).includes(level)) return { problem: 'ASSIGNMENT_INVALID', message: 'Level organisasi assignment tidak valid.' }
  if (!kindsFor(level, rules).includes(kind)) {
    if (level === 'REGION' && !rules.regionSource) return { problem: 'LEVEL_NOT_CONFIGURED', message: 'Sumber level Region belum ditetapkan di server (DOD_ORG_REGION_SOURCE).' }
    return { problem: 'ORG_KIND_MISMATCH', message: `Jenis organisasi ${kind} tidak sesuai level ${LEVEL_LABEL[level]}.` }
  }
  const unitsWhere = (pred: (u: { companyId: string | null }) => boolean) => new Set([...s.units.values()].filter(pred).map((u) => u.id))
  const companiesWhere = (pred: (c: { groupId: string | null; regionId: string | null }) => boolean) => new Set([...s.companies.values()].filter(pred).map((c) => c.id))
  switch (kind) {
    case 'ms_group': {
      if (!s.groups.has(id)) return { problem: 'ORG_NOT_FOUND', message: 'Group tidak ditemukan atau tidak aktif di master PIMS.' }
      // K-02: Group → company.group_id → BU (only active companies and units).
      const cs = companiesWhere((c) => c.groupId === id)
      return { ids: unitsWhere((u) => !!u.companyId && cs.has(u.companyId)) }
    }
    case 'ms_region': {
      if (!s.regions.has(id)) return { problem: 'ORG_NOT_FOUND', message: 'Region tidak ditemukan atau tidak aktif di master PIMS.' }
      const cs = companiesWhere((c) => c.regionId === id)
      return { ids: unitsWhere((u) => !!u.companyId && cs.has(u.companyId)) }
    }
    case 'ms_so_node': {
      const n = s.nodes.get(id)
      if (!n) return { problem: 'ORG_NOT_FOUND', message: 'Node struktur organisasi tidak ditemukan atau tidak aktif di master PIMS.' }
      if (level === 'WILAYAH' && !rules.wilayahNodeIds.has(id)) return { problem: 'ORG_NOT_APPROVED', message: 'Node ini tidak ada di daftar wilayah Direktur yang disetujui (DOD_ORG_WILAYAH_NODE_IDS).' }
      if (level === 'REGION' && s.structures.get(n.structureId ?? '')?.code !== 'REGION') return { problem: 'ORG_KIND_MISMATCH', message: 'Node ini bukan node struktur REGION.' }
      return { ids: new Set([...n.unitIds].filter((u) => s.units.has(u))) }
    }
    case 'ms_gmk_header': {
      const g = s.gmks.get(id)
      if (!g) return { problem: 'ORG_NOT_FOUND', message: 'GMK tidak ditemukan atau tidak aktif di master PIMS.' }
      if (!rules.gmkHeaderIds.has(id)) return { problem: 'ORG_NOT_APPROVED', message: 'GMK ini tidak ada di daftar GMK yang disetujui (DOD_ORG_GMK_HEADER_IDS).' }
      return { ids: new Set([...g.unitIds].filter((u) => s.units.has(u))) }
    }
    case 'ms_company': {
      if (!s.companies.has(id)) return { problem: 'ORG_NOT_FOUND', message: 'Perusahaan tidak ditemukan atau tidak aktif di master PIMS.' }
      // K-06: every active BU of the company (company_id).
      return { ids: unitsWhere((u) => u.companyId === id) }
    }
    case 'ms_businessunit':
      if (!s.units.has(id)) return { problem: 'ORG_NOT_FOUND', message: 'Unit Operasional tidak ditemukan atau tidak aktif di master PIMS.' }
      return { ids: new Set([id]) }
  }
}

/** Resolves one assignment into a grant, or a problem (the assignment then grants nothing). */
export function resolveAssignment(a: Assignment, s: OrgSnapshot, rules: ScopeRules): { grant: Grant } | { problem: Problem } {
  const fail = (code: string, message: string) => ({ problem: { assignmentId: a.id, code, message } })
  if (!a.active) return fail('ASSIGNMENT_INACTIVE', 'Assignment tidak aktif.')
  const expectedOrgLevel: OrgLevel | null = a.level === 'RAYON' || a.level === 'DIVISION' ? 'BUSINESS_UNIT' : a.level === 'OWNERSHIP' ? null : a.level
  if (expectedOrgLevel && a.orgLevel !== expectedOrgLevel) return fail('ASSIGNMENT_INVALID', 'Level organisasi assignment tidak sesuai.')
  const u = unitsOf(a.orgLevel, a.orgKind, a.orgId, s, rules)
  if ('problem' in u) return fail(u.problem, u.message)
  const unitIds = [...u.ids].sort()
  const grant: Grant = { assignmentId: a.id, level: a.level, unitIds, unitCodes: unitIds.map((x) => s.units.get(x)!.code).sort(), ownership: null, rayon: null, division: null }

  if (a.level === 'OWNERSHIP') {
    const own = [...new Set((a.ownership ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean))]
    if (!own.length) return fail('ASSIGNMENT_INVALID', 'Kepemilikan wajib memiliki minimal satu kategori.')
    const unknown = own.filter((x) => !s.ownerships.has(x))
    if (unknown.length) return fail('OWNERSHIP_NOT_FOUND', `Kategori kepemilikan tidak ada di master PIMS: ${unknown.join(', ')}.`)
    grant.ownership = own.sort()
  } else if (a.ownership?.length) return fail('ASSIGNMENT_INVALID', 'Kategori kepemilikan hanya untuk level Kepemilikan.')

  if (a.level === 'RAYON' || a.level === 'DIVISION') {
    const want = a.level === 'RAYON' ? 'ms_rayon' : 'ms_division'
    if (a.subKind !== want || !isId(a.subId)) return fail('ASSIGNMENT_INVALID', `${LEVEL_LABEL[a.level]} wajib berupa pasangan id BU induk dan id ${LEVEL_LABEL[a.level]}.`)
    const sub = (a.level === 'RAYON' ? s.rayons : s.divisions).get(a.subId)
    if (!sub) return fail('ORG_NOT_FOUND', `${LEVEL_LABEL[a.level]} tidak ditemukan atau tidak aktif di master PIMS.`)
    if (a.level === 'RAYON') grant.rayon = { ...sub }
    else grant.division = { ...sub }
  } else if (a.subKind || a.subId) return fail('ASSIGNMENT_INVALID', 'Pasangan rayon/divisi hanya untuk level Rayon atau Divisi.')

  return { grant }
}

export function resolveAssignments(list: Assignment[], s: OrgSnapshot, rules: ScopeRules): { grants: Grant[]; problems: Problem[] } {
  const grants: Grant[] = []
  const problems: Problem[] = []
  for (const a of list) {
    const r = resolveAssignment(a, s, rules)
    if ('grant' in r) grants.push(r.grant)
    else problems.push(r.problem)
  }
  return { grants, problems }
}

/** Does any grant cover this record of the master (Data Profil)? Ownership grants need the record's ownership. */
export function grantsCoverRecord(grants: Grant[], r: { unitId: string | null; rayonId?: string | null; divisionId?: string | null; ownership?: string | null; kind: 'block' | 'vehicle' }): boolean {
  if (!r.unitId) return false
  return grants.some((g) => {
    if (!g.unitIds.includes(r.unitId!)) return false
    if (g.ownership) return r.kind === 'block' && !!r.ownership && g.ownership.includes(r.ownership.trim().toUpperCase())
    // Field present → filter by it; absent (vehicles have no rayon/division) → the parent BU only.
    if (g.rayon) return r.kind === 'vehicle' || r.rayonId === undefined ? true : r.rayonId === g.rayon.id
    if (g.division) return r.kind === 'vehicle' || r.divisionId === undefined ? true : r.divisionId === g.division.id
    return true
  })
}
