import { requestJson } from '@/services/api/apiClient'
import type { AssignmentInput, Level, ManagedUser, OrgLevel, OrgOptionItem, OrgStatus, UserAccess, UserInput } from '@/types/users'
import { tr } from '@/i18n'

const e = encodeURIComponent

/** Settings → Pengguna: identity (administrators) and data access assignments (access managers). */
export const userService = {
  list: (signal?: AbortSignal) => requestJson<ManagedUser[]>('/users', { signal }),
  get: (id: string, signal?: AbortSignal) => requestJson<ManagedUser>(`/users/${e(id)}`, { signal }),
  create: (body: UserInput) => requestJson<ManagedUser>('/users', { method: 'POST', body, loadingLabel: tr('Menyimpan pengguna…') }),
  update: (id: string, body: UserInput) => requestJson<ManagedUser>(`/users/${e(id)}`, { method: 'PUT', body, loadingLabel: tr('Menyimpan pengguna…') }),

  access: (id: string, signal?: AbortSignal) => requestJson<UserAccess>(`/users/${e(id)}/access`, { signal }),
  saveAccess: (id: string, assignments: AssignmentInput[]) => requestJson<UserAccess>(`/users/${e(id)}/access`, { method: 'PUT', body: { assignments }, loadingLabel: tr('Menyimpan akses data…') }),

  orgOptions: (level: OrgLevel | 'RAYON' | 'DIVISION' | 'OWNERSHIP', parent: string | null, signal?: AbortSignal) =>
    requestJson<OrgOptionItem[]>(`/org/options?level=${e(level)}${parent ? `&parent=${e(parent)}` : ''}`, { signal }),
  orgStatus: (signal?: AbortSignal) => requestJson<OrgStatus>('/org/status', { signal }),
  orgReload: () => requestJson<OrgStatus>('/org/reload', { method: 'POST', loadingLabel: tr('Memuat ulang master organisasi…') }),
}

export type { Level }
