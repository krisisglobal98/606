import { requestJson } from '@/services/api/apiClient'
import type { BlockItem, BlockOps, BlockProfile, BlockTab, CostCategory, Picked, ProfileUnit, VehicleCard, VehicleCardSettings, VehicleItem, VehicleOps } from '@/types/profile'

const qs = (p: Record<string, string>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString()
  return s ? `?${s}` : ''
}

/** Analisis → Data Profil (read-only master data). */
export const profileService = {
  units: (signal?: AbortSignal) => requestJson<ProfileUnit[]>('/profile/units', { signal, silent: true }),
  blocks: (f: { unit: string; q: string }, signal?: AbortSignal) => requestJson<Picked<BlockItem>>(`/profile/blocks${qs(f)}`, { signal, silent: true }),
  block: (id: string, signal?: AbortSignal) => requestJson<BlockProfile>(`/profile/blocks/${encodeURIComponent(id)}`, { signal, silent: true }),
  vehicles: (f: { unit: string; q: string }, signal?: AbortSignal) => requestJson<Picked<VehicleItem>>(`/profile/vehicles${qs(f)}`, { signal, silent: true }),
  vehicle: (id: string, signal?: AbortSignal) => requestJson<VehicleCard>(`/profile/vehicles/${encodeURIComponent(id)}`, { signal, silent: true }),
  blockOps: (id: string, tab: BlockTab, period: string, signal?: AbortSignal) => requestJson<BlockOps>(`/profile/blocks/${encodeURIComponent(id)}/ops/${tab}${qs({ period })}`, { signal, silent: true }),
  vehicleOps: (id: string, period: string, signal?: AbortSignal) => requestJson<VehicleOps>(`/profile/vehicles/${encodeURIComponent(id)}/ops${qs({ period })}`, { signal, silent: true }),
  setVehicleCard: (id: string, card: Omit<VehicleCardSettings, 'updatedAt'>) => requestJson<VehicleCardSettings>(`/profile/vehicles/${encodeURIComponent(id)}/card`, { method: 'PUT', body: card }),
  setVehicleCosts: (id: string, period: string, items: { kategori: CostCategory; nilai: number; qty: number | null; sumber: string | null }[]) =>
    requestJson<{ period: string; items: number }>(`/profile/vehicles/${encodeURIComponent(id)}/costs/${period}`, { method: 'PUT', body: { items } }),
}
