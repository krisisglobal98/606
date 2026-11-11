/** Menu permissions per role (Settings → Hak Akses Menu), as GET /api/access/menus returns them. */
import type { User } from './contracts'

export type Role = User['role']
export type CellState = 'on' | 'off' | 'unavailable'
export interface MenuCell {
  state: CellState
  /** Always on for this role (the permission page itself for admin). */
  locked: boolean
  /** An administrator saved a choice for this cell (otherwise the default applies). */
  stored: boolean
  reason: string | null
}
export interface MenuRow {
  id: string
  label: string
  description: string
  parent: string | null
  cells: Record<Role, MenuCell>
}
export interface MenuMatrix {
  roles: Role[]
  menus: MenuRow[]
  updatedAt: string | null
  updatedBy: string | null
}
export type MenuChanges = Partial<Record<Role, Record<string, boolean>>>
