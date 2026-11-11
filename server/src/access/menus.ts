/**
 * Menu catalog of the role permissions (Settings → Hak Akses Menu) and the API rules that enforce them.
 *
 * Every menu has a ceiling: the roles that can use it at all, because the API's role checks allow them
 * (e.g. Pengguna & Organisasi needs admin). An administrator can switch a menu off for a role inside that
 * ceiling, never on outside it. A sub-menu needs its parent. Without a stored choice a menu is on, which is
 * how DOD behaved before permissions existed.
 *
 * The server checks the module APIs against the same permissions (API_RULES): a module's API needs its menu,
 * and a sub-menu's changes need the sub-menu. Shared reads (datasets, analytics) stay open to every signed-in
 * user, because Analisis and Report read them too.
 */
import type { Role } from '../auth/authService.ts'

export const ROLES: readonly Role[] = ['admin', 'analyst', 'publisher', 'viewer']
const ALL = ROLES
const ADMIN: readonly Role[] = ['admin']

export interface MenuDef {
  id: string
  label: string
  description: string
  parent: string | null
  /** Roles that can use the menu at all. */
  roles: readonly Role[]
  /** Roles that always keep the menu (so no administrator locks everyone out of this page). */
  locked?: readonly Role[]
}

const m = (id: string, label: string, description: string, roles: readonly Role[], extra: Partial<MenuDef> = {}): MenuDef => ({ id, label, description, parent: extra.parent ?? null, roles, ...extra })

export const MENUS: readonly MenuDef[] = [
  m('beranda', 'Beranda', 'Halaman awal', ALL),
  m('analisis', 'Analisis', 'Eksplorasi dataset dan grafik', ALL),
  m('analisis.profil-blok', 'Profil Blok', 'Data Profil: profil blok dari data master', ALL, { parent: 'analisis' }),
  m('analisis.kartu-kendaraan', 'Kartu Kendaraan', 'Data Profil: kartu kendaraan dari data master', ALL, { parent: 'analisis' }),
  m('report', 'Report', 'Laporan Operasional dari halaman Analisis', ALL),
  m('report.operasional', 'Laporan Operasional', 'Layout tersimpan dari halaman Analisis', ALL, { parent: 'report' }),
  m('data', 'Data', 'Siklus persiapan data', ALL),
  m('data.dataset', 'Dataset & Kategori', 'Dataset dan kategorinya', ALL, { parent: 'data' }),
  m('settings', 'Settings', 'Profil, tampilan, dan preferensi', ALL, { locked: ADMIN }),
  m('settings.users', 'Pengguna & Organisasi', 'Kelola pengguna dan master organisasi', ADMIN, { parent: 'settings' }),
  m('settings.permissions', 'Hak Akses Menu', 'Halaman ini', ADMIN, { parent: 'settings', locked: ADMIN }),
]
export const MENU = new Map(MENUS.map((x) => [x.id, x]))

type Method = 'GET' | 'WRITE' | 'ANY'
/** First match wins per path; every matching rule's menus must be allowed (anyOf within one rule). */
export interface ApiRule {
  method: Method
  path: RegExp
  anyOf: string[]
}
const r = (method: Method, path: RegExp, ...anyOf: string[]): ApiRule => ({ method, path, anyOf })

export const API_RULES: readonly ApiRule[] = [
  r('ANY', /^\/api\/profile\//, 'analisis'),
  r('ANY', /^\/api\/profile\/blocks(\/|$)/, 'analisis.profil-blok'),
  r('ANY', /^\/api\/profile\/vehicles(\/|$)/, 'analisis.kartu-kendaraan'),
  // Saved in Analisis, read and removed in Report → Laporan Operasional.
  r('GET', /^\/api\/saved-reports$/, 'report.operasional'),
  r('WRITE', /^\/api\/saved-reports$/, 'analisis'),
  r('WRITE', /^\/api\/saved-reports\//, 'report.operasional'),
  // a sub-menu is only allowed together with its parent, so naming the sub-menu covers both
  // connections (names only, from .env) and their tables are read only to build and edit datasets
  r('ANY', /^\/api\/dw\/connections(\/|$)/, 'data.dataset'),
  r('WRITE', /^\/api\/dw\/datasets(\/|$)/, 'data.dataset'),
  r('WRITE', /^\/api\/categories(\/|$)/, 'data.dataset'),
  r('ANY', /^\/api\/(users|org)(\/|$)/, 'settings.users'),
  r('ANY', /^\/api\/access\//, 'settings.permissions'),
]

/** The menus a request needs (one list per matching rule; any menu of a list is enough). */
export function requiredMenus(method: string, path: string): string[][] {
  const write = method !== 'GET' && method !== 'HEAD'
  return API_RULES.filter((x) => x.path.test(path) && (x.method === 'ANY' || (x.method === 'WRITE') === write)).map((x) => x.anyOf)
}
