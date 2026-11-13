/** Settings › Log Query: menu permission of the API, and the search built with bind parameters only. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MENU, requiredMenus } from '../src/access/menus.ts'
import { QueryLog } from '../src/log/queryLog.ts'
import { createLogger } from '../src/log/logger.ts'

test('the query log API needs the admin-only menu Log Query', () => {
  assert.deepEqual(requiredMenus('GET', '/api/dw/query-log'), [['settings.querylog']])
  const m = MENU.get('settings.querylog')!
  assert.deepEqual([m.parent, [...m.roles]], ['settings', ['admin']])
})

test('search: every filter is a bind parameter, newest first, paged; summary over the same filter', async () => {
  const calls: { sql: string; values: unknown[] }[] = []
  const db = {
    query: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values })
      if (sql.includes('percentile_disc')) return { rows: [{ n: '3', errors: '1', cancelled: '0', p50: 12, p95: 40, max: 41 }] }
      if (sql.includes('DISTINCT kind')) return { rows: [{ kind: 'analytics.grid' }] }
      if (sql.includes('LEFT JOIN')) return { rows: [{ id: 7, started_at: new Date('2026-11-13T01:00:00Z'), duration_ms: 12, connection_id: 'c', dataset_id: 'd', dataset_name: 'D', user_id: 'u', username: 'x', user_name: 'X', kind: 'analytics.grid', status: 'error', rows_returned: null, error_code: 'SOURCE_TIMEOUT' }] }
      return { rows: [] }
    },
  }
  const log = new QueryLog(db as never, createLogger('silent', false))
  const evil = "x' OR 1=1 --"
  const r = await log.search({ from: '2026-11-01', to: '2026-11-13', status: 'error', kind: 'analytics.grid', userId: evil, datasetId: 'd', minDurationMs: 10, limit: 50, offset: 100 })
  const list = calls.find((c) => c.sql.includes('LEFT JOIN'))!
  assert.ok(!list.sql.includes(evil) && list.values.includes(evil), 'the user id is a parameter, never SQL text')
  assert.match(list.sql, /ORDER BY l\.started_at DESC, l\.id DESC LIMIT \$\d+ OFFSET \$\d+/)
  assert.deepEqual(list.values.slice(-2), [50, 100])
  const sum = calls.find((c) => c.sql.includes('percentile_disc'))!
  assert.deepEqual(sum.values, list.values.slice(0, -2), 'the summary uses exactly the same filter')
  assert.deepEqual([r.total, r.summary.errors, r.summary.p95Ms, r.items[0]!.status, r.items[0]!.errorCode, r.kinds], [3, 1, 40, 'error', 'SOURCE_TIMEOUT', ['analytics.grid']])
})
