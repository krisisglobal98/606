/**
 * Query engine over the live sources: runs the statements DOD's SQL builder generates (never user SQL)
 * on a PostgreSQL or ClickHouse connection of .env, read-only and with the analytics timeout.
 */
import type { Config } from '../config/config.ts'
import { badRequest } from '../http/errors.ts'
import type { QueryEngine, EngineQuery, EngineResult } from './queryEngine.ts'
import type { SourceRegistry } from './sourceRegistry.ts'

/** Runs DOD-generated statements on a live source (PostgreSQL or ClickHouse), in the source's dialect. */
export class SourceQueryService implements QueryEngine {
  readonly kind = 'source' as const
  private readonly src: SourceRegistry
  private readonly config: Config

  constructor(src: SourceRegistry, config: Config) {
    this.src = src
    this.config = config
  }

  /** QueryEngine: executes a statement produced by DOD's SQL builder (never user SQL). */
  async execute(q: EngineQuery, signal?: AbortSignal): Promise<EngineResult> {
    const c = this.src.get(q.connectionId)
    if (!c) throw badRequest('UNKNOWN_CONNECTION', 'Koneksi sumber tidak dikenal.')
    const res = await this.src.run(c, q.sql, q.params, { kind: q.kind, timeoutMs: q.timeoutMs ?? this.config.limits.analyticsTimeoutMs, signal, datasetId: q.datasetId, userId: q.userId })
    return { rows: res.rows, durationMs: res.durationMs }
  }
}
