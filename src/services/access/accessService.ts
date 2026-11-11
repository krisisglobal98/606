import { requestJson } from '@/services/api/apiClient'
import type { MenuChanges, MenuMatrix } from '@/types/access'
import { tr } from '@/i18n'

/** Settings → Hak Akses Menu (administrators). */
export const accessService = {
  matrix: (signal?: AbortSignal) => requestJson<MenuMatrix>('/access/menus', { signal }),
  save: (roles: MenuChanges) => requestJson<MenuMatrix>('/access/menus', { method: 'PUT', body: { roles }, loadingLabel: tr('Menyimpan hak akses…') }),
  reset: () => requestJson<MenuMatrix>('/access/menus/reset', { method: 'POST', loadingLabel: tr('Mengembalikan hak akses bawaan…') }),
}
