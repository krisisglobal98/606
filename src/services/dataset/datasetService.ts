import { request } from '@/services/api/apiClient'
import { onSessionReset } from '@/services/session/sessionCaches'
import { DatasetSchema, WarehouseCatalogSchema, type Dataset, type DatasetCatalog } from '@/types/contracts'

let catalog: Promise<DatasetCatalog> | null = null
/** Chosen datasets with their coverage and source state (GET /dw/catalog/:id), by id. */
const chosen = new Map<string, Dataset>()
// The catalog carries the user's access status and coverage: dropped when the session or the user changes.
onSessionReset(() => {
  catalog = null
  chosen.clear()
})

export const datasetService = {
  /**
   * Analysis catalogue: the active datasets in DOD's database (DOD backend). Cached per session;
   * `invalidate()` after a dataset is created, changed or deleted. A failure is not cached.
   * The list sends no query to the data sources (it opens fast); coverage may be null until the dataset is chosen.
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
  /**
   * The chosen dataset with its date coverage and the state of its source, read from the source by the server.
   * Kept for the session once answered; a failure is not kept.
   */
  async getChosen(id: string, signal?: AbortSignal): Promise<Dataset> {
    const hit = chosen.get(id)
    if (hit) return hit
    const d = await request(`/dw/catalog/${encodeURIComponent(id)}`, { schema: DatasetSchema, signal })
    chosen.set(id, d)
    return d
  },
  invalidate() {
    catalog = null
    chosen.clear()
  },
}
