/**
 * Conditional (where) and distinct measures on real PostgreSQL (TEMP table, rolled back), in every window of one
 * statement, and the refusal of a distinct measure next to a snapshot of the same source.
 *
 * Unit days: U1 B,B,S · U2 S,S,S · U3 R,B,B (01-01..01-03), km on B days.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { SqlBuilder } from '../src/analytics/sqlBuilder.ts'
import { reportWindow } from '../src/analytics/gridService.ts'
import { SemanticModelSchema, validateModel, type SemanticModel } from '../src/datasets/semantic.ts'
import type { TableMetadata } from '../src/dw/metadata.ts'
import { dialectOf } from '../src/dw/sql.ts'

const host = process.env.DOD_DB_HOST
const skip = host ? false : 'set DOD_DB_* (.env) to run the measure SQL test on a TEMP table'

const col = (name: string, dataType: string, typeCategory: 'string' | 'number' | 'date', ordinal: number) => ({ name, ordinal, dataType, typeCategory, nullable: true, defaultValue: null, comment: null, stats: null })
const table = { schema: 'pg_temp', name: 't_status', kind: 'table', estimatedRows: null, totalBytes: null, columnCount: 5, comment: null, lastAnalyzedAt: null, canSelect: true, indexes: [],
  columns: [col('tanggal', 'date', 'date', 1), col('business_unit', 'text', 'string', 2), col('unit', 'text', 'string', 3), col('status', 'text', 'string', 4), col('km', 'numeric', 'number', 5), col('urut', 'numeric', 'number', 6)] } as unknown as TableMetadata

const model = (extra: SemanticModel['measures'] = []): SemanticModel => SemanticModelSchema.parse({
  version: 1,
  sources: [{ alias: 'actual', table: 't_status', label: 'Status', role: 'actual', dateColumn: 'tanggal' }],
  dimensions: [{ id: 'bisnis_unit', label: 'BU', columns: { actual: 'business_unit' } }, { id: 'unit', label: 'Unit', columns: { actual: 'unit' } }, { id: 'status', label: 'Status', columns: { actual: 'status' }, sortColumns: { actual: 'urut' } }],
  measures: [
    { id: 'hari_b', label: 'B', unit: 'hari', decimals: 0, type: 'sum', source: 'actual', column: 'km', where: { dim: 'status', values: ['B'] } },
    { id: 'km', label: 'KM', unit: 'km', decimals: 0, type: 'sum', source: 'actual', column: 'km' },
    { id: 'unit_unik', label: 'Jumlah unit', unit: 'unit', decimals: 0, type: 'distinct', source: 'actual', column: 'unit' },
    { id: 'unit_b', label: 'Unit beroperasi', unit: 'unit', decimals: 0, type: 'distinct', source: 'actual', column: 'unit', where: { dim: 'status', values: ['B'] } },
    ...extra,
  ],
  entity: ['bisnis_unit', 'unit'],
  kpi: { actual: 'km', target: null },
  scopeFields: [],
  filterFields: [],
  defaultLayout: { dimensions: [], measures: ['km'] },
})

describe('conditional and distinct measures on PostgreSQL (TEMP table, rolled back)', { skip }, () => {
  let client: pg.Client
  before(async () => {
    client = new pg.Client({ host, port: Number(process.env.DOD_DB_PORT || 5432), database: process.env.DOD_DB_NAME, user: process.env.DOD_DB_USER, password: process.env.DOD_DB_PASSWORD, application_name: 'dod-test-measures' })
    await client.connect()
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE t_status (tanggal date, business_unit text, unit text, status text, km numeric, urut numeric) ON COMMIT DROP')
    const rows = [['01', 'U1', 'B', 10], ['02', 'U1', 'B', 10], ['03', 'U1', 'S', 0], ['01', 'U2', 'S', 0], ['02', 'U2', 'S', 0], ['03', 'U2', 'S', 0], ['01', 'U3', 'R', 0], ['02', 'U3', 'B', 5], ['03', 'U3', 'B', 5]]
    const ORDER: Record<string, number> = { R: 1, B: 2, S: 3 }
    for (const [d, u, st, km] of rows) await client.query('INSERT INTO t_status VALUES ($1, $2, $3, $4, $5, $6)', [`2026-01-${d}`, 'SAM-1', u, st, km, ORDER[st as string]])
  })
  after(async () => {
    await client?.query('ROLLBACK').catch(() => undefined)
    await client?.end()
  })

  test('where counts only the matching rows; distinct counts unique values; per window', async () => {
    const b = new SqlBuilder(model(), 'pg_temp', [table], dialectOf('postgresql'))
    const windows = [{ id: 'cur', from: '2026-01-01', to: '2026-01-03' }, reportWindow('hi', '2026-01-03'), reportWindow('sdhi', '2026-01-02')]
    const q = b.build({ dims: [], groupingSets: [[]], measures: ['hari_b', 'km', 'unit_unik', 'unit_b'], windows, filters: [], scope: { kind: 'all' } as never, limit: 10 })
    const r = (await client.query(q.sql, q.params)).rows[0] as Record<string, unknown>
    const v = (id: string, w: string) => Number(r[q.col(id, w)])
    // KM on B days only = all km here (km is 0 on S/R days); unique units in the window; units with a B day.
    assert.deepEqual([v('hari_b', 'cur'), v('km', 'cur'), v('unit_unik', 'cur'), v('unit_b', 'cur')], [30, 30, 3, 2])
    assert.deepEqual([v('unit_unik', 'hi'), v('unit_b', 'hi')], [3, 1], '01-03: only U3 is B')
    assert.deepEqual([v('unit_b', 'sdhi')], [2], '01-01..01-02: U1 and U3')
  })

  test('distinct per row group (subtotals are not sums of the rows)', async () => {
    const b = new SqlBuilder(model(), 'pg_temp', [table], dialectOf('postgresql'))
    const q = b.build({ dims: ['status'], groupingSets: [[0], []], measures: ['unit_unik'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-01-03' }, { id: 'prev', from: '2025-01-01', to: '2025-01-03' }], filters: [], scope: { kind: 'all' } as never, limit: 10 })
    const rows = (await client.query(q.sql, q.params)).rows as Record<string, unknown>[]
    const by = Object.fromEntries(rows.map((x) => [String(x.d0 ?? 'TOTAL'), Number(x[q.col('unit_unik', 'cur')])]))
    assert.deepEqual(by, { B: 2, R: 1, S: 2, TOTAL: 3 }, 'total 3 units, not 2 + 1 + 2')
  })

  test('a condition on an unmapped dimension, a non-SUM prorata part and distinct with a snapshot are refused', async () => {
    const bad = validateModel(model([{ id: 'x', label: 'X', unit: '', decimals: 0, type: 'sum', source: 'actual', column: 'km', where: { dim: 'tidak_ada', values: ['B'] } }]), [table])
    assert.ok(bad.some((m) => /syarat memakai dimensi "tidak_ada"/.test(m)), bad.join(' | '))
    const pr = validateModel(model([{ id: 'p', label: 'P', unit: '', decimals: 0, type: 'prorate', budget: 'unit_unik', workdays: 'km' }]), [table])
    assert.ok(pr.some((m) => /harus measure SUM/.test(m)), pr.join(' | '))
    const withSnap = new SqlBuilder(model([{ id: 's', label: 'S', unit: '', decimals: 0, type: 'snapshot', source: 'actual', column: 'km' }]), 'pg_temp', [table], dialectOf('postgresql'))
    assert.throws(() => withSnap.build({ dims: [], groupingSets: [[]], measures: ['s', 'unit_unik'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-01-03' }], filters: [], scope: { kind: 'all' } as never, limit: 10 }), /hitung unik tidak dapat ditampilkan bersama measure snapshot/)
  })

  test('sort key of a dimension: the smallest key of each group; a model without one keeps its statement', async () => {
    const b = new SqlBuilder(model(), 'pg_temp', [table], dialectOf('postgresql'))
    const q = b.build({ dims: ['status'], groupingSets: [[0]], measures: ['km'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-01-03' }, { id: 'prev', from: '2025-01-01', to: '2025-01-03' }], filters: [], scope: { kind: 'all' } as never, limit: 10 })
    assert.equal(q.sortCol(0), 's0')
    const rows = (await client.query(q.sql, q.params)).rows as Record<string, unknown>[]
    assert.deepEqual(Object.fromEntries(rows.map((x) => [x.d0, Number(x.s0)])), { B: 2, R: 1, S: 3 })
    const plain = SemanticModelSchema.parse({ ...model(), dimensions: model().dimensions.map((d) => ({ ...d, sortColumns: undefined })) })
    const q2 = new SqlBuilder(plain, 'pg_temp', [table], dialectOf('postgresql')).build({ dims: ['status'], groupingSets: [[0]], measures: ['km'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-01-03' }], filters: [], scope: { kind: 'all' } as never, limit: 10 })
    assert.equal(q2.sortCol(0), null)
    assert.ok(!/s0/.test(q2.sql), 'no sort column in the statement')
  })

  test('the whole-month window of a report date', () => {
    assert.deepEqual(reportWindow('mon', '2026-02-11'), { id: 'mon', from: '2026-02-01', to: '2026-02-28' })
    assert.deepEqual(reportWindow('mon', '2028-02-11'), { id: 'mon', from: '2028-02-01', to: '2028-02-29' })
  })
})
