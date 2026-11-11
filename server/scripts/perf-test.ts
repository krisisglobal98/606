/**
 * Large-data test: 10k → 3M source rows through the real API.
 *
 * For each target size it picks the most recent date window that holds at least that many rows in
 * the dataset's actual table, runs the Analysis query (Region × Month, SUM produksi, budget,
 * achievement) through HTTP, and records database time, API time, payload size and JSON parse time.
 * It proves the browser-facing payload stays bounded while the source volume grows.
 *
 *   DOD_PERF_DATASET=wh-xxxx DOD_PERF_PASSWORD=... npm run perf
 *
 * Optional: DOD_PERF_BASE (default http://127.0.0.1:DOD_API_PORT, 8181), DOD_PERF_USER (default admin),
 * DOD_PERF_SIZES (comma list, default 10000,100000,500000,1000000,3000000).
 */
import { loadConfig } from '../src/config/config.ts'
import { createContainer } from '../src/container.ts'
import { quoteIdent } from '../src/dw/sql.ts'
import { createLogger } from '../src/log/logger.ts'

const base = process.env.DOD_PERF_BASE ?? `http://127.0.0.1:${loadConfig(process.env).api.port}`
const datasetId = process.env.DOD_PERF_DATASET
const password = process.env.DOD_PERF_PASSWORD ?? process.env.DOD_ADMIN_PASSWORD
const sizes = (process.env.DOD_PERF_SIZES ?? '10000,100000,500000,1000000,3000000').split(',').map(Number)
if (!datasetId || !password) {
  console.error('Set DOD_PERF_DATASET (dataset id) and DOD_PERF_PASSWORD (DOD login password).')
  process.exit(1)
}

const config = loadConfig()
const k = createContainer(config, createLogger('warn', false))
const d = await k.datasets.get(datasetId)
const src = d.semantic.sources.find((s) => s.role === 'actual') ?? d.semantic.sources[0]!
const conn = k.dw.config(d.connectionId)

// Rows per day of the actual table: one bounded GROUP BY (a few hundred rows back).
const days = (
  await k.sources.run<{ d: string; n: number }>(conn, `SELECT to_char(${quoteIdent(src.dateColumn)}, 'YYYY-MM-DD') AS d, count(*)::int8 AS n FROM ${quoteIdent(d.schema)}.${quoteIdent(src.table)} GROUP BY 1 ORDER BY 1 DESC`, [], { kind: 'perf.days', timeoutMs: 120_000 })
).rows
const total = days.reduce((a, x) => a + Number(x.n), 0)
const last = days[0]!.d

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.DOD_PERF_USER ?? 'admin', password }) })
if (!login.ok) throw new Error(`login failed: ${login.status}`)
const { token } = (await login.json()) as { token: string }

console.log(`Dataset ${d.name} · ${src.table}: ${total.toLocaleString('id-ID')} rows, ${days.length} days, last ${last}\n`)
console.log('| Target | Window | Source rows (aktual+budget) | DB+API (server) | HTTP total | Payload | JSON parse | Result rows |')
console.log('|---|---|---|---|---|---|---|---|')
for (const target of sizes) {
  let acc = 0
  let from = days.at(-1)!.d
  for (const x of days) {
    acc += Number(x.n)
    if (acc >= target) {
      from = x.d
      break
    }
  }
  const body = { datasetId, scope: {}, filter: { dateFrom: from, dateTo: last }, dimensions: ['region', 'tanggal'], measures: [d.semantic.kpi.actual, ...(d.semantic.kpi.target ? [d.semantic.kpi.target] : []), ...(d.semantic.measures.some((m) => m.id === 'achievement') ? ['achievement'] : [])], chartBy: 'trend' }
  const t0 = performance.now()
  const res = await fetch(`${base}/api/dw/analytics/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const text = await res.text()
  const t1 = performance.now()
  const json = JSON.parse(text) as { execution?: { durationMs: number; sourceRows: number; resultRows: number }; error?: { message: string } }
  const t2 = performance.now()
  if (!res.ok || !json.execution) {
    console.log(`| ${target.toLocaleString('id-ID')} | ${from} → ${last} | gagal: ${json.error?.message ?? res.status} | | | | | |`)
    continue
  }
  const e = json.execution
  console.log(`| ${target.toLocaleString('id-ID')} | ${from} → ${last} | ${e.sourceRows.toLocaleString('id-ID')} | ${e.durationMs} ms | ${Math.round(t1 - t0)} ms | ${(text.length / 1024).toFixed(1)} KB | ${(t2 - t1).toFixed(1)} ms | ${e.resultRows} |`)
}

await k.queryLog.flush()
await k.sources.closeAll()
await k.db.close()
