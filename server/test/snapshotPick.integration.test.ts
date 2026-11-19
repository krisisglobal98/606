/**
 * Snapshot measures on real PostgreSQL (TEMP table, rolled back): pick 'max' (default, unchanged) vs 'last'
 * (the value on each entity's latest date in the window, 0 included), in every period window of one statement.
 *
 * Daily unit status like Traksi mart_unit_harian: one row per unit per day, standby = 1/0.
 *   U1 standby on 01-01 and 01-02, running on 01-03;  U2 standby every day;  U3 down on 01-01, running after.
 * On report date 01-03: standby H.I = 1 (U2). 'max' over 01-01..01-03 counts every unit ever standby = 2.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { SqlBuilder } from '../src/analytics/sqlBuilder.ts'
import type { SemanticModel } from '../src/datasets/semantic.ts'
import type { TableMetadata } from '../src/dw/metadata.ts'
import { dialectOf } from '../src/dw/sql.ts'

const host = process.env.DOD_DB_HOST
const skip = host ? false : 'set DOD_DB_* (.env) to run the snapshot SQL test on a TEMP table'

const col = (name: string, dataType: string, typeCategory: 'string' | 'number' | 'date', ordinal: number) => ({ name, ordinal, dataType, typeCategory, nullable: true, defaultValue: null, comment: null, stats: null })
const table = { schema: 'pg_temp', name: 't_unit', kind: 'table', estimatedRows: null, totalBytes: null, columnCount: 4, comment: null, lastAnalyzedAt: null, canSelect: true, indexes: [],
  columns: [col('tanggal', 'date', 'date', 1), col('business_unit', 'text', 'string', 2), col('unit', 'text', 'string', 3), col('n_standby', 'numeric', 'number', 4)] } as unknown as TableMetadata

const model = (pick?: 'max' | 'last'): SemanticModel => ({
  version: 1,
  sources: [{ alias: 'actual', table: 't_unit', label: 'Unit', role: 'actual', dateColumn: 'tanggal' }],
  dimensions: [{ id: 'bisnis_unit', label: 'BU', columns: { actual: 'business_unit' } }, { id: 'unit', label: 'Unit', columns: { actual: 'unit' } }],
  measures: [
    { id: 'standby', label: 'Standby', unit: 'unit', decimals: 0, type: 'snapshot', source: 'actual', column: 'n_standby', ...(pick ? { pick } : {}) },
    { id: 'standby_hari', label: 'Standby hari', unit: 'hari', decimals: 0, type: 'sum', source: 'actual', column: 'n_standby' },
  ],
  entity: ['bisnis_unit', 'unit'],
  kpi: { actual: 'standby', target: null },
  scopeFields: [],
  filterFields: [],
  defaultLayout: { dimensions: [], measures: ['standby'] },
} as SemanticModel)

describe('snapshot pick on PostgreSQL (TEMP table, rolled back)', { skip }, () => {
  let client: pg.Client
  before(async () => {
    client = new pg.Client({ host, port: Number(process.env.DOD_DB_PORT || 5432), database: process.env.DOD_DB_NAME, user: process.env.DOD_DB_USER, password: process.env.DOD_DB_PASSWORD, application_name: 'dod-test-snapshot' })
    await client.connect()
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE t_unit (tanggal date, business_unit text, unit text, n_standby numeric) ON COMMIT DROP')
    const rows = [
      ['2026-01-01', 'U1', 1], ['2026-01-02', 'U1', 1], ['2026-01-03', 'U1', 0],
      ['2026-01-01', 'U2', 1], ['2026-01-02', 'U2', 1], ['2026-01-03', 'U2', 1],
      ['2026-01-01', 'U3', 0], ['2026-01-02', 'U3', 0], ['2026-01-03', 'U3', 0],
    ]
    for (const [d, u, v] of rows) await client.query('INSERT INTO t_unit VALUES ($1, $2, $3, $4)', [d, 'SAM-1', u, v])
  })
  after(async () => {
    await client?.query('ROLLBACK').catch(() => undefined)
    await client?.end()
  })

  const run = async (pick: 'max' | 'last' | undefined, dims: string[] = []) => {
    const b = new SqlBuilder(model(pick), 'pg_temp', [table], dialectOf('postgresql'))
    const windows = [{ id: 'cur', from: '2026-01-01', to: '2026-01-03' }, { id: 'hi', from: '2026-01-03', to: '2026-01-03' }, { id: 'd2', from: '2026-01-01', to: '2026-01-02' }]
    const q = b.build({ dims, groupingSets: [[]], measures: ['standby', 'standby_hari'], windows, filters: [], scope: { kind: 'all' } as never, limit: 100 })
    const r = (await client.query(q.sql, q.params)).rows[0] as Record<string, unknown>
    return Object.fromEntries(windows.map((w) => [w.id, [Number(r[q.col('standby', w.id)]), Number(r[q.col('standby_hari', w.id)])]]))
  }

  test("default (no pick) and 'max' keep today's result: every unit ever standby in the window", async () => {
    assert.deepEqual(await run(undefined), { cur: [2, 5], hi: [1, 1], d2: [2, 4] })
    assert.deepEqual(await run('max'), { cur: [2, 5], hi: [1, 1], d2: [2, 4] })
  })

  test("'last': the value on each unit's latest date of the window, 0 included", async () => {
    // cur ends 01-03: only U2 is standby that day. d2 ends 01-02: U1 and U2. The SUM measure is not affected.
    assert.deepEqual(await run('last'), { cur: [1, 5], hi: [1, 1], d2: [2, 4] })
  })
})
