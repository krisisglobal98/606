import { request } from '@/services/api/apiClient'
import {
  AnalyticsResultSchema,
  GridResponseSchema,
  type GridRequest,
  type GridResponse,
  type AnalyticsQuery,
  type AnalyticsResult,
} from '@/types/contracts'

export const analyticsService = {
  /** The DOD backend aggregates in the source database and returns only the result. */
  query: (q: AnalyticsQuery, signal?: AbortSignal): Promise<AnalyticsResult> =>
    request('/dw/analytics/query', { method: 'POST', body: q, schema: AnalyticsResultSchema, signal }),
  /** One level of the result hierarchy (lazy expansion). */
  grid: (req: GridRequest, signal?: AbortSignal): Promise<GridResponse> =>
    request('/dw/analytics/grid', { method: 'POST', body: req, schema: GridResponseSchema, signal }),
}
