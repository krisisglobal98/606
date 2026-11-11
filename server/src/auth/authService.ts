/**
 * Users and sessions in DOD's metadata DB. Passwords are scrypt hashes; session tokens are random
 * and only their SHA-256 hash is stored, so a database leak does not expose live sessions.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Config } from '../config/config.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import { AppError, unauthenticated } from '../http/errors.ts'
import type { Logger } from '../log/logger.ts'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export type Role = 'admin' | 'analyst' | 'publisher' | 'viewer'
export interface User {
  id: string
  username: string
  name: string
  role: Role
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, salt, key] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(expected, actual)
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

export class AuthService {
  private readonly db: MetadataDb
  private readonly config: Config
  private readonly log: Logger

  constructor(db: MetadataDb, config: Config, log: Logger) {
    this.db = db
    this.config = config
    this.log = log
  }

  /** Creates the first administrator from DOD_ADMIN_* when no user exists yet. */
  async ensureAdmin() {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM dor_user')
    if (Number(rows[0]?.n) > 0) return
    const pw = this.config.auth.adminPassword
    if (!pw) {
      this.log.warn('no users exist and DOD_ADMIN_PASSWORD is not set: nobody can sign in until it is configured')
      return
    }
    if (pw.length < 8 && this.config.env === 'production') throw new Error('DOD_ADMIN_PASSWORD must be at least 8 characters in production')
    await this.db.query('INSERT INTO dor_user (id, username, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)', [
      randomUUID(),
      this.config.auth.adminUsername,
      this.config.auth.adminName,
      'admin',
      await hashPassword(pw),
    ])
    this.log.info({ username: this.config.auth.adminUsername }, 'initial administrator created')
  }

  async login(username: string, password: string) {
    const { rows } = await this.db.query<User & { password_hash: string; active: boolean }>('SELECT id, username, name, role, password_hash, active FROM dor_user WHERE lower(username) = lower($1)', [username.trim()])
    const u = rows[0]
    // Always run a hash comparison so response time does not reveal whether the user exists.
    const ok = await verifyPassword(password, u?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
    if (!u || !ok || !u.active) {
      this.log.info({ username: username.trim().slice(0, 64), reason: !u ? 'unknown_user' : !u.active ? 'inactive' : 'bad_password' }, 'login rejected')
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Username atau password salah.')
    }
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.config.auth.sessionHours * 3600e3)
    await this.db.query('INSERT INTO dor_session (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [hashToken(token), u.id, expiresAt])
    await this.db.query('DELETE FROM dor_session WHERE expires_at < now()')
    await this.db.query('INSERT INTO dor_audit (user_id, action) VALUES ($1, $2)', [u.id, 'auth.login'])
    const user: User = { id: u.id, username: u.username, name: u.name, role: u.role }
    return { token, expiresAt: expiresAt.toISOString(), user }
  }

  async userForToken(token: string | null): Promise<User> {
    if (!token) throw unauthenticated()
    const { rows } = await this.db.query<User>(
      `SELECT u.id, u.username, u.name, u.role FROM dor_session s JOIN dor_user u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [hashToken(token)],
    )
    if (!rows[0]) throw unauthenticated()
    return rows[0]
  }

  /**
   * The signed-in user changes their own password. The current password must be correct; the other sessions of
   * the user end (the one making the change stays signed in).
   */
  async changePassword(userId: string, token: string | null, current: string, next: string) {
    const { rows } = await this.db.query<{ password_hash: string }>('SELECT password_hash FROM dor_user WHERE id = $1 AND active', [userId])
    const u = rows[0]
    if (!u || !(await verifyPassword(current, u.password_hash))) throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Password saat ini salah.')
    if (current === next) throw new AppError(400, 'SAME_PASSWORD', 'Password baru harus berbeda dari password saat ini.')
    await this.db.query('UPDATE dor_user SET password_hash = $2, updated_at = now(), updated_by = $1 WHERE id = $1', [userId, await hashPassword(next)])
    const ended = await this.db.query('DELETE FROM dor_session WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2', [userId, token ? hashToken(token) : null])
    await this.db.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [userId, 'auth.password', userId, JSON.stringify({ otherSessionsEnded: ended.rowCount ?? 0 })])
    return { otherSessionsEnded: ended.rowCount ?? 0 }
  }

  async logout(token: string | null) {
    if (token) await this.db.query('DELETE FROM dor_session WHERE token_hash = $1', [hashToken(token)])
  }
}
