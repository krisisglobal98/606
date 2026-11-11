import { useResource } from '@/hooks/useResource'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { onSessionReset } from '@/services/session/sessionCaches'

const cache = new Map<string, Promise<{ values: string[]; truncated: boolean }>>()
// Values depend on the user's data access scope: dropped when the session or the user changes.
onSessionReset(() => cache.clear())

/** Distinct values of a warehouse dimension (bounded server-side, cached for the session). */
export function useFieldValues(datasetId: string, field: string) {
  const key = `${datasetId}|${field}`
  return useResource(() => {
    let p = cache.get(key)
    if (!p) {
      const mine = dataWarehouseService.getFieldValues(datasetId, field)
      // Only the entry made here is removed on failure (not a newer one after a session reset).
      mine.catch(() => cache.get(key) === mine && cache.delete(key))
      cache.set(key, mine)
      p = mine
    }
    return p
  }, key)
}
