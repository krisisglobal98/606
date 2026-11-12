/**
 * Data access is decided before anything touches the source: a refused user gets the refusal (audited by rowScope),
 * never a source metadata lookup or a source error (Tahap H: a refused dataset whose connection was missing answered
 * 404 "Koneksi data warehouse tidak ditemukan" instead of the refusal, and the refusal was not audited).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AnalyticsService } from '../src/analytics/analyticsService.ts'
import type { User } from '../src/auth/authService.ts'
import type { DatasetService } from '../src/datasets/datasetService.ts'
import { AppError } from '../src/http/errors.ts'

const user: User = { id: 'u', username: 'u', name: 'U', role: 'viewer' }
const dataset = { id: 'ds', status: 'active', connectionId: 'gone', schema: 's', updatedAt: '2026-01-01T00:00:00Z', semantic: { sources: [{ table: 't' }], dimensions: [{ id: 'bu' }], measures: [] } }

function service(refuse: boolean) {
  const calls: string[] = []
  const datasets = {
    get: async () => (calls.push('get'), dataset),
    tables: async () => {
      calls.push('tables')
      throw new AppError(404, 'NOT_FOUND', 'Koneksi data warehouse tidak ditemukan.')
    },
    connection: () => ({ dbType: 'postgresql' }),
  } as unknown as DatasetService
  const access = {
    rowScope: async () => {
      calls.push('rowScope')
      if (refuse) throw new AppError(409, 'DATASET_NOT_STANDARD', 'Tabel belum standar.')
      return { scope: {}, rows: { kind: 'all' } }
    },
  }
  return { calls, svc: new AnalyticsService(datasets, {} as never, { limits: {} } as never, access as never) }
}

const query = { datasetId: 'ds', scope: {}, filter: { dateFrom: '2026-01-01', dateTo: '2026-01-31' }, dimensions: ['bu'], measures: ['m'], chartBy: 'bu' }

test('query: a refused user gets the refusal and the source is never looked up', async () => {
  const { svc, calls } = service(true)
  await assert.rejects(svc.query(query, undefined, user), (e: AppError) => e.code === 'DATASET_NOT_STANDARD')
  assert.deepEqual(calls, ['get', 'rowScope'])
})

test('values: same order; an unknown field is still reported first (no source access either)', async () => {
  const refused = service(true)
  await assert.rejects(refused.svc.values('ds', 'bu', null, undefined, user), (e: AppError) => e.code === 'DATASET_NOT_STANDARD')
  assert.deepEqual(refused.calls, ['get', 'rowScope'])
  const unknown = service(true)
  await assert.rejects(unknown.svc.values('ds', 'nope', null, undefined, user), (e: AppError) => e.code === 'UNKNOWN_DIMENSION')
  assert.deepEqual(unknown.calls, ['get'])
})

test('an allowed user: access first, then the source metadata', async () => {
  const { svc, calls } = service(false)
  await assert.rejects(svc.query(query, undefined, user), (e: AppError) => e.code === 'NOT_FOUND')
  assert.deepEqual(calls, ['get', 'rowScope', 'tables'])
})
