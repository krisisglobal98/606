import { request } from '@/services/api/apiClient'
import { onSessionReset } from '@/services/session/sessionCaches'
import { WarehouseCatalogSchema, type DatasetCatalog } from '@/types/contracts'

let catalog: Promise<DatasetCatalog> | null = null
// The catalog carries the user's access status and coverage: dropped when the session or the user changes.
onSessionReset(() => {
  catalog = null
})

export const datasetService = {
  /**
   * Analysis catalogue: the active datasets in DOD's database (DOD backend). Cached per session;
   * `invalidate()` after a dataset is created, changed or deleted. A failure is not cached.
   */
  getCatalog(): Promise<DatasetCatalog> {
    if (catalog) return catalog
    const mine: Promise<DatasetCatalog> = request('/dw/catalog', { schema: WarehouseCatalogSchema }).catch((e: unknown) => {
      if (catalog === mine) catalog = null
      throw e
    })
    catalog = mine
    return mine
  },
  invalidate() {
    catalog = null
  },
}
