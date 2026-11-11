/**
 * Daily time dimension `hari`: the SQL expression in both dialects, its place among the time
 * dimensions, and the display label. Pure unit tests: no database is touched.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { valueLabel } from '../src/analytics/analyticsService.ts'
import { SqlBuilder } from '../src/analytics/sqlBuilder.ts'
import { isTimeDim, TIME_DIMENSIONS, validateModel, type SemanticModel } from '../src/datasets/semantic.ts'
import type { TableMetadata } from '../src/dw/metadata.ts'
import { dialectOf } from '../src/dw/sql.ts'

const model: SemanticModel = {
  version: 1,
  sources: [{ alias: 'actual', table: 'produksi', label: 'Aktual', role: 'actual', dateColumn: 'tanggal' }],
  dimensions: [{ id: 'pt', label: 'PT', columns: { actual: 'pt' } }],
  measures: [{ id: 'ton', label: 'Ton', unit: 'Ton', decimals: 1, type: 'sum', source: 'actual', column: 'ton' }],
  entity: [],
  kpi: { actual: 'ton', target: null },
  scopeFields: [],
  filterFields: [],
  defaultLayout: { dimensions: ['pt'], measures: ['ton'] },
}
const col = (name: string, dataType: string, typeCategory: 'string' | 'number' | 'date') => ({ name, dataType, typeCategory, ordinal: 0, nullable: true, defaultValue: null, comment: null, stats: null })
const tables = [{ name: 'produksi', columns: [col('tanggal', 'date', 'date'), col('pt', 'text', 'string'), col('ton', 'numeric', 'number')], indexes: [] }] as unknown as TableMetadata[]

describe('daily time dimension', () => {
  test('is a time dimension that a model may use but not redefine', () => {
    assert.ok(isTimeDim('hari'))
    assert.ok(TIME_DIMENSIONS.some((t) => t.id === 'hari'))
    assert.deepEqual(validateModel({ ...model, defaultLayout: { dimensions: ['hari'], measures: ['ton'] } }, tables), [])
    const clash = validateModel({ ...model, dimensions: [...model.dimensions, { id: 'hari', label: 'Hari', columns: { actual: 'pt' } }] }, tables)
    assert.ok(clash.some((p) => p.includes('"hari"')))
  })

  test('groups by the calendar day in PostgreSQL', () => {
    const b = new SqlBuilder(model, 'public', tables, dialectOf('postgresql'))
    const q = b.build({ dims: ['hari'], groupingSets: [[0]], measures: ['ton'], windows: [{ id: 'cur', from: '2026-10-01', to: '2026-10-16' }], filters: [], scope: { kind: 'all', fingerprint: 'all' }, limit: 100 })
    assert.match(q.sql, /to_char\("tanggal", 'YYYY-MM-DD'\) AS d0/)
    assert.deepEqual(q.params, ['2026-10-01', '2026-10-16'])
  })

  test('groups by the calendar day in ClickHouse', () => {
    const b = new SqlBuilder(model, 'db', tables, dialectOf('clickhouse'))
    const q = b.build({ dims: ['hari'], groupingSets: [[0]], measures: ['ton'], windows: [{ id: 'cur', from: '2026-10-01', to: '2026-10-16' }], filters: [], scope: { kind: 'all', fingerprint: 'all' }, limit: 100 })
    assert.match(q.sql, /formatDateTime\("tanggal", '%Y-%m-%d'\) AS d0/)
  })

  test('month: grouped as a DATE inside the statement, output as YYYY-MM-01 text (PostgreSQL)', () => {
    const b = new SqlBuilder(model, 'public', tables, dialectOf('postgresql'))
    const q = b.build({ dims: ['tanggal', 'pt'], groupingSets: [[0, 1], [0], []], measures: ['ton'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-10-16' }], filters: [], scope: { kind: 'all', fingerprint: 'all' }, limit: 100 })
    assert.match(q.sql, /actual_r AS \(SELECT date_trunc\('month', "tanggal"\)::date AS d0, "pt" AS d1/)
    assert.match(q.sql, /actual_a AS \(SELECT to_char\(d0, 'YYYY-MM-01'\) AS d0, d1, GROUPING\(d0, d1\) AS g/)
    assert.match(q.sql, /GROUP BY GROUPING SETS \(\(d0, d1\), \(d0\), \(\)\)/)
  })

  test('month in ClickHouse: unchanged text form', () => {
    const b = new SqlBuilder(model, 'db', tables, dialectOf('clickhouse'))
    const q = b.build({ dims: ['tanggal'], groupingSets: [[0]], measures: ['ton'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-10-16' }], filters: [], scope: { kind: 'all', fingerprint: 'all' }, limit: 100 })
    assert.match(q.sql, /formatDateTime\(toStartOfMonth\("tanggal"\), '%Y-%m-01'\) AS d0/)
    assert.match(q.sql, /actual_a AS \(SELECT d0, /)
  })

  test('labels a day as "16 Okt 2026"', () => {
    assert.equal(valueLabel('hari', '2026-10-16'), '16 Okt 2026')
    assert.equal(valueLabel('hari', null), '(kosong)')
  })
})
