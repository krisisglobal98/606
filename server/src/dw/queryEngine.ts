/**
 * Query engine abstraction. The analytics layer builds a statement for an engine's dialect and
 * hands it over; the frontend never knows which engine answered.
 *
 *   Analytics query ─▶ SQL builder (dialect) ─▶ QueryEngine ─▶ live source: PostgreSQL / ClickHouse
 */
export interface EngineQuery {
  connectionId: string
  sql: string
  params: unknown[]
  /** Metric label, e.g. "analytics.main". */
  kind: string
  timeoutMs?: number
  datasetId?: string | null
  userId?: string | null
}

export interface EngineResult {
  rows: Record<string, unknown>[]
  durationMs: number
}

export interface QueryEngine {
  readonly kind: 'source'
  execute(q: EngineQuery, signal?: AbortSignal): Promise<EngineResult>
}
