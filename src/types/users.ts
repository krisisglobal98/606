/** User management and data access assignments (server: server/src/users, server/src/dataAccess). */
import type { User } from '@/types/contracts'

export type Role = User['role']

/** Identity and application role only; data access is a separate list of assignments. */
export interface ManagedUser {
  id: string
  username: string
  name: string
  role: Role
  identityIssuer: string | null
  externalSubject: string | null
  active: boolean
  /** Number of active data access assignments. */
  assignments: number
  createdAt: string
  updatedAt: string
  updatedBy: { id: string; name: string } | null
}

/** Body of POST /users and PUT /users/:id. */
export interface UserInput {
  username: string
  name: string
  role: Role
  identityIssuer: string | null
  externalSubject: string | null
  active: boolean
  /** Required on create; on edit only to reset it. */
  password?: string
}

export interface FieldProblem {
  field: string
  message: string
}

/* ---------------- Data access ---------------- */

/** The nine access levels, in the required order. */
export type Level = 'OWNERSHIP' | 'GROUP' | 'WILAYAH' | 'REGION' | 'GMK' | 'COMPANY' | 'BUSINESS_UNIT' | 'RAYON' | 'DIVISION'
export type OrgLevel = 'GROUP' | 'WILAYAH' | 'REGION' | 'GMK' | 'COMPANY' | 'BUSINESS_UNIT'
export type OrgKind = 'ms_group' | 'ms_so_node' | 'ms_region' | 'ms_gmk_header' | 'ms_company' | 'ms_businessunit'

export interface AssignmentInput {
  level: Level
  orgLevel?: OrgLevel
  orgKind: OrgKind
  /** PIMS id (never a code or a name). */
  orgId: string
  subKind: 'ms_rayon' | 'ms_division' | null
  subId: string | null
  ownership: string[] | null
}

export interface Assignment extends Required<Omit<AssignmentInput, 'orgLevel'>> {
  id: string
  orgLevel: OrgLevel
  label: string
  active: boolean
  /** null = the organization master is unreachable, validity unknown. */
  valid: boolean | null
  problem: string | null
  warning: string | null
  unitCount: number | null
  createdAt: string
  createdBy: string | null
}

export interface UserAccess {
  assignments: Assignment[]
  unrestricted: boolean
  masterAvailable: boolean
  canEdit: boolean
}

export interface OrgOptionItem {
  id: string
  code: string
  name: string
  orgKind?: OrgKind | 'ms_rayon' | 'ms_division'
  units?: number
  group?: string | null
  company?: string | null
  alias?: string | null
  relatedToUnit?: boolean | null
}

export interface OrgStatus {
  configured: boolean
  available: boolean
  error: string | null
  loadedAt: string | null
  cacheSeconds: number
  /** Levels that can be assigned with the server's configuration (Region/Wilayah/GMK need approved sources). */
  levels: Record<Level, boolean>
  regionSource: 'ms_region' | 'so_region' | null
}
