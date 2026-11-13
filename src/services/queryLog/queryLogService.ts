/** Settings › Log Query: the source queries DOD ran (administrators; menu settings.querylog). */
import { requestJson } from '@/services/api/apiClient'

export interface QueryLogQuery {
  from: string
  to: string
  status?: 'ok' | 'error' | 'cancelled'
  kind?: string
  userId?: string
  datasetId?: string
  minDurationMs?: number
  limit: number
  offset: number
}
export interface QueryLogEntry {
  id: string
  startedAt: string
  durationMs: number
  connectionId: string
  connectionName: string
  datasetId: string | null
  datasetName: string | null
  userId: string | null
  username: string | null
  userName: string | null
  kind: string
  status: 'ok' | 'error' | 'cancelled'
  rows: number | null
  errorCode: string | null
}
export interface QueryLogPage {
  items: QueryLogEntry[]
  total: number
  summary: { count: number; errors: number; cancelled: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null }
  kinds: string[]
}

export const queryLogService = {
  search: (q: QueryLogQuery, signal?: AbortSignal) =>
    requestJson<QueryLogPage>('/dw/query-log', { query: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])), signal, silent: true }),
}
