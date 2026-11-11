/**
 * Settings → Pengguna: labels, the identity form rules, and the nine data access levels with the shape of their
 * assignment (the same rules the server enforces in server/src/dataAccess/scope.ts).
 */
import type { AssignmentInput, Level, ManagedUser, OrgKind, OrgLevel, Role, UserInput } from '@/types/users'
import { tr } from '@/i18n'

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'admin', label: tr('Admin'), hint: tr('Mengelola aplikasi: menu, pengguna, dataset. Tidak memberi akses data.') },
  { value: 'analyst', label: tr('Analyst'), hint: tr('Analisis, dataset, report, template') },
  { value: 'publisher', label: tr('Publisher'), hint: tr('Hak membaca seperti Viewer (menu Publish sudah dihapus)') },
  { value: 'viewer', label: tr('Viewer'), hint: tr('Melihat laporan dan analisis') },
]
export const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<Role, string>

/** The nine levels in the required order, with what an assignment of the level needs. */
export const LEVELS: { level: Level; label: string; hint: string; orgLevel: OrgLevel | null; sub: 'RAYON' | 'DIVISION' | null }[] = [
  { level: 'OWNERSHIP', label: tr('Kepemilikan'), hint: tr('Cakupan organisasi DAN kategori kepemilikan (INTI/PLASMA/KKPA)'), orgLevel: null, sub: null },
  { level: 'GROUP', label: tr('Group'), hint: tr('Seluruh Unit Operasional dalam Group'), orgLevel: 'GROUP', sub: null },
  { level: 'WILAYAH', label: tr('Wilayah Administrasi'), hint: tr('Seluruh Unit Operasional dalam wilayah Direktur'), orgLevel: 'WILAYAH', sub: null },
  { level: 'REGION', label: tr('Region'), hint: tr('Seluruh Unit Operasional dalam Region'), orgLevel: 'REGION', sub: null },
  { level: 'GMK', label: tr('GMK'), hint: tr('Seluruh Unit Operasional dalam GMK'), orgLevel: 'GMK', sub: null },
  { level: 'COMPANY', label: tr('Perusahaan'), hint: tr('Seluruh Unit Operasional dalam Perusahaan'), orgLevel: 'COMPANY', sub: null },
  { level: 'BUSINESS_UNIT', label: tr('Unit Operasional'), hint: tr('Hanya Unit Operasional yang ditetapkan'), orgLevel: 'BUSINESS_UNIT', sub: null },
  { level: 'RAYON', label: tr('Rayon'), hint: tr('Hanya Rayon yang ditetapkan, di dalam Unit Operasional induknya'), orgLevel: 'BUSINESS_UNIT', sub: 'RAYON' },
  { level: 'DIVISION', label: tr('Divisi'), hint: tr('Hanya Divisi yang ditetapkan, di dalam Unit Operasional induknya'), orgLevel: 'BUSINESS_UNIT', sub: 'DIVISION' },
]
export const LEVEL_LABEL: Record<Level, string> = Object.fromEntries(LEVELS.map((l) => [l.level, l.label])) as Record<Level, string>
export const ORG_LEVEL_LABEL: Record<OrgLevel, string> = { GROUP: tr('Group'), WILAYAH: tr('Wilayah Administrasi'), REGION: tr('Region'), GMK: tr('GMK'), COMPANY: tr('Perusahaan'), BUSINESS_UNIT: tr('Unit Operasional') }
/** Organization levels a Kepemilikan assignment may be scoped to. */
export const OWNERSHIP_ORG_LEVELS: OrgLevel[] = ['GROUP', 'WILAYAH', 'REGION', 'GMK', 'COMPANY', 'BUSINESS_UNIT']

/** PIMS table of the organization id of a level (Region follows the server's approved source). */
export function orgKindOf(level: OrgLevel, regionSource: 'ms_region' | 'so_region' | null): OrgKind | null {
  switch (level) {
    case 'GROUP':
      return 'ms_group'
    case 'WILAYAH':
      return 'ms_so_node'
    case 'REGION':
      return regionSource === 'ms_region' ? 'ms_region' : regionSource === 'so_region' ? 'ms_so_node' : null
    case 'GMK':
      return 'ms_gmk_header'
    case 'COMPANY':
      return 'ms_company'
    case 'BUSINESS_UNIT':
      return 'ms_businessunit'
  }
}

/** An assignment draft of the form → the request body, or the missing part. */
export function toInput(d: { level: Level | ''; orgLevel: OrgLevel | ''; orgId: string; subId: string; ownership: string[] }, regionSource: 'ms_region' | 'so_region' | null): AssignmentInput | string {
  const def = LEVELS.find((l) => l.level === d.level)
  if (!def) return tr('Pilih level akses.')
  const orgLevel = def.level === 'OWNERSHIP' ? d.orgLevel || null : def.orgLevel
  if (!orgLevel) return tr('Pilih level cakupan organisasi untuk Kepemilikan.')
  const orgKind = orgKindOf(orgLevel, regionSource)
  if (!orgKind) return tr('Sumber Region belum ditetapkan di server.')
  if (!d.orgId) return tr('Pilih organisasi.')
  if (def.sub && !d.subId) return def.sub === 'RAYON' ? tr('Pilih Rayon.') : tr('Pilih Divisi.')
  if (def.level === 'OWNERSHIP' && !d.ownership.length) return tr('Pilih minimal satu kategori kepemilikan.')
  return {
    level: def.level,
    ...(def.level === 'OWNERSHIP' ? { orgLevel } : {}),
    orgKind,
    orgId: d.orgId,
    subKind: def.sub === 'RAYON' ? 'ms_rayon' : def.sub === 'DIVISION' ? 'ms_division' : null,
    subId: def.sub ? d.subId : null,
    ownership: def.level === 'OWNERSHIP' ? d.ownership : null,
  }
}

export const fromUser = (u: ManagedUser): UserInput => ({ username: u.username, name: u.name, role: u.role, identityIssuer: u.identityIssuer, externalSubject: u.externalSubject, active: u.active })

export const NEW_USER: UserInput = { username: '', name: '', role: 'viewer', identityIssuer: null, externalSubject: null, active: true, password: '' }

/** Fields still missing before the form can be saved (the server validates everything again). */
export function missing(v: UserInput, isNew: boolean): string[] {
  return [
    v.name.trim().length < 2 && tr('nama lengkap'),
    !v.username.trim() && tr('username'),
    isNew && (v.password ?? '').length < 8 && tr('password awal (min. 8 karakter)'),
    !!v.identityIssuer?.trim() !== !!v.externalSubject?.trim() && tr('pasangan identitas SSO'),
  ].filter(Boolean) as string[]
}

/** Short description of a user's data access for the list. */
export function accessSummary(u: ManagedUser): string {
  return u.assignments ? tr('{0} assignment', u.assignments) : tr('Tanpa akses data')
}
