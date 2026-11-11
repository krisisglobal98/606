import { requestJson } from '@/services/api/apiClient'
import type { SavedLayout, SavedReport } from '@/types/report'
import { tr } from '@/i18n'

export const savedReportService = {
  list: (signal?: AbortSignal) => requestJson<SavedReport[]>('/saved-reports', { signal }),
  create: (body: { name: string; categoryId: string; datasetId: string; layout: SavedLayout }) => requestJson<SavedReport>('/saved-reports', { method: 'POST', body, loadingLabel: tr('Menyimpan laporan…') }),
  remove: (id: string) => requestJson<void>(`/saved-reports/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
