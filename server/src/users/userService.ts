/**
 * User management on dor_user (the only user table): identity and application role. Administrators create,
 * edit and deactivate users; there is no delete, so every reference (owner, author, audit) stays valid.
 *
 * - Responses list columns explicitly: password_hash never leaves this module.
 * - Input is a strict schema (model.ts): id, password_hash, audit and the retired scope columns cannot be sent.
 * - Data access is NOT here: assignments live in dor_user_access (dataAccess/), unrestricted_data and access
 *   managers in the server environment. The retired columns (level_code, *_code, ownership_code) are neither
 *   read nor written, so the previous version of DOD still finds them unchanged (rollback).
 * - Every change runs in one transaction with its dor_audit row; a password reset or deactivation ends the
 *   user's sessions. Nobody can lock DOD out: the last active administrator cannot be demoted or deactivated,
 *   and an administrator cannot demote or deactivate their own account.
 */
import type pg from 'pg'
import { hashPassword, type Role } from '../auth/authService.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import { rollback } from '../db/connection.ts'
import { AppError, notFound } from '../http/errors.ts'
import { ssoProblems, type Problem, type UserCreate, type UserUpdate } from './model.ts'

export interface ManagedUser {
  id: string
  username: string
  name: string
  role: Role
  identityIssuer: string | null
  externalSubject: string | null
  active: boolean
  /** Number of data access assignments (details: GET /api/users/:id/access). */
  assignments: number
  createdAt: string
  updatedAt: string
  updatedBy: { id: string; name: string } | null
}

const SELECT = `
  SELECT u.id, u.username, u.name, u.role, u.identity_issuer, u.external_subject, u.active, u.created_at, u.updated_at,
         (SELECT count(*) FROM dor_user_access a WHERE a.user_id = u.id AND a.active)::int AS assignments,
         ub.id AS updated_by_id, ub.name AS updated_by_name
  FROM dor_user u LEFT JOIN dor_user ub ON ub.id = u.updated_by`

interface Row { id: string; username: string; name: string; role: Role; identity_issuer: string | null; external_subject: string | null; active: boolean; assignments: number; created_at: Date; updated_at: Date; updated_by_id: string | null; updated_by_name: string | null }

const toUser = (r: Row): ManagedUser => ({
  id: r.id,
  username: r.username,
  name: r.name,
  role: r.role,
  identityIssuer: r.identity_issuer,
  externalSubject: r.external_subject,
  active: r.active,
  assignments: Number(r.assignments ?? 0),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  updatedBy: r.updated_by_id ? { id: r.updated_by_id, name: r.updated_by_name ?? r.updated_by_id } : null,
})

function invalid(problems: Problem[]) {
  const e = new AppError(400, 'USER_INVALID', `Data pengguna belum valid. ${problems.map((p) => p.message).join(' ')}`)
  e.details = { problems }
  return e
}

export class UserService {
  private readonly db: MetadataDb

  constructor(db: MetadataDb) {
    this.db = db
  }

  async list(): Promise<ManagedUser[]> {
    return (await this.db.query<Row>(`${SELECT} ORDER BY u.active DESC, lower(u.name)`)).rows.map(toUser)
  }

  async get(id: string): Promise<ManagedUser> {
    const r = (await this.db.query<Row>(`${SELECT} WHERE u.id = $1`, [id])).rows[0]
    if (!r) throw notFound('Pengguna tidak ditemukan.')
    return toUser(r)
  }

  async create(input: UserCreate, actorId: string): Promise<ManagedUser> {
    const id = await this.write(async (c) => {
      await this.validate(c, input, null)
      const cols = ['username', 'name', 'role', 'identity_issuer', 'external_subject', 'active', 'password_hash', 'updated_by']
      const vals = [input.username, input.name, input.role, input.identityIssuer, input.externalSubject, input.active, await hashPassword(input.password), actorId]
      // id: the column default (gen_random_uuid()::text).
      const r = await c.query<{ id: string }>(`INSERT INTO dor_user (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)
      const newId = r.rows[0]!.id
      await audit(c, actorId, 'user.create', newId, { username: input.username, role: input.role, active: input.active, sso: !!input.identityIssuer })
      return newId
    })
    return this.get(id)
  }

  async update(id: string, input: UserUpdate, actorId: string): Promise<ManagedUser> {
    await this.write(async (c) => {
      const before = (await c.query<Row>(`${SELECT} WHERE u.id = $1 FOR UPDATE OF u`, [id])).rows[0]
      if (!before) throw notFound('Pengguna tidak ditemukan.')
      const prev = toUser(before)
      await this.validate(c, input, prev)
      if (id === actorId && (input.role !== 'admin' || !input.active) && prev.role === 'admin') {
        throw new AppError(409, 'USER_SELF_LOCKOUT', 'Anda tidak dapat menurunkan peran atau menonaktifkan akun Anda sendiri.')
      }
      if (prev.role === 'admin' && prev.active && (input.role !== 'admin' || !input.active)) {
        const n = Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM dor_user WHERE role = 'admin' AND active AND id <> $1", [id])).rows[0]?.n ?? 0)
        if (n === 0) throw new AppError(409, 'LAST_ADMIN', 'Pengguna ini adalah satu-satunya administrator aktif. Tetapkan administrator lain terlebih dahulu.')
      }
      const sets: string[] = ['username = $2', 'name = $3', 'role = $4', 'identity_issuer = $5', 'external_subject = $6', 'active = $7', 'updated_by = $8', 'updated_at = now()']
      const vals: unknown[] = [id, input.username, input.name, input.role, input.identityIssuer, input.externalSubject, input.active, actorId]
      if (input.password) sets.push(`password_hash = $${vals.push(await hashPassword(input.password))}`)
      await c.query(`UPDATE dor_user SET ${sets.join(', ')} WHERE id = $1`, vals)
      // A reset password or a deactivated account signs the user out everywhere.
      if (input.password || !input.active) await c.query('DELETE FROM dor_session WHERE user_id = $1', [id])
      const changed = [
        ...(['username', 'name', 'role', 'identityIssuer', 'externalSubject', 'active'] as const).filter((k) => prev[k] !== input[k]),
        ...(input.password ? ['password'] : []),
      ]
      await audit(c, actorId, 'user.update', id, { changed, ...(prev.role !== input.role ? { role: { from: prev.role, to: input.role } } : {}), ...(prev.active !== input.active ? { active: input.active } : {}) })
    })
    return this.get(id)
  }

  /** Rules that need the database: unique username and SSO identity. */
  private async validate(c: pg.PoolClient, v: UserCreate | UserUpdate, prev: ManagedUser | null) {
    const problems = ssoProblems(v.identityIssuer, v.externalSubject)
    if (problems.length) throw invalid(problems)
    const dupUser = await c.query('SELECT 1 FROM dor_user WHERE lower(username) = lower($1) AND id IS DISTINCT FROM $2', [v.username, prev?.id ?? null])
    if (dupUser.rowCount) throw new AppError(409, 'USERNAME_EXISTS', `Username "${v.username}" sudah dipakai.`)
    if (v.identityIssuer) {
      const dupSso = await c.query('SELECT 1 FROM dor_user WHERE identity_issuer = $1 AND external_subject = $2 AND id IS DISTINCT FROM $3', [v.identityIssuer, v.externalSubject, prev?.id ?? null])
      if (dupSso.rowCount) throw new AppError(409, 'SSO_IDENTITY_EXISTS', 'Identitas SSO ini (issuer + external subject) sudah dipakai pengguna lain.')
    }
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
      throw conflict(e)
    } finally {
      c.release(broken)
    }
  }
}

/** Unique-index races that slip past the checks above. */
function conflict(e: unknown) {
  const err = e as { code?: string; constraint?: string }
  if (err.code === '23505' && /sso/.test(err.constraint ?? '')) return new AppError(409, 'SSO_IDENTITY_EXISTS', 'Identitas SSO ini (issuer + external subject) sudah dipakai pengguna lain.')
  if (err.code === '23505') return new AppError(409, 'USERNAME_EXISTS', 'Username sudah dipakai.')
  return e
}

const audit = (c: pg.PoolClient, userId: string, action: string, target: string, detail: unknown) =>
  c.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [userId, action, target, JSON.stringify(detail)])
