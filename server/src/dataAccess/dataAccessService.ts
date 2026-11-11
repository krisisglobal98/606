/**
 * Data access service: a user's scope, the assignments that define it, the organization options to assign
 * from, and the audit trail. docs/DATA_ACCESS.md.
 *
 * - Assignments are read from dor_user_access on every request: a change applies to the next request, in every
 *   API process, without a cache to invalidate.
 * - The organization snapshot has a fixed lifetime (SnapshotCache); expired + unreachable master = 503. In its
 *   last minute a request starts a background refresh, so active users do not wait at expiry.
 * - unrestricted_data and access managers come from the server environment (DOD_DATA_UNRESTRICTED_USERS,
 *   DOD_DATA_ACCESS_MANAGERS), not from the application role and not from the UI. Changes of the unrestricted list
 *   are audited at start (grant / revoke); its use is audited (at most once per user per hour).
 * - Nobody changes their own assignments; only an access manager changes other users' assignments.
 */
import type pg from 'pg'
import { z } from 'zod'
import type { User } from '../auth/authService.ts'
import type { Config } from '../config/config.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import type { DatasetRecord } from '../datasets/datasetService.ts'
import { rollback } from '../db/connection.ts'
import { AppError, forbidden, notFound } from '../http/errors.ts'
import type { Logger } from '../log/logger.ts'
import type { ValidationResult, ValidationStatus } from './datasetOrg.ts'
import { fingerprintOf, forDataset, type AccessScope, type RowScope } from './guard.ts'
import { SnapshotCache, type SnapshotLoader } from './orgMaster.ts'
import { LEVEL_LABEL, LEVELS, ORG_KINDS, ORG_LEVELS, kindsFor, resolveAssignment, resolveAssignments, type Assignment, type Grant, type OrgLevel, type OrgSnapshot, type ScopeRules } from './scope.ts'

const PimsId = z.string().regex(/^\d{1,20}$/, 'id PIMS berupa angka')

export const AssignmentInputSchema = z
  .object({
    level: z.enum(LEVELS),
    /** Organization part of a Kepemilikan assignment; derived for the other levels. */
    orgLevel: z.enum(ORG_LEVELS).optional(),
    orgKind: z.enum(ORG_KINDS),
    orgId: PimsId,
    subKind: z.enum(['ms_rayon', 'ms_division']).nullable().default(null),
    subId: PimsId.nullable().default(null),
    ownership: z.array(z.string().trim().min(1).max(40)).max(10).nullable().default(null),
  })
  .strict()
export const PutAssignmentsSchema = z.object({ assignments: z.array(AssignmentInputSchema).max(50) }).strict()
export type AssignmentInput = z.infer<typeof AssignmentInputSchema>

export interface AssignmentView extends Assignment {
  valid: boolean | null
  problem: string | null
  warning: string | null
  unitCount: number | null
  createdAt: string
  createdBy: string | null
}

interface Row {
  id: string
  level: Assignment['level']
  org_level: OrgLevel
  org_kind: Assignment['orgKind']
  org_id: string
  sub_kind: Assignment['subKind']
  sub_id: string | null
  ownership: string[] | null
  label: string
  active: boolean
  created_at: Date
  created_by: string | null
}
const toAssignment = (r: Row): Assignment => ({ id: r.id, level: r.level, orgLevel: r.org_level, orgKind: r.org_kind, orgId: r.org_id, subKind: r.sub_kind, subId: r.sub_id, ownership: r.ownership, label: r.label, active: r.active })

const HOUR = 3_600_000
const DENIED_THROTTLE_MS = 10 * 60_000
const UNRESTRICTED_KEY = 'access.unrestricted_users'

export class DataAccessService {
  private readonly db: MetadataDb
  private readonly config: Config
  private readonly log: Logger
  readonly snapshots: SnapshotCache
  private readonly rules: ScopeRules
  private readonly now: () => number
  private readonly throttle = new Map<string, number>()

  constructor(db: MetadataDb, config: Config, log: Logger, load: SnapshotLoader, now: () => number = Date.now) {
    this.db = db
    this.config = config
    this.log = log
    this.now = now
    this.snapshots = new SnapshotCache(load, config.dataAccess.cacheMs, now, (e) =>
      log.warn({ code: (e as { code?: string }).code ?? null }, 'organization master: background refresh failed; the current snapshot is kept until it expires'))
    this.rules = { regionSource: config.dataAccess.regionSource, wilayahNodeIds: new Set(config.dataAccess.wilayahNodeIds), gmkHeaderIds: new Set(config.dataAccess.gmkHeaderIds) }
  }

  isUnrestricted(u: Pick<User, 'username'>) {
    return this.config.dataAccess.unrestrictedUsers.includes(u.username.toLowerCase())
  }
  isManager(u: Pick<User, 'username'>) {
    return this.config.dataAccess.managers.includes(u.username.toLowerCase())
  }

  async assignmentsOf(userId: string): Promise<Assignment[]> {
    const r = await this.db.query<Row>('SELECT * FROM dor_user_access WHERE user_id = $1 ORDER BY created_at, id', [userId])
    return r.rows.map(toAssignment)
  }

  /** The user's current scope. Master unavailable while it is needed → throws a 503 (never a wider scope). */
  async scopeFor(u: User): Promise<AccessScope> {
    if (this.isUnrestricted(u)) {
      this.auditOnce(u.id, `unrestricted|${u.id}`, HOUR, 'data.unrestricted.use', u.id, {})
      return { kind: 'unrestricted', fingerprint: 'unrestricted' }
    }
    const list = (await this.assignmentsOf(u.id)).filter((a) => a.active)
    if (!list.length) return { kind: 'none', reason: 'NO_ASSIGNMENT', problems: [], fingerprint: 'none' }
    const snapshot = await this.snapshots.get()
    const { grants, problems } = resolveAssignments(list, snapshot, this.rules)
    if (!grants.length) return { kind: 'none', reason: 'ALL_INVALID', problems, fingerprint: 'none' }
    return { kind: 'scoped', grants, problems, snapshot, fingerprint: fingerprintOf(grants.map((g) => [g.level, g.unitCodes, g.ownership, g.rayon?.id ?? null, g.division?.id ?? null])) }
  }

  /** Stored BU validation of a dataset (K-13). */
  async validationOf(datasetId: string): Promise<{ status: ValidationStatus; datasetUpdatedAt: string; checkedAt: string; detail: ValidationResult } | null> {
    const r = (await this.db.query<{ status: ValidationStatus; dataset_updated_at: Date; checked_at: Date; detail: ValidationResult }>('SELECT status, dataset_updated_at, checked_at, detail FROM dor_dataset_org_validation WHERE dataset_id = $1', [datasetId])).rows[0]
    return r ? { status: r.status, datasetUpdatedAt: r.dataset_updated_at.toISOString(), checkedAt: r.checked_at.toISOString(), detail: r.detail } : null
  }

  /** Scope + dataset → what the user may see of it. Denials are audited (throttled). */
  async rowScope(u: User, d: DatasetRecord): Promise<{ scope: AccessScope; rows: RowScope }> {
    try {
      const scope = await this.scopeFor(u)
      return { scope, rows: forDataset(scope, d, await this.validationOf(d.id)) }
    } catch (e) {
      if (e instanceof AppError) this.denied(u, e.code, d.id)
      throw e
    }
  }

  /** Records a refused data request (403/404/409/503 of the guard), at most once per user, reason and target per 10 min. */
  denied(u: User, code: string, target: string) {
    this.auditOnce(u.id, `denied|${u.id}|${code}|${target}`, DENIED_THROTTLE_MS, 'data.denied', target, { code })
  }

  async storeValidation(d: DatasetRecord, result: ValidationResult, userId: string) {
    await this.db.query(
      `INSERT INTO dor_dataset_org_validation (dataset_id, dataset_updated_at, status, checked_at, checked_by, detail) VALUES ($1, $2, $3, now(), $4, $5)
       ON CONFLICT (dataset_id) DO UPDATE SET dataset_updated_at = EXCLUDED.dataset_updated_at, status = EXCLUDED.status, checked_at = now(), checked_by = EXCLUDED.checked_by, detail = EXCLUDED.detail`,
      [d.id, d.updatedAt, result.status, userId, JSON.stringify(result)],
    )
    await this.audit(userId, 'dataset.org_validation', d.id, { status: result.status, unmappedShare: result.unmappedShare, rows: result.rows })
  }

  /* ---------------- Assignments (access managers) ---------------- */

  /** Assignments of a user with their current validity (validity unknown when the master is unreachable). */
  async listAssignments(userId: string): Promise<{ assignments: AssignmentView[]; unrestricted: boolean; masterAvailable: boolean }> {
    const user = (await this.db.query<{ username: string }>('SELECT username FROM dor_user WHERE id = $1', [userId])).rows[0]
    if (!user) throw notFound('Pengguna tidak ditemukan.')
    const rows = (await this.db.query<Row>('SELECT * FROM dor_user_access WHERE user_id = $1 ORDER BY created_at, id', [userId])).rows
    let snap: OrgSnapshot | null = null
    try {
      snap = await this.snapshots.get()
    } catch {
      snap = null
    }
    const assignments = rows.map((r) => {
      const a = toAssignment(r)
      const res = snap ? resolveAssignment(a, snap, this.rules) : null
      return {
        ...a,
        valid: res ? 'grant' in res : null,
        problem: res && 'problem' in res ? res.problem.message : null,
        warning: snap ? this.warningOf(a, snap) : null,
        unitCount: res && 'grant' in res ? res.grant.unitIds.length : null,
        createdAt: r.created_at.toISOString(),
        createdBy: r.created_by,
      }
    })
    return { assignments, unrestricted: this.isUnrestricted(user), masterAvailable: !!snap }
  }

  /** Replaces a user's assignments. Only an access manager, never on their own account; every assignment must resolve. */
  async putAssignments(actor: User, userId: string, input: AssignmentInput[]) {
    if (!this.isManager(actor)) throw forbidden('Hanya pengelola akses data yang dapat mengubah assignment.')
    if (actor.id === userId) throw new AppError(403, 'ACCESS_SELF_ASSIGNMENT', 'Anda tidak dapat mengubah assignment akses data milik Anda sendiri.')
    const snap = await this.snapshots.get()
    const problems: { index: number; message: string }[] = []
    const prepared = input.map((x, index) => {
      const orgLevel: OrgLevel = x.level === 'RAYON' || x.level === 'DIVISION' ? 'BUSINESS_UNIT' : x.level === 'OWNERSHIP' ? (x.orgLevel as OrgLevel) : (x.level as OrgLevel)
      const a: Assignment = { id: `new-${index}`, level: x.level, orgLevel, orgKind: x.orgKind, orgId: x.orgId, subKind: x.subKind, subId: x.subId, ownership: x.ownership ? [...new Set(x.ownership.map((o) => o.trim().toUpperCase()))].sort() : null, label: '', active: true }
      if (x.level === 'OWNERSHIP' && !x.orgLevel) {
        problems.push({ index, message: 'Kepemilikan wajib memiliki cakupan organisasi (level 2–7).' })
        return a
      }
      const r = resolveAssignment(a, snap, this.rules)
      if ('problem' in r) problems.push({ index, message: r.problem.message })
      return { ...a, label: this.labelOf(a, snap) }
    })
    const keys = prepared.map((a) => JSON.stringify([a.level, a.orgKind, a.orgId, a.subKind, a.subId, [...(a.ownership ?? [])].sort()]))
    keys.forEach((k, i) => keys.indexOf(k) !== i && problems.push({ index: i, message: 'Assignment ini sama dengan assignment lain.' }))
    if (problems.length) {
      const e = new AppError(400, 'ASSIGNMENT_INVALID', `Assignment belum valid: ${problems.slice(0, 3).map((p) => `#${p.index + 1} ${p.message}`).join(' ')}`)
      e.details = { problems }
      throw e
    }
    await this.write(async (c) => {
      const target = (await c.query<{ id: string }>('SELECT id FROM dor_user WHERE id = $1 FOR UPDATE', [userId])).rows[0]
      if (!target) throw notFound('Pengguna tidak ditemukan.')
      const before = (await c.query<Row>('SELECT * FROM dor_user_access WHERE user_id = $1', [userId])).rows.map(toAssignment)
      await c.query('DELETE FROM dor_user_access WHERE user_id = $1', [userId])
      for (const a of prepared) {
        await c.query(
          `INSERT INTO dor_user_access (user_id, level, org_level, org_kind, org_id, sub_kind, sub_id, ownership, label, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [userId, a.level, a.orgLevel, a.orgKind, a.orgId, a.subKind, a.subId, a.ownership, a.label, actor.id],
        )
      }
      const sum = (l: Assignment[]) => l.map((a) => ({ level: a.level, orgKind: a.orgKind, orgId: a.orgId, subId: a.subId, ownership: a.ownership }))
      await c.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [actor.id, 'access.assignments.update', userId, JSON.stringify({ before: sum(before), after: sum(prepared) })])
    })
    return this.listAssignments(userId)
  }

  /** K-07a: a division the master does not relate to the BU is allowed, with a warning (it can only yield less data). */
  private warningOf(a: Assignment, s: OrgSnapshot): string | null {
    if (a.level !== 'DIVISION' || !a.subId) return null
    return s.unitDivisions.has(`${a.orgId}|${a.subId}`) ? null : 'Divisi ini tidak tercatat untuk Unit Operasional tersebut di relasi master PIMS (ms_businessunitdivision); data yang tampil bisa kosong.'
  }

  labelOf(a: Pick<Assignment, 'level' | 'orgLevel' | 'orgKind' | 'orgId' | 'subId' | 'ownership'>, s: OrgSnapshot): string {
    const org = (() => {
      switch (a.orgKind) {
        case 'ms_group':
          return s.groups.get(a.orgId) ? `${s.groups.get(a.orgId)!.code} · ${s.groups.get(a.orgId)!.name}` : a.orgId
        case 'ms_region': {
          const r = s.regions.get(a.orgId)
          return r ? `${r.code} · ${r.name}${r.groupId && s.groups.get(r.groupId) ? ` (${s.groups.get(r.groupId)!.code})` : ''}` : a.orgId
        }
        case 'ms_so_node':
          return s.nodes.get(a.orgId) ? s.nodes.get(a.orgId)!.code : a.orgId
        case 'ms_gmk_header':
          return s.gmks.get(a.orgId)?.name ?? a.orgId
        case 'ms_company':
          return s.companies.get(a.orgId) ? `${s.companies.get(a.orgId)!.code} · ${s.companies.get(a.orgId)!.name}` : a.orgId
        case 'ms_businessunit':
          return s.units.get(a.orgId) ? `${s.units.get(a.orgId)!.code} · ${s.units.get(a.orgId)!.name}` : a.orgId
      }
    })()
    const sub = a.level === 'RAYON' ? s.rayons.get(a.subId ?? '') : a.level === 'DIVISION' ? s.divisions.get(a.subId ?? '') : null
    const own = a.level === 'OWNERSHIP' ? ` · ${(a.ownership ?? []).join('/')} · ${LEVEL_LABEL[a.orgLevel]}` : ''
    return `${LEVEL_LABEL[a.level]}${own} · ${org}${sub ? ` / ${sub.code} · ${sub.name}` : ''}`.slice(0, 300)
  }

  /* ---------------- Options for the assignment form (read from the master, never copied) ---------------- */

  async options(level: OrgLevel | 'RAYON' | 'DIVISION' | 'OWNERSHIP', parentId: string | null) {
    const s = await this.snapshots.get()
    const opt = (id: string, code: string, name: string, extra: Record<string, unknown> = {}) => ({ id, code, name, ...extra })
    const byCode = <T extends { code: string }>(l: T[]) => l.sort((a, b) => a.code.localeCompare(b.code, 'id', { numeric: true }))
    switch (level) {
      case 'GROUP':
        return byCode([...s.groups.values()].map((g) => opt(g.id, g.code, g.name)))
      case 'WILAYAH':
        return byCode([...s.nodes.values()].filter((n) => this.rules.wilayahNodeIds.has(n.id)).map((n) => opt(n.id, n.code, n.name, { orgKind: 'ms_so_node', units: n.unitIds.size })))
      case 'REGION':
        if (this.rules.regionSource === 'ms_region')
          return byCode([...s.regions.values()].map((r) => opt(r.id, r.code, r.name, { orgKind: 'ms_region', group: r.groupId ? (s.groups.get(r.groupId)?.code ?? null) : null })))
        if (this.rules.regionSource === 'so_region') {
          const reg = [...s.structures.values()].find((x) => x.code === 'REGION')?.id
          return byCode([...s.nodes.values()].filter((n) => n.structureId === reg && !n.isVirtual).map((n) => opt(n.id, n.code, n.name, { orgKind: 'ms_so_node', units: n.unitIds.size })))
        }
        return []
      case 'GMK':
        return [...s.gmks.values()].filter((g) => this.rules.gmkHeaderIds.has(g.id)).map((g) => opt(g.id, g.name, g.name, { orgKind: 'ms_gmk_header', units: g.unitIds.size })).sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }))
      case 'COMPANY':
        return byCode([...s.companies.values()].filter((c) => !parentId || c.groupId === parentId).map((c) => opt(c.id, c.code, c.name, { orgKind: 'ms_company', alias: c.alias, group: c.groupId ? (s.groups.get(c.groupId)?.code ?? null) : null })))
      case 'BUSINESS_UNIT':
        return byCode([...s.units.values()].filter((u) => !parentId || u.companyId === parentId).map((u) => opt(u.id, u.code, u.name, { orgKind: 'ms_businessunit', company: u.companyId ? (s.companies.get(u.companyId)?.code ?? null) : null })))
      case 'RAYON':
        return byCode([...s.rayons.values()].map((r) => opt(r.id, r.code, r.name, { orgKind: 'ms_rayon' })))
      case 'DIVISION':
        // Every active division; the ones related to the chosen BU first (K-07a: others allowed with a warning).
        return [...s.divisions.values()]
          .map((d) => ({ id: d.id, code: d.code, name: d.name, orgKind: 'ms_division', relatedToUnit: parentId ? s.unitDivisions.has(`${parentId}|${d.id}`) : null }))
          .sort((a, b) => Number(b.relatedToUnit) - Number(a.relatedToUnit) || a.code.localeCompare(b.code, 'id', { numeric: true }))
      case 'OWNERSHIP':
        return [...s.ownerships.values()].map((o) => opt(o.id, o.name.toUpperCase(), o.name))
    }
  }

  /** Configuration and master status for the user page (never credentials). */
  async status() {
    let available = false
    let error: string | null = null
    try {
      await this.snapshots.get()
      available = true
    } catch (e) {
      error = e instanceof AppError ? e.code : 'ORG_MASTER_UNAVAILABLE'
    }
    return {
      configured: !!this.config.orgDb,
      available,
      error,
      loadedAt: this.snapshots.loadedAt ? new Date(this.snapshots.loadedAt).toISOString() : null,
      cacheSeconds: this.config.dataAccess.cacheMs / 1000,
      levels: Object.fromEntries(LEVELS.map((l) => [l, l === 'REGION' ? !!this.rules.regionSource : l === 'WILAYAH' ? this.rules.wilayahNodeIds.size > 0 : l === 'GMK' ? this.rules.gmkHeaderIds.size > 0 : true])),
      regionSource: this.rules.regionSource,
    }
  }

  kindsFor(level: OrgLevel) {
    return kindsFor(level, this.rules)
  }

  /** Audits changes of the unrestricted_data list (grant / revoke) since the last start. */
  async syncUnrestrictedAudit() {
    const now = [...this.config.dataAccess.unrestrictedUsers].sort()
    const r = (await this.db.query<{ value: { users?: string[] } }>('SELECT value FROM dor_setting WHERE key = $1', [UNRESTRICTED_KEY])).rows[0]
    const before = [...(r?.value?.users ?? [])].sort()
    const granted = now.filter((x) => !before.includes(x))
    const revoked = before.filter((x) => !now.includes(x))
    if (!granted.length && !revoked.length && r) return
    for (const u of granted) await this.audit(null, 'data.unrestricted.grant', u, { source: 'DOD_DATA_UNRESTRICTED_USERS' })
    for (const u of revoked) await this.audit(null, 'data.unrestricted.revoke', u, { source: 'DOD_DATA_UNRESTRICTED_USERS' })
    await this.db.query(
      `INSERT INTO dor_setting (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [UNRESTRICTED_KEY, JSON.stringify({ users: now })],
    )
    if (granted.length || revoked.length) this.log.warn({ granted, revoked }, 'unrestricted_data holders changed')
  }

  private auditOnce(userId: string, key: string, everyMs: number, action: string, target: string, detail: unknown) {
    const t = this.now()
    const last = this.throttle.get(key)
    if (last !== undefined && t - last < everyMs) return
    this.throttle.set(key, t)
    if (this.throttle.size > 10_000) this.throttle.clear()
    void this.audit(userId, action, target, detail).catch((e) => this.log.warn({ code: (e as { code?: string }).code, action }, 'audit write failed'))
  }

  private audit(userId: string | null, action: string, target: string, detail: unknown) {
    return this.db.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [userId, action, target, JSON.stringify(detail)])
  }

  private async write<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.db.pool.connect()
    let broken: Error | undefined
    try {
      await c.query('BEGIN')
      const out = await fn(c)
      await c.query('COMMIT')
      return out
    } catch (e) {
      broken = await rollback(c, e)
      throw e
    } finally {
      c.release(broken)
    }
  }
}

export type { Grant }
