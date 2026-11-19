import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/services/api/apiClient'
import { analyticsService } from '@/services/analytics/analyticsService'
import { toast } from '@/stores/uiStore'
import type { AnalyticsQuery, GridAgg, GridResponse, ReportWindow } from '@/types/contracts'
import { LOCALE, tr } from '@/i18n'

export interface HNode {
  key: string
  path: (string | null)[]
  label: string
  level: number
  hasChildren: boolean
  agg: GridAgg
}
export interface Branch {
  status: 'ok' | 'error'
  rows: HNode[]
  truncated: boolean
  error?: string
}

const keyOf = (path: (string | null)[]) => JSON.stringify(path)
const toNodes = (r: GridResponse): HNode[] => r.rows.map((x) => ({ key: keyOf(x.path), path: x.path, label: x.label, level: x.path.length - 1, hasChildren: x.hasChildren, agg: { cur: x.cur, prev: x.prev, hi: x.hi, sdhi: x.sdhi, ytd: x.ytd, mon: x.mon, cols: x.cols } }))
const message = (e: unknown) => (e instanceof ApiError ? e.message : tr('Data tabel gagal dimuat.'))

/**
 * Lazy result hierarchy. The top level and grand total load with the query; a node's children load
 * only when it is expanded (one aggregated request per node), and stay cached for the query.
 * Expansion is kept while the dimensions stay the same (filters/measures change → reload the open branches),
 * and resets when the hierarchy itself changes.
 */
export function useHierarchy(query: AnalyticsQuery | null, withCounts = false, windows: ReportWindow[] = [], columnDim: string | null = null) {
  // Report-date windows (H.I / S.D.H.I / YTD) are asked only when a column shows them; columnDim = matrix.
  const win = { ...(windows.length ? { windows } : {}), ...(columnDim ? { columnDim } : {}) }
  const qkey = JSON.stringify([query, withCounts, windows, columnDim])
  const dimsKey = JSON.stringify(query ? [query.datasetId, query.dimensions] : null)
  const [tops, setTops] = useState<Record<string, { status: 'ok' | 'error'; res?: GridResponse; error?: string }>>({})
  const [branches, setBranches] = useState<Record<string, Branch>>({})
  const [exp, setExp] = useState<{ dims: string; keys: Set<string> }>({ dims: dimsKey, keys: new Set() })
  const [nonce, setNonce] = useState(0)
  const expanded = useMemo(() => (exp.dims === dimsKey ? exp.keys : new Set<string>()), [exp, dimsKey])
  const inflight = useRef(new Set<string>())
  const ctl = useRef<AbortController | null>(null)
  const bk = (nodeKey: string) => `${qkey}#${nonce}|${nodeKey}`
  const topKey = `${qkey}#${nonce}`

  // Top level + grand total for the current query.
  useEffect(() => {
    if (!query) return
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    inflight.current.clear()
    analyticsService
      .grid({ query, depth: 0, path: null, withTotal: true, withCounts, ...win }, c.signal)
      .then((res) => {
        setTops({ [topKey]: { status: 'ok', res } })
        // Branches of earlier queries are no longer reachable.
        setBranches((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith(`${topKey}|`))))
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setTops({ [topKey]: { status: 'error', error: message(e) } })
      })
    return () => c.abort()
  }, [topKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const top = tops[topKey]
  const branch = useCallback((nodeKey: string) => branches[bk(nodeKey)], [branches, qkey, nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load children of expanded nodes that are visible and not loaded yet.
  useEffect(() => {
    if (!query || !top?.res) return
    const need: HNode[] = []
    const walk = (nodes: HNode[]) => {
      for (const n of nodes) {
        if (!expanded.has(n.key) || !n.hasChildren) continue
        const b = branches[bk(n.key)]
        if (!b) need.push(n)
        else if (b.status === 'ok') walk(b.rows)
      }
    }
    walk(toNodes(top.res))
    const signal = ctl.current?.signal
    for (const n of need) {
      const k = bk(n.key)
      if (inflight.current.has(k)) continue
      inflight.current.add(k)
      analyticsService
        .grid({ query, depth: n.level + 1, path: n.path, withTotal: false, withCounts, ...win }, signal)
        .then((res) => setBranches((b) => ({ ...b, [k]: { status: 'ok', rows: toNodes(res), truncated: res.truncated } })))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          setBranches((b) => ({ ...b, [k]: { status: 'error', rows: [], truncated: false, error: message(e) } }))
        })
        .finally(() => inflight.current.delete(k))
    }
  }, [expanded, top, branches, qkey]) // eslint-disable-line react-hooks/exhaustive-deps

  const setKeys = (f: (s: Set<string>) => Set<string>) => setExp({ dims: dimsKey, keys: f(new Set(expanded)) })
  const toggle = (n: HNode) =>
    setKeys((s) => {
      if (s.has(n.key)) s.delete(n.key)
      else s.add(n.key)
      return s
    })
  const retryBranch = (n: HNode) =>
    setBranches((b) => {
      const next = { ...b }
      delete next[bk(n.key)]
      return next
    })

  /**
   * Expand All, one level per click: loads every node of the next level in a single aggregated request
   * and opens all their parents. Collapse All returns to the top level only.
   */
  const expandLevel = async (visibleNodes: HNode[], maxLevel: number) => {
    if (!query) return
    const parents = visibleNodes.filter((n) => n.level === maxLevel && n.hasChildren)
    if (!parents.length) return
    try {
      const res = await analyticsService.grid({ query, depth: maxLevel + 1, path: null, withTotal: false, withCounts, ...win }, ctl.current?.signal)
      if (res.truncated) {
        toast(tr('Level berikutnya berisi lebih dari {0} baris. Buka per cabang atau persempit filter.', res.rows.length.toLocaleString(LOCALE)), 'error')
        return
      }
      const byParent = new Map<string, HNode[]>()
      for (const n of toNodes(res)) {
        const pk = keyOf(n.path.slice(0, -1))
        const list = byParent.get(pk) ?? []
        list.push(n)
        byParent.set(pk, list)
      }
      setBranches((b) => {
        const next = { ...b }
        for (const p of parents) next[bk(p.key)] = { status: 'ok', rows: byParent.get(p.key) ?? [], truncated: false }
        return next
      })
      setKeys((s) => {
        parents.forEach((p) => s.add(p.key))
        return s
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast(message(e), 'error')
    }
  }
  const collapseAll = () => setExp({ dims: dimsKey, keys: new Set() })

  return {
    status: !query ? ('idle' as const) : !top ? ('loading' as const) : top.status === 'error' ? ('error' as const) : ('ok' as const),
    error: top?.error ?? null,
    roots: top?.res ? toNodes(top.res) : [],
    total: top?.res?.total ?? null,
    /** Report date used by the H.I / S.D.H.I / YTD columns (null when none is shown). */
    reportDate: top?.res?.reportDate ?? null,
    /** Matrix: the column values of the top level (children use the same columns). */
    columns: top?.res?.columns ?? null,
    sourceRows: top?.res?.sourceRows ?? null,
    truncated: top?.res?.truncated ?? false,
    expanded,
    branch,
    toggle,
    retryBranch,
    expandLevel,
    collapseAll,
    reload: () => setNonce((n) => n + 1),
  }
}

export type Hierarchy = ReturnType<typeof useHierarchy>
