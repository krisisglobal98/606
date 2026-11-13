/**
 * Organization validation of a dataset (K-13): the Business Unit values of every source are counted and compared with
 * the PIMS master (counts only, no row reaches DOD). The result is stored for this version of the dataset; until then
 * (and after any change of the dataset) scoped users get no data from it.
 *
 * Run by the "Validasi akses data" button, and automatically after a dataset is created or changed.
 */
import type { Container } from '../container.ts'
import type { DatasetRecord } from '../datasets/datasetService.ts'
import { SqlBuilder } from '../analytics/sqlBuilder.ts'
import { dialectOf, quoteIdent } from '../dw/sql.ts'
import { AppError } from '../http/errors.ts'
import { datasetOrgProfile, datasetOrgStatus, validateUnitValues, type DatasetOrgStatus } from './datasetOrg.ts'

type Deps = Pick<Container, 'datasets' | 'dataAccess' | 'query' | 'config'>

export async function validateDatasetOrg(k: Deps, d: DatasetRecord, userId: string, signal?: AbortSignal) {
  const profile = datasetOrgProfile(d.semantic)
  if (profile.standardProblem) throw new AppError(409, 'DATASET_NOT_STANDARD', profile.standardProblem.message)
  const snapshot = await k.dataAccess.snapshots.get()
  const tables = await k.datasets.tables(d.connectionId, d.schema, d.semantic.sources.map((s) => s.table), signal)
  const b = new SqlBuilder(d.semantic, d.schema, tables, dialectOf(k.datasets.connection(d.connectionId).dbType))
  const counts: Record<string, { value: string | null; rows: number }[]> = {}
  for (const s of d.semantic.sources) {
    const e = b.dimExpr(s, profile.businessUnit!.dim)!
    const r = await k.query.execute({ connectionId: d.connectionId, sql: `SELECT ${e} AS v, count(*) AS n FROM ${quoteIdent(d.schema)}.${quoteIdent(s.table)} GROUP BY 1`, params: [], kind: 'dataset.org_validation', datasetId: d.id, userId, timeoutMs: k.config.limits.analyticsTimeoutMs }, signal)
    counts[s.alias] = r.rows.map((x) => ({ value: x.v == null ? null : String(x.v), rows: Number(x.n) }))
  }
  const result = validateUnitValues(counts, new Set([...snapshot.units.values()].map((x) => x.code)))
  await k.dataAccess.storeValidation(d, result, userId)
  return { status: datasetOrgStatus(profile, { status: result.status, datasetUpdatedAt: d.updatedAt }, d.updatedAt), validation: result }
}

/**
 * After a dataset is saved: validate at once, so it is usable without a separate step. A failure never undoes the
 * save; the dataset stays "belum divalidasi" and the reason is returned for the screen.
 */
export async function autoValidateDatasetOrg(k: Deps, d: DatasetRecord, userId: string, signal?: AbortSignal): Promise<{ status: DatasetOrgStatus; error: string | null }> {
  try {
    const r = await validateDatasetOrg(k, d, userId, signal)
    return { status: r.status, error: null }
  } catch (e) {
    const status = datasetOrgStatus(datasetOrgProfile(d.semantic), null, d.updatedAt)
    return { status, error: e instanceof AppError ? e.message : 'Validasi akses data gagal dijalankan.' }
  }
}
