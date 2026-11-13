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

  /**
   * Settings › Log Query: the entries of a period (from/to are calendar dates, `to` included) with optional filters,
   * newest first, one page at a time, plus a summary of the whole filtered set and the kinds seen in the period.
   * Every value is a bind parameter. User and dataset names come from DOD's own tables (no source access).
   */
  async search(f: QueryLogFilter) {
    await this.flush()
    const where: string[] = ['l.started_at >= $1::date', 'l.started_at < $2::date + 1']
    const values: unknown[] = [f.from, f.to]
    const add = (sql: string, v: unknown) => { values.push(v); where.push(sql.replace('?', `$${values.length}`)) }
    if (f.status) add('l.status = ?', f.status)
    if (f.kind) add('l.kind = ?', f.kind)
    if (f.userId) add('l.user_id = ?', f.userId)
    if (f.datasetId) add('l.dataset_id = ?', f.datasetId)
    if (f.minDurationMs) add('l.duration_ms >= ?', f.minDurationMs)
    const w = where.join(' AND ')
    const base = values.length
    const [items, summary, kinds] = await Promise.all([
      this.db.query<QueryLogRow>(
        `SELECT l.id, l.started_at, l.duration_ms, l.connection_id, l.dataset_id, d.name AS dataset_name, l.user_id, u.username, u.name AS user_name,
                l.kind, l.status, l.rows_returned, l.error_code
           FROM dor_query_log l LEFT JOIN dor_user u ON u.id = l.user_id LEFT JOIN dor_dataset d ON d.id = l.dataset_id
          WHERE ${w} ORDER BY l.started_at DESC, l.id DESC LIMIT $${base + 1} OFFSET $${base + 2}`,
        [...values, f.limit, f.offset],
      ),
      this.db.query<{ n: string; errors: string; cancelled: string; p50: number | null; p95: number | null; max: number | null }>(
        `SELECT count(*) AS n, count(*) FILTER (WHERE l.status = 'error') AS errors, count(*) FILTER (WHERE l.status = 'cancelled') AS cancelled,
                percentile_disc(0.5) WITHIN GROUP (ORDER BY l.duration_ms) AS p50, percentile_disc(0.95) WITHIN GROUP (ORDER BY l.duration_ms) AS p95,
                max(l.duration_ms) AS max
           FROM dor_query_log l WHERE ${w}`,
        values,
      ),
      this.db.query<{ kind: string }>(`SELECT DISTINCT kind FROM dor_query_log l WHERE l.started_at >= $1::date AND l.started_at < $2::date + 1 ORDER BY kind`, [f.from, f.to]),
    ])
    const s = summary.rows[0]!
    return {
      items: items.rows.map((r) => ({
        id: String(r.id),
        startedAt: r.started_at.toISOString(),
        durationMs: r.duration_ms,
        connectionId: r.connection_id,
        datasetId: r.dataset_id,
        datasetName: r.dataset_name,
        userId: r.user_id,
        username: r.username,
        userName: r.user_name,
        kind: r.kind,
        status: r.status,
        rows: r.rows_returned,
        errorCode: r.error_code,
      })),
      total: Number(s.n),
      summary: { count: Number(s.n), errors: Number(s.errors), cancelled: Number(s.cancelled), p50Ms: s.p50, p95Ms: s.p95, maxMs: s.max },
      kinds: kinds.rows.map((r) => r.kind),
    }
  }
}

export interface QueryLogFilter {
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

interface QueryLogRow {
  id: string | number
  started_at: Date
  duration_ms: number
  connection_id: string
  dataset_id: string | null
  dataset_name: string | null
  user_id: string | null
  username: string | null
  user_name: string | null
  kind: string
  status: string
  rows_returned: number | null
  error_code: string | null
}
