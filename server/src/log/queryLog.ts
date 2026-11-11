/**
 * Query performance metrics (start, end, duration, rows, source, dataset, status).
 * Written to DOD's metadata DB in small batches so logging never slows a query down.
 * SQL text and parameter values are deliberately not stored.
 */
import type { MetadataDb } from '../db/metadataDb.ts'
import type { Logger } from './logger.ts'

export interface QueryMetric {
  started: Date
  durationMs: number
  connectionId: string
  datasetId: string | null
  userId: string | null
  kind: string
  status: 'ok' | 'error' | 'cancelled'
  rows: number | null
  errorCode: string | null
}

export class QueryLog {
  private buffer: QueryMetric[] = []
  private timer: NodeJS.Timeout | null = null
  private readonly db: MetadataDb
  private readonly log: Logger

  constructor(db: MetadataDb, log: Logger) {
    this.db = db
    this.log = log
  }

  record(m: QueryMetric) {
    this.log.info({ connection: m.connectionId, dataset: m.datasetId, kind: m.kind, status: m.status, durationMs: m.durationMs, rows: m.rows, code: m.errorCode }, 'source query')
    this.buffer.push(m)
    this.timer ??= setTimeout(() => void this.flush(), 1_000)
  }

  async flush() {
    this.timer = null
    const batch = this.buffer.splice(0)
    if (!batch.length) return
    const values: unknown[] = []
    const rows = batch.map((m, i) => {
      values.push(m.started, new Date(m.started.getTime() + m.durationMs), m.durationMs, m.connectionId, m.datasetId, m.userId, m.kind, m.status, m.rows, m.errorCode)
      const b = i * 10
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`
    })
    try {
      await this.db.query(`INSERT INTO dor_query_log (started_at, ended_at, duration_ms, connection_id, dataset_id, user_id, kind, status, rows_returned, error_code) VALUES ${rows.join(',')}`, values)
    } catch (e) {
      this.log.warn({ code: (e as { code?: string }).code, lost: batch.length }, 'query log write failed')
    }
  }

  async recent(limit: number) {
    const r = await this.db.query(
      `SELECT started_at, duration_ms, connection_id, dataset_id, kind, status, rows_returned, error_code FROM dor_query_log ORDER BY started_at DESC LIMIT $1`,
      [limit],
    )
    return r.rows
  }
}
