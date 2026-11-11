/**
 * Report → Laporan Operasional contracts (server/src/reports/savedReportService.ts): Analysis layouts saved
 * under a name and a master category. (Laporan PDF was removed from DOD Minimal.)
 */

/** Laporan Operasional: an Analysis layout saved under a name and a master category. */
export interface SavedLayout {
  scope: Record<string, string[]>
  filter: Record<string, unknown>
  dimensions: string[]
  measureLayout: unknown[]
  measureSettings: Record<string, unknown>
  chartType: string
  chartBy: string
  table: Record<string, unknown>
  calc: unknown[]
}
export interface SavedReport {
  id: string
  name: string
  categoryId: string | null
  datasetId: string
  /** null: the dataset was deleted, so the report cannot be opened. */
  datasetName: string | null
  layout: SavedLayout
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}
