/**
 * Data warehouse access through the DOD backend (/api/dw/*). The browser never talks to a source database:
 * it asks the backend, which holds the credentials and returns bounded results. Connections are set only in
 * the server's .env; the browser knows their names and types, and reads schemas, tables and columns to build
 * and edit datasets (Data → Set Data).
 */
import { requestJson } from '@/services/api/apiClient'
import type { DatasetOrgInfo, DatasetOrgStatus, DatasetOrgValidation, DatasetSuggestion, DwCategory, DwColumn, DwConnection, DwSchema, DwTable, SemanticModel, WhDataset, WhDatasetSummary } from '@/types/warehouse'
import { tr } from '@/i18n'

const e = encodeURIComponent
const table = (c: string, s: string, t: string) => `/dw/connections/${e(c)}/schemas/${e(s)}/tables/${e(t)}`

export const dataWarehouseService = {
  /** The connections of .env (names and types only). */
  getConnections: (signal?: AbortSignal) => requestJson<DwConnection[]>('/dw/connections', { signal }),
  getSchemas: (id: string, signal?: AbortSignal, fresh = false) => requestJson<DwSchema[]>(`/dw/connections/${e(id)}/schemas`, { signal, query: fresh ? { fresh: '1' } : undefined }),
  getTables: (id: string, schema: string, signal?: AbortSignal, fresh = false) =>
    requestJson<DwTable[]>(`/dw/connections/${e(id)}/schemas/${e(schema)}/tables`, { signal, query: fresh ? { fresh: '1' } : undefined }),
  getTableColumns: (id: string, schema: string, name: string, signal?: AbortSignal) => requestJson<DwColumn[]>(`${table(id, schema, name)}/columns`, { signal }),

  suggestDataset: (body: { connectionId: string; schema: string; tables: string[] }, signal?: AbortSignal) =>
    requestJson<DatasetSuggestion>('/dw/datasets/suggest', { method: 'POST', body, signal }),
  createDataset: (body: { name: string; description: string; connectionId: string; schema: string; tables: string[]; semantic: SemanticModel; categoryId: string | null }) =>
    requestJson<WhDataset>('/dw/datasets', { method: 'POST', body }),
  listDatasets: (signal?: AbortSignal) => requestJson<WhDatasetSummary[]>('/dw/datasets', { signal }),
  getDataset: (id: string, signal?: AbortSignal) => requestJson<WhDataset>(`/dw/datasets/${e(id)}`, { signal }),
  updateDataset: (id: string, patch: Partial<Pick<WhDataset, 'name' | 'description' | 'status' | 'semantic'>> & { categoryId?: string | null }) =>
    requestJson<WhDataset>(`/dw/datasets/${e(id)}`, { method: 'PATCH', body: patch }),
  /** Organization parameters of the dataset and its stored validation (admin, analyst). */
  getDatasetOrg: (id: string, signal?: AbortSignal) => requestJson<DatasetOrgInfo>(`/dw/datasets/${e(id)}/org`, { signal }),
  /** Validates the Business Unit values of the sources against the PIMS master (counts only). */
  validateDatasetOrg: (id: string) =>
    requestJson<{ status: DatasetOrgStatus; validation: DatasetOrgValidation }>(`/dw/datasets/${e(id)}/org-validation`, { method: 'POST', body: {}, loadingLabel: tr('Memvalidasi akses data…') }),
  /** Deletes the dataset definition from DOD; source tables are untouched. */
  deleteDataset: (id: string) => requestJson<void>(`/dw/datasets/${e(id)}`, { method: 'DELETE' }),
  getFieldValues: (datasetId: string, field: string, q?: string, signal?: AbortSignal) =>
    requestJson<{ values: string[]; truncated: boolean }>(`/dw/datasets/${e(datasetId)}/values`, { query: { field, ...(q ? { q } : {}) }, signal }),

  /* Master Kategori → Sub-kategori */
  getCategories: (signal?: AbortSignal) => requestJson<DwCategory[]>('/categories', { signal }),
  createCategory: (body: { name: string; description?: string; parentId: string | null }) => requestJson<DwCategory>('/categories', { method: 'POST', body }),
  updateCategory: (id: string, body: { name?: string; description?: string; sortOrder?: number }) => requestJson<DwCategory>(`/categories/${e(id)}`, { method: 'PATCH', body }),
  deleteCategory: (id: string) => requestJson<void>(`/categories/${e(id)}`, { method: 'DELETE' }),
}
