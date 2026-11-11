/**
 * Menu ids and the pure permission helpers (no React), shared by the navigation, the routes and the tests.
 * Ids are the ones of server/src/access/menus.ts.
 */
import type { User } from '@/types/contracts'

/** Top-level menus in menu order, with the page each one opens. */
export const MENU_PATHS: { id: string; path: string }[] = [
  { id: 'beranda', path: '/beranda' },
  { id: 'analisis', path: '/analisis' },
  { id: 'report', path: '/report' },
  { id: 'data', path: '/data' },
  { id: 'settings', path: '/settings' },
]

/** Sub-menus of the modules, in tab order. */
/** Report has one sub-menu: Laporan Operasional (Laporan PDF was removed). */
export const REPORT_TABS = [{ id: 'report.operasional', path: '/report/operasional' }]
/** Data has one sub-menu: Set Data (datasets and categories). Connections are set in the server's .env. */
export const DATA_TABS = [{ id: 'data.dataset', path: '/data/dataset' }]

/** Whether the user may open a menu. A server without permissions sends no list: every menu then stays open. */
export function canOpen(user: Pick<User, 'menus'> | null | undefined, id: string): boolean {
  if (!user) return false
  return !user.menus || user.menus.includes(id)
}

/** The preferred page when its menu is allowed, otherwise the first allowed menu (Settings is always last). */
export function allowedLanding(user: Pick<User, 'menus'> | null | undefined, preferred: string): string {
  const own = MENU_PATHS.find((m) => preferred === m.path || preferred.startsWith(`${m.path}/`))
  if (!own || canOpen(user, own.id)) return preferred
  return MENU_PATHS.find((m) => canOpen(user, m.id))?.path ?? '/settings'
}

/** The first sub-page of a module that the user may open (for the module's index route). */
export function firstAllowed(user: Pick<User, 'menus'> | null | undefined, items: { id: string; path: string }[]): string | null {
  return items.find((x) => canOpen(user, x.id))?.path ?? null
}

