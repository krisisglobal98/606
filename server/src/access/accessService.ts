/**
 * Menu permissions per role, stored in dor_role_menu (see menus.ts for the catalog and the rules).
 *
 * The stored choices are cached for a few seconds, because every API request is checked against them; a save
 * refreshes the cache at once. When the table cannot be read, the last known choices are used, or the defaults
 * (every menu inside its ceiling) before the first read: the role checks of the API still apply either way.
 */
import type pg from 'pg'
import { z } from 'zod'
import type { Role } from '../auth/authService.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import { rollback } from '../db/connection.ts'
import { AppError, badRequest } from '../http/errors.ts'
import type { Logger } from '../log/logger.ts'
import { MENU, MENUS, ROLES, requiredMenus, type MenuDef } from './menus.ts'

const TTL_MS = 10_000

export const MenuSaveSchema = z.object({
  /** role → menu id → allowed; only the cells an administrator may change are accepted. */
  roles: z.partialRecord(z.enum(['admin', 'analyst', 'publisher', 'viewer']), z.record(z.string().max(64), z.boolean())),
})
export type MenuSave = z.infer<typeof MenuSaveSchema>

export type CellState = 'on' | 'off' | 'unavailable'
export interface MenuMatrix {
  roles: Role[]
  menus: (Pick<MenuDef, 'id' | 'label' | 'description' | 'parent'> & {
    cells: Record<Role, { state: CellState; locked: boolean; stored: boolean; reason: string | null }>
  })[]
  updatedAt: string | null
  updatedBy: string | null
}

type Stored = Map<string, boolean> // `${role}:${menu}` → allowed

export class AccessService {
  private readonly db: MetadataDb
  private readonly log: Logger
  private cache: { at: number; rows: Stored } | null = null
  private loading: Promise<Stored> | null = null

  constructor(db: MetadataDb, log: Logger) {
    this.db = db
    this.log = log
  }

  /** Why a role can never use a menu, or null when it can. */
  private ceiling(menu: MenuDef, role: Role): string | null {
    if (!menu.roles.includes(role)) return 'Fitur ini tidak tersedia untuk peran ini.'
    return null
  }

  private async stored(): Promise<Stored> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.rows
    this.loading ??= this.db
      .query<{ role: string; menu_id: string; allowed: boolean }>('SELECT role, menu_id, allowed FROM dor_role_menu')
      .then((r) => {
        const rows: Stored = new Map(r.rows.map((x) => [`${x.role}:${x.menu_id}`, x.allowed]))
        this.cache = { at: Date.now(), rows }
        return rows
      })
      .catch((e: unknown) => {
        this.log.warn({ code: (e as { code?: string }).code }, 'menu permissions unreadable; using the last known ones')
        return this.cache?.rows ?? new Map()
      })
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  private allowedIn(rows: Stored, role: Role, id: string): boolean {
    const menu = MENU.get(id)
    if (!menu || this.ceiling(menu, role)) return false
    if (menu.parent && !this.allowedIn(rows, role, menu.parent)) return false
    if (menu.locked?.includes(role)) return true
    return rows.get(`${role}:${id}`) ?? true
  }

  /** The menu ids a role may open (sent to the browser with the signed-in user). */
  async menusFor(role: Role): Promise<string[]> {
    const rows = await this.stored()
    return MENUS.filter((x) => this.allowedIn(rows, role, x.id)).map((x) => x.id)
  }

  /** Throws 403 when the role lacks a menu the request needs (see API_RULES). */
  async check(role: Role, method: string, path: string): Promise<void> {
    const need = requiredMenus(method, path)
    if (!need.length) return
    const rows = await this.stored()
    const miss = need.find((anyOf) => !anyOf.some((id) => this.allowedIn(rows, role, id)))
    if (miss) {
      const label = MENU.get(miss[0]!)?.label ?? miss[0]
      throw new AppError(403, 'MENU_FORBIDDEN', `Menu "${label}" tidak diizinkan untuk peran Anda. Hubungi administrator bila Anda memerlukannya.`)
    }
  }

  async matrix(): Promise<MenuMatrix> {
    const rows = await this.stored()
    const last = (await this.db.query<{ at: Date; name: string | null }>('SELECT m.updated_at AS at, u.name FROM dor_role_menu m LEFT JOIN dor_user u ON u.id = m.updated_by ORDER BY m.updated_at DESC LIMIT 1')).rows[0]
    return {
      roles: [...ROLES],
      menus: MENUS.map((menu) => ({
        id: menu.id,
        label: menu.label,
        description: menu.description,
        parent: menu.parent,
        cells: Object.fromEntries(
          ROLES.map((role) => {
            const reason = this.ceiling(menu, role)
            const locked = !reason && !!menu.locked?.includes(role)
            const own = rows.get(`${role}:${menu.id}`)
            const state: CellState = reason ? 'unavailable' : locked || (own ?? true) ? 'on' : 'off'
            return [role, { state, locked, stored: own !== undefined, reason: reason ?? (locked ? 'Selalu aktif untuk admin agar halaman ini tetap bisa dibuka.' : null) }]
          }),
        ) as MenuMatrix['menus'][number]['cells'],
      })),
      updatedAt: last ? new Date(last.at).toISOString() : null,
      updatedBy: last?.name ?? null,
    }
  }

  /** Stores the administrator's choices for every changeable cell sent; unknown, unavailable or locked cells are refused. */
  async save(input: MenuSave, userId: string): Promise<MenuMatrix> {
    const cells: { role: Role; id: string; allowed: boolean }[] = []
    for (const [role, menus] of Object.entries(input.roles) as [Role, Record<string, boolean>][]) {
      for (const [id, allowed] of Object.entries(menus)) {
        const menu = MENU.get(id)
        if (!menu) throw badRequest('UNKNOWN_MENU', `Menu "${id.slice(0, 64)}" tidak dikenal.`)
        if (this.ceiling(menu, role)) throw badRequest('MENU_UNAVAILABLE', `Menu "${menu.label}" tidak tersedia untuk peran ${role}.`)
        if (menu.locked?.includes(role)) {
          if (!allowed) throw badRequest('MENU_LOCKED', `Menu "${menu.label}" selalu aktif untuk ${role}.`)
          continue
        }
        cells.push({ role, id, allowed })
      }
    }
    await this.write(async (c) => {
      for (const x of cells) {
        await c.query(
          `INSERT INTO dor_role_menu (role, menu_id, allowed, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (role, menu_id) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = now()
           WHERE dor_role_menu.allowed IS DISTINCT FROM EXCLUDED.allowed`,
          [x.role, x.id, x.allowed, userId],
        )
      }
      const off = cells.filter((x) => !x.allowed).map((x) => `${x.role}:${x.id}`)
      await c.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [userId, 'access.menus.save', 'dor_role_menu', JSON.stringify({ cells: cells.length, off })])
    })
    return this.matrix()
  }

  /** Back to the defaults: every menu on inside its ceiling. */
  async reset(userId: string): Promise<MenuMatrix> {
    await this.write(async (c) => {
      const r = await c.query('DELETE FROM dor_role_menu')
      await c.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [userId, 'access.menus.reset', 'dor_role_menu', JSON.stringify({ removed: r.rowCount })])
    })
    return this.matrix()
  }

  private async write(fn: (c: pg.PoolClient) => Promise<void>) {
    const c = await this.db.pool.connect()
    let broken: Error | undefined
    try {
      await c.query('BEGIN')
      await fn(c)
      await c.query('COMMIT')
    } catch (e) {
      broken = await rollback(c, e)
      throw e
    } finally {
      c.release(broken)
      this.cache = null
    }
  }
}
