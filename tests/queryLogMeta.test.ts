/** Settings › Log Query labels: every query kind the server code records has a readable label (no raw codes). */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { KIND_LABELS, kindLabel, periodRange } from '../src/pages/Settings/queryLog/queryLogMeta.ts'

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [] })

test('every literal query kind in the server code has a label', () => {
  const kinds = new Set<string>()
  for (const f of walk(new URL('../server/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const s = readFileSync(f, 'utf8')
    // kind: 'x.y' in a query call, exec(..., 'x.y'), ping(c, 'x')
    for (const m of s.matchAll(/kind: '([a-z_]+\.[a-z_.]+)'/g)) kinds.add(m[1]!)
    for (const m of s.matchAll(/exec\([^)]*'([a-z_]+\.[a-z_]+)'\)/g)) kinds.add(m[1]!)
    for (const m of s.matchAll(/this\.ping\(c, '([a-z_.]+)'\)/g)) kinds.add(m[1]!)
  }
  assert.ok(kinds.size >= 6, [...kinds].join(','))
  for (const k of kinds) assert.ok(KIND_LABELS[k], `no label for ${k}`)
})

test('metadata reads and kinds of older versions are named, never shown as a bare code', () => {
  assert.equal(kindLabel('metadata.columns'), 'Metadata sumber: kolom')
  assert.match(kindLabel('c3.ab'), /^Versi lama \(c3\.ab\)$/)
})

test('periods: today, last 7 / 30 days including today, in local dates', () => {
  const now = new Date(2026, 10, 13, 9, 0)
  assert.deepEqual(periodRange('today', now), { from: '2026-11-13', to: '2026-11-13' })
  assert.deepEqual(periodRange('7', now), { from: '2026-11-07', to: '2026-11-13' })
  assert.deepEqual(periodRange('30', now), { from: '2026-10-15', to: '2026-11-13' })
})
