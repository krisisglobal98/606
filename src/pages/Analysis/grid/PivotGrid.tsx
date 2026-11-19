import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, Download, FileSpreadsheet, Printer, Filter as FilterIcon, Maximize2, Minimize2, MoreHorizontal, Paintbrush, Pin, PinOff, Settings2, Snowflake } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { Dropdown } from '@/components/common/Dropdown'
import { Switch } from '@/components/common/Switch'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import type { DisplayCalc, Engine } from '@/semantic/measureEngine'
import { useAnalysisStore } from '@/stores/analysisStore'
import { ruleMatches, useGridPrefs } from '@/stores/gridPrefsStore'
import { toast } from '@/stores/uiStore'
import type { Field, GridAgg } from '@/types/contracts'
import { csvCell } from '@/utils/csv'
import { sheetXml, workbook, type XCell } from '@/utils/xlsx'
import { formatNumber, formatSigned } from '@/utils/format'
import t from '../ResultTable.module.css'
import g from './PivotGrid.module.css'
import { FormatRulesModal } from './FormatRulesModal'
import { locate } from '@/stores/measureLayout'
import type { GridState } from './gridState'
import { buildHeader, matrixHeader, type HeaderCell, type LeafCol } from './headerModel'
import type { HNode, Hierarchy } from './useHierarchy'
import { tr } from '@/i18n'

type Row =
  | { t: 'node'; n: HNode; open: boolean }
  | { t: 'sub'; n: HNode }
  | { t: 'state'; level: number; parent: HNode; kind: 'loading' | 'error' | 'empty' | 'truncated'; msg?: string }

type Col = LeafCol
const HIER_W = 170
const MEAS_W = 116
const OVERSCAN = 12
const MIME = 'application/x-dod-measure'
const MIME_GROUP = 'application/x-dod-mgroup'
/** Fixed height of every header row but the last, so sticky header rows stack exactly. */
const HEAD_ROW_H = 30

interface Props {
  hier: Hierarchy
  engine: Engine
  dims: Field[]
  periodLabel: string | null
  focus?: boolean
  onToggleFocus?: () => void
  /** Shown to the left of the title. */
  titleInfo?: ReactNode
  /** The table's layout and options when it is not the Analysis page's own (a saved report). */
  state?: GridState
  /** Opens the page's filter: offered when the period and filters return no data. */
  onChangeFilter?: () => void
  /** Dimensions that can be shown as columns (matrix). */
  columnChoices?: Field[]
}

/** No row for the period and filters: say so, with the period, and point the user to the filter. */
export function NoDataForPeriod({ periodLabel, onChangeFilter, height }: { periodLabel: string | null; onChangeFilter?: () => void; height?: number }) {
  return (
    <EmptyState
      title={tr('Data tidak tersedia untuk periode filter')}
      message={
        periodLabel
          ? tr('Tidak ada data pada periode {0}. Ubah rentang tanggal atau filter data untuk menampilkan laporan.', periodLabel)
          : tr('Tidak ada data untuk filter saat ini. Ubah rentang tanggal atau filter data untuk menampilkan laporan.')
      }
      action={onChangeFilter ? <Button size="sm" icon={<FilterIcon size={14} aria-hidden />} onClick={onChangeFilter}>{tr('Ubah filter')}</Button> : undefined}
      height={height}
    />
  )
}

/**
 * Tabel Hasil as a hierarchical pivot grid.
 * - Rows: every hierarchy value expands on its own; children load lazily (one aggregated request).
 * - Hierarchy columns appear progressively: the deepest level currently exposed anywhere decides how
 *   many are shown. Frozen hierarchy columns are chosen by the user (Kolom beku); automatically, only
 *   as many as fit in half the visible width are frozen, so the measures can always scroll.
 * - Columns and header rows are generated from the Layout (measure order, Measure Groups, display
 *   calculations); with no configuration every measure is one plain column.
 * - Rows are virtualised, so only the visible window is in the DOM.
 */
export function PivotGrid({ hier, engine, dims, periodLabel, focus, onToggleFocus, titleInfo, state, onChangeFilter, columnChoices = [] }: Props) {
  const storeTable = useAnalysisStore((st) => st.table)
  const storeSetTable = useAnalysisStore((st) => st.setTable)
  const storeLayout = useAnalysisStore((st) => st.measureLayout)
  const storeSettings = useAnalysisStore((st) => st.measureSettings)
  const storeMoveMeasure = useAnalysisStore((st) => st.moveMeasure)
  const storeMoveBlock = useAnalysisStore((st) => st.moveMeasureBlock)
  const storeSetMeasure = useAnalysisStore((st) => st.setMeasureSetting)
  const opts = state?.table ?? storeTable
  const setTable = state?.setTable ?? storeSetTable
  const layout = state?.layout ?? storeLayout
  const settings = state?.settings ?? storeSettings
  const moveMeasure = state?.moveMeasure ?? storeMoveMeasure
  const moveMeasureBlock = state?.moveMeasureBlock ?? storeMoveBlock
  const setMeasureSetting = state?.setMeasureSetting ?? storeSetMeasure
  const rules = useGridPrefs((st) => st.rules)
  const widths = useGridPrefs((st) => st.widths)
  const setWidth = useGridPrefs((st) => st.setWidth)
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [live, setLive] = useState<{ col: string; w: number } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const total = hier.total

  /* ---------- columns and header rows, regenerated from the Layout ---------- */
  const baseHeader = useMemo(() => buildHeader(layout, settings, engine), [layout, settings, engine])
  // Matrix: the column values (from the response) each get the Layout's columns, and Total at the right end.
  const columnDim = opts.columnDim && !dims.some((d) => d.id === opts.columnDim) ? opts.columnDim : null
  const header = useMemo(() => (columnDim && hier.columns ? matrixHeader(baseHeader, hier.columns, columnDim) : baseHeader), [baseHeader, columnDim, hier.columns])
  const cols = header.leaves
  const groupName = (id: string | null) => (id ? (layout.find((b) => b.id === id && b.kind === 'group') as { name: string } | undefined)?.name : undefined)
  /** Full column name: Group / Measure / Calculation (parts that are not configured are omitted). */
  const colLabel = (c: Col) => {
    const single = cols.filter((x) => x.m === c.m && x.col === c.col).length === 1 && c.calc === 'value'
    const colName = c.col === undefined ? (columnDim ? tr('Total') : null) : (hier.columns?.find((x) => (x.value ?? '\u0000') === c.col)?.label ?? c.col)
    return [colName, groupName(c.group), c.meta.measureLabel, single ? null : c.meta.calcLabel].filter(Boolean).join(' / ')
  }

  // Values are rounded to the column's decimals before formatting and colouring, so "−0,0" never shows.
  const value = (c: Col, agg: GridAgg) => {
    // Matrix: a column value's cell reads that column's values; nothing there = an empty cell.
    const a = c.col === undefined ? agg : agg.cols?.[c.col]
    if (!a) return null
    const v = engine.cell(c.m, c.calc, a, c.col === undefined ? total : (total?.cols?.[c.col] ?? null), settings[c.m])
    if (v == null || !Number.isFinite(v)) return null
    const f = 10 ** c.meta.decimals
    const r = Math.round(v * f) / f
    return r === 0 ? 0 : r
  }

  /* ---------- visible rows ---------- */
  const sortNodes = (nodes: HNode[]) => {
    if (!sort) return nodes
    const c = cols.find((x) => x.key === sort.col)
    if (!c) return nodes
    const k = sort.dir === 'asc' ? 1 : -1
    return [...nodes].sort((a, b) => {
      const va = value(c, a.agg)
      const vb = value(c, b.agg)
      if (va == null) return vb == null ? 0 : 1
      if (vb == null) return -1
      return (va - vb) * k
    })
  }
  const rows: Row[] = []
  const build = (nodes: HNode[]) => {
    for (const n of sortNodes(nodes)) {
      const open = n.hasChildren && hier.expanded.has(n.key)
      rows.push({ t: 'node', n, open })
      if (!open) continue
      const b = hier.branch(n.key)
      if (!b) rows.push({ t: 'state', level: n.level + 1, parent: n, kind: 'loading' })
      else if (b.status === 'error') rows.push({ t: 'state', level: n.level + 1, parent: n, kind: 'error', msg: b.error })
      else {
        if (!b.rows.length) rows.push({ t: 'state', level: n.level + 1, parent: n, kind: 'empty' })
        build(b.rows)
        if (b.truncated) rows.push({ t: 'state', level: n.level + 1, parent: n, kind: 'truncated' })
      }
      if (opts.subtotal) rows.push({ t: 'sub', n })
    }
  }
  build(hier.roots)

  // Hierarchy columns follow the deepest level exposed anywhere (not per row).
  const depth = rows.reduce((d, r) => Math.max(d, r.t === 'state' ? r.level : r.n.level), 0)
  const hcols = dims.length ? dims.slice(0, depth + 1) : []
  const wOf = (key: string, def: number) => (live?.col === key ? live.w : (widths[key] ?? def))
  const hW = hcols.map((d) => wOf(`h:${d.id}`, HIER_W))
  const labelW = hcols.length ? 0 : 150
  /* ---------- frozen columns ---------- */
  const scroller = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [hier.status])
  const autoFrozen = (() => {
    const out: string[] = []
    let w = 0
    for (const [i, d] of hcols.entries()) {
      w += hW[i]!
      if (i > 0 && viewW && w > viewW * 0.5) break
      out.push(d.id)
    }
    return out
  })()
  const frozenIds = new Set(opts.freeze ?? autoFrozen)
  const isFrozen = hcols.map((d) => frozenIds.has(d.id))
  // A frozen column sticks right after the frozen columns before it; unfrozen ones scroll under them.
  const lefts = hW.map((_, i) => hW.slice(0, i).reduce((a, b, j) => a + (isFrozen[j] ? b : 0), 0))
  const lastFrozen = isFrozen.lastIndexOf(true)
  const frozenW = hW.reduce((a, b) => a + b, 0) || labelW
  const setFreeze = (ids: string[] | null) => setTable({ freeze: ids })
  const toggleFreeze = (id: string) => {
    const cur = [...frozenIds]
    setFreeze(cur.includes(id) ? cur.filter((x) => x !== id) : dims.map((d) => d.id).filter((x) => x === id || cur.includes(x)))
  }
  const mW = cols.map((c) => wOf(`m:${c.key}`, MEAS_W))
  const tableW = frozenW + mW.reduce((a, b) => a + b, 0)
  const maxLevel = rows.reduce((d, r) => (r.t === 'node' ? Math.max(d, r.n.level) : d), 0)

  /* ---------- virtualisation ---------- */
  // Row height is measured from a rendered row (density setting changes it); the visible height from the scroller.
  const [scroll, setScroll] = useState({ top: 0, h: 520, rowH: 28 })
  const rowH = scroll.rowH
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const h = el.querySelector('tbody tr:not([aria-hidden])')?.getBoundingClientRect().height
    setScroll((s) => {
      const next = { top: el.scrollTop, h: el.clientHeight, rowH: h && h > 10 ? h : s.rowH }
      return s.top === next.top && s.h === next.h && s.rowH === next.rowH ? s : next
    })
  }, [])
  // The visible height is also measured without a scroll: when the table appears and whenever its box changes
  // (tall screen, Fokus Tabel, window resize). Otherwise only the first 520 px of rows were rendered until the user
  // scrolled, and on a screen tall enough to show the whole table without a scrollbar the rest never appeared.
  const tableShown = hier.status === 'ok' && rows.length > 0
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !tableShown) return
    onScroll()
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tableShown, focus, onScroll])
  // Printing renders every row (the page is paper, not a scroll window).
  const [printing, setPrinting] = useState(false)
  const start = printing ? 0 : Math.max(0, Math.floor(scroll.top / rowH) - OVERSCAN)
  const end = printing ? rows.length : Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / rowH) + OVERSCAN)
  const slice = rows.slice(start, end)

  /* ---------- formatting ---------- */
  const styleFor = (c: Col, v: number | null) => {
    if (v == null) return ''
    let cls = ''
    if (opts.conditional) {
      // "*%" = percentage ratios of the dataset (Achievement-like), not shares or variance %.
      const def = engine.defs.get(c.m)
      const isPct = c.calc === 'value' && def?.unit === '%' && def.category === 'derived' && !def.comparison
      const isGrowth = c.calc.startsWith('growth') || def?.id === 'dx:growth'
      const hit = rules.find((r) => (r.target === c.key || (r.target === '*%' && isPct) || (r.target === '*growth' && isGrowth)) && ruleMatches(r, v))
      if (hit) cls = { positive: t.good, warning: t.warn, negative: t.bad, 'text-positive': g.posText, 'text-negative': t.neg }[hit.style] ?? ''
    }
    if (!cls && v < 0) cls = t.neg ?? ''
    return cls
  }
  const fmt = (c: Col, v: number | null) => (c.meta.signed ? formatSigned(v, c.meta.decimals) : formatNumber(v, c.meta.decimals))
  const cells = (agg: GridAgg | null, blank = false) =>
    cols.map((c, i) => {
      if (blank || !agg) return <td key={c.key} style={{ width: mW[i] }} />
      const v = value(c, agg)
      return (
        <td key={c.key} className={styleFor(c, v)}>
          {fmt(c, v)}
        </td>
      )
    })
  const frozen = (i: number): CSSProperties => (isFrozen[i] ? { left: lefts[i], width: hW[i], maxWidth: hW[i] } : { width: hW[i], maxWidth: hW[i] })
  /** Sticky class for a frozen column, plus the divider after the last frozen one. */
  const frz = (i: number) => `${isFrozen[i] ? ` ${g.frz}` : ''}${i === lastFrozen ? ` ${g.edge}` : ''}`

  /* ---------- header interactions ---------- */
  const sortBy = (key: string) => setSort((s) => (s?.col !== key ? { col: key, dir: 'desc' } : s.dir === 'desc' ? { col: key, dir: 'asc' } : null))
  const resize = (key: string, startW: number) => (e: RPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    let w = startW
    const move = (ev: PointerEvent) => {
      w = Math.max(72, Math.min(480, startW + ev.clientX - x0))
      setLive({ col: key, w })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWidth(key, w)
      setLive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const handle = (key: string, w: number) => <span className={g.resize} onPointerDown={resize(key, w)} role="separator" aria-orientation="vertical" aria-label={tr('Ubah lebar kolom')} />
  // Header drag & drop edits the Layout (the table is regenerated from it).
  const onDrop = (cell: HeaderCell) => (e: DragEvent) => {
    setDragOver(null)
    const m = e.dataTransfer.getData(MIME)
    const grp = e.dataTransfer.getData(MIME_GROUP)
    if (m && cell.kind === 'measure' && m !== cell.ref) {
      e.preventDefault()
      const at = locate(layout, cell.ref)
      if (at) moveMeasure(m, at.group, at.index)
    } else if (grp && cell.kind === 'group' && grp !== cell.ref) {
      e.preventDefault()
      moveMeasureBlock(grp, layout.findIndex((b) => b.id === cell.ref))
    }
  }
  const sortIcon = (key: string) => (sort?.col === key ? sort.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden /> : null)
  const ariaSort = (key: string) => (sort?.col === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined)

  /** Header shortcut: same display-calculation choices as the Layout, written to the Layout. */
  const calcMenu = (m: string, label: string) => {
    const options = engine.calcsFor(m)
    const current = engine.displays(m, settings[m])
    const set = (next: DisplayCalc[]) => setMeasureSetting(m, { display: next })
    return (
      <Dropdown
        align="right"
        trigger={({ open, toggle, id }) => (
          <button type="button" className={`icon-btn ${g.menuBtn}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={tr('Kolom untuk {0}', label)} title={tr('Kolom yang ditampilkan (diatur di Layout)')}>
            <MoreHorizontal size={13} />
          </button>
        )}
      >
        {() =>
          options.map((c) => (
            <label key={c.id} role="menuitem" className={`${g.menuItem}${c.unavailable ? ` ${g.menuOff}` : ''}`} title={c.unavailable ?? c.description}>
              <input
                type="checkbox"
                checked={current.includes(c.id)}
                disabled={!!c.unavailable || (current.length === 1 && current.includes(c.id))}
                onChange={() => set(current.includes(c.id) ? current.filter((x) => x !== c.id) : [...current, c.id])}
              />
              {c.label}
              {c.unavailable && <small>{tr('belum tersedia')}</small>}
            </label>
          ))
        }
      </Dropdown>
    )
  }

  /* ---------- transposed (sheet R): measures as rows, their display columns as columns ---------- */
  // Only for a table without row dimensions (one row of totals): each measure keeps its own unit and decimals, and a
  // Measure Group becomes a subtitle row above its measures (Man Power → Workshop / Traksi / Total).
  const transposed = !!opts.transpose && !dims.length && !columnDim
  const tCalcs = [...new Map(cols.map((c) => [c.calc, c.meta.calcLabel])).entries()]
  const tRows: ({ t: 'group'; name: string } | { t: 'measure'; m: string; label: string; unit: string; leaves: Col[] })[] = []
  for (const c of cols) {
    const last = tRows.at(-1)
    if (last?.t === 'measure' && last.m === c.m) { last.leaves.push(c); continue }
    const prevGroup = [...tRows].reverse().find((r) => r.t === 'measure') as { leaves: Col[] } | undefined
    if (c.group && prevGroup?.leaves[0]?.group !== c.group) tRows.push({ t: 'group', name: groupName(c.group) ?? '' })
    tRows.push({ t: 'measure', m: c.m, label: c.meta.measureLabel, unit: c.meta.unit, leaves: [c] })
  }
  const tCell = (r: { leaves: Col[] }, calc: DisplayCalc) => {
    const c = r.leaves.find((x) => x.calc === calc)
    if (!c || !total) return { c, v: null }
    return { c, v: value(c, total) }
  }

  /* ---------- export (visible rows, as shown) ---------- */
  const exportCsv = () => {
    const q = csvCell
    if (transposed) {
      const lines = [[tr('Ukuran'), tr('Satuan'), ...tCalcs.map(([, l]) => l)].map(q).join(',')]
      for (const r of tRows) {
        if (r.t === 'group') { lines.push(q(r.name)); continue }
        lines.push([q(r.label), q(r.unit), ...tCalcs.map(([calc]) => { const { v } = tCell(r, calc); return v == null ? '' : String(Math.round(v * 1e6) / 1e6) })].join(','))
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
      a.download = 'dod-analisis-tabel.csv'
      a.click()
      URL.revokeObjectURL(a.href)
      toast(tr('File CSV diunduh (baris yang sedang tampil).'), 'success')
      return
    }
    // CSV follows the Layout: one column per leaf, named Group / Measure / Calculation (unit).
    const head = [...(hcols.length ? hcols.map((d) => d.label) : ['']), ...cols.map((c) => `${colLabel(c)}${c.meta.unit ? ` (${c.meta.unit})` : ''}`)]
    const lines = [head.map(q).join(',')]
    const raw = (c: Col, agg: GridAgg) => {
      const v = value(c, agg)
      return v == null ? '' : String(Math.round(v * 1e6) / 1e6)
    }
    for (const r of rows) {
      if (r.t === 'state') continue
      const lab = hcols.map((_, i) => (i === r.n.level ? (r.t === 'sub' ? tr('{0} Total', r.n.label) : r.n.label) : ''))
      const blank = r.t === 'node' && r.open && opts.subtotal
      lines.push([...lab.map(q), ...cols.map((c) => (blank ? '' : raw(c, r.n.agg)))].join(','))
    }
    if (total) lines.push([q(tr('Grand Total')), ...hcols.slice(1).map(() => ''), ...cols.map((c) => raw(c, total))].join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = 'dod-analisis-tabel.csv'
    a.click()
    URL.revokeObjectURL(a.href)
    toast(tr('File CSV diunduh (baris yang sedang tampil).'), 'success')
  }

  /* ---------- Excel: the table as on screen (header rows merged like the screen, numbers as numbers) ---------- */
  const exportXlsx = () => {
    const grid: XCell[][] = []
    const num = (c: Col, v: number | null): Exclude<XCell, null> => ({ v: v == null ? null : Math.round(v * 10 ** c.meta.decimals) / 10 ** c.meta.decimals, decimals: c.meta.decimals })
    let freezeRows = 1
    let freezeCols = 1
    let widths: number[]
    if (transposed) {
      grid.push([tr('Ukuran'), tr('Satuan'), ...tCalcs.map(([, l]) => l)].map((v) => ({ v, header: true })))
      for (const r of tRows) {
        if (r.t === 'group') grid.push([{ v: r.name, bold: true }])
        else grid.push([{ v: r.label }, { v: r.unit }, ...tCalcs.map(([calc]) => { const { c, v } = tCell(r, calc); return c ? num(c, v) : null })])
      }
      widths = [32, 10, ...tCalcs.map(() => 14)]
    } else {
      // Header: the dimension columns span every header row; the Layout's cells are placed as the browser places them.
      const nLab = Math.max(1, hcols.length)
      const hRows = header.rows.length
      const width = nLab + cols.length
      for (let r = 0; r < hRows; r++) grid.push(Array.from({ length: width }, () => null))
      const taken = Array.from({ length: hRows }, () => Array.from({ length: width }, () => false))
      for (let i = 0; i < nLab; i++) {
        grid[0]![i] = { v: hcols[i]?.label ?? '', header: true, rowSpan: hRows }
        for (let r = 0; r < hRows; r++) taken[r]![i] = true
      }
      header.rows.forEach((row, r) => {
        let at = 0
        for (const cell of row) {
          while (taken[r]![at]) at++
          const rs = Math.min(cell.rowSpan, hRows - r)
          grid[r]![at] = { v: cell.small ? `${cell.label} (${cell.small})` : cell.label, header: true, colSpan: cell.colSpan, rowSpan: rs }
          for (let y = r; y < r + rs; y++) for (let x = at; x < at + cell.colSpan; x++) taken[y]![x] = true
          at += cell.colSpan
        }
      })
      // Cells covered by a merge are written empty with the header style, so borders and fill continue.
      for (let r = 0; r < hRows; r++) for (let x = 0; x < width; x++) if (!grid[r]![x] && taken[r]![x]) grid[r]![x] = { v: null, header: true }
      for (const r of rows) {
        if (r.t === 'state') continue
        const sub = r.t === 'sub'
        const lab = Array.from({ length: nLab }, (_, i): XCell => (i === r.n.level ? { v: sub ? tr('{0} Total', r.n.label) : r.n.label, bold: sub } : null))
        const blank = r.t === 'node' && r.open && opts.subtotal
        grid.push([...lab, ...cols.map((c) => (blank ? null : { ...num(c, value(c, r.n.agg)), bold: sub }))])
      }
      if ((opts.grandTotal || !dims.length) && total) grid.push([{ v: tr('Grand Total'), bold: true }, ...Array.from({ length: nLab - 1 }, () => null), ...cols.map((c) => ({ ...num(c, value(c, total)), bold: true }))])
      freezeRows = hRows
      freezeCols = nLab
      widths = [...Array.from({ length: nLab }, () => 24), ...cols.map(() => 13)]
    }
    const bytes = workbook(tr('Tabel Hasil'), sheetXml(grid, { widths, freezeRows, freezeCols }))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    a.download = 'dod-analisis-tabel.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
    toast(tr('File Excel diunduh (baris yang sedang tampil, tata letak seperti di layar).'), 'success')
  }
  /** Print / PDF: the browser's print dialog with the table only (print styles hide the rest of the page). */
  const printTable = () => {
    setPrinting(true)
    document.body.classList.add('print-table')
    const done = () => {
      document.body.classList.remove('print-table')
      setPrinting(false)
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    // After every row is in the page.
    setTimeout(() => window.print(), 50)
  }

  /* ---------- body ---------- */
  let body: React.ReactNode
  if (hier.status === 'loading' || hier.status === 'idle')
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true" aria-label={tr('Memuat tabel')}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} h={22} />
        ))}
      </div>
    )
  else if (hier.status === 'error') body = <ErrorState message={hier.error ?? tr('')} onRetry={hier.reload} />
  else if (!hier.roots.length && !(total && !dims.length)) body = <NoDataForPeriod periodLabel={periodLabel} onChangeFilter={onChangeFilter} />
  else if (transposed)
    body = (
      <div className={t.wrap}>
        <table className={`${t.pv} ${g.grid}`} aria-label={tr('Tabel Hasil, ukuran sebagai baris')}>
          <thead>
            <tr>
              <th scope="col" className={t.dimTh}>{tr('Ukuran')}</th>
              <th scope="col">{tr('Satuan')}</th>
              {tCalcs.map(([calc, label]) => <th key={calc} scope="col">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {tRows.map((r, i) =>
              r.t === 'group' ? (
                <tr key={`g${i}`} className={t.total}>
                  <th scope="rowgroup" colSpan={2 + tCalcs.length} style={{ textAlign: 'left' }}>{r.name}</th>
                </tr>
              ) : (
                <tr key={r.m}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>{r.label}</th>
                  <td style={{ textAlign: 'left' }}>{r.unit}</td>
                  {tCalcs.map(([calc]) => {
                    const { c, v } = tCell(r, calc)
                    return <td key={calc} className={c ? styleFor(c, v) : undefined}>{c ? fmt(c, v) : ''}</td>
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    )
  else {
    const hdrRows = header.rows.length
    body = (
      <>
        <div ref={scroller} className={t.wrap} onScroll={onScroll} style={{ maxHeight: focus ? 'calc(100vh - 210px)' : 'max(520px, calc(100vh - 380px))' }}>
          <table className={`${t.pv} ${g.grid}`} style={{ width: tableW }}>
            <colgroup>
              {hcols.length ? hW.map((w, i) => <col key={i} style={{ width: w }} />) : <col style={{ width: labelW }} />}
              {mW.map((w, i) => (
                <col key={cols[i]!.key} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              {header.rows.map((row, ri) => (
                <tr key={ri} className={ri < hdrRows - 1 ? g.hRow : undefined} style={ri < hdrRows - 1 ? { height: HEAD_ROW_H } : undefined}>
                  {ri === 0 &&
                    (hcols.length ? (
                      hcols.map((d, i) => (
                        <th key={d.id} scope="col" rowSpan={hdrRows} className={`${t.dimTh}${frz(i)}`} style={frozen(i)}>
                          <span className={g.thText}>{d.label}</span>
                          <button type="button" className={`icon-btn ${g.pinBtn}${isFrozen[i] ? ` ${g.pinOn}` : ''}`} onClick={() => toggleFreeze(d.id)} aria-pressed={isFrozen[i]} aria-label={tr('{0} kolom {1}', isFrozen[i] ? tr('Lepas') : tr('Bekukan'), d.label)} title={isFrozen[i] ? tr('Lepas kolom beku') : tr('Bekukan kolom ini')}>
                            {isFrozen[i] ? <Pin size={12} /> : <PinOff size={12} />}
                          </button>
                          {handle(`h:${d.id}`, hW[i]!)}
                        </th>
                      ))
                    ) : (
                      <th scope="col" rowSpan={hdrRows} className={`${t.dimTh} ${g.frz} ${g.edge}`} style={{ left: 0, width: labelW }} />
                    ))}
                  {row.map((cell) => {
                    const leaf = cell.leaf
                    const spanning = cell.colSpan > 1 || cell.kind === 'group'
                    // The matrix's column-value cells (ref col:…) are headings only, not Measure Groups.
                    const draggable = (cell.kind === 'measure' || cell.kind === 'group') && !cell.ref.startsWith('col:')
                    return (
                      <th
                        key={cell.key}
                        scope={spanning ? 'colgroup' : 'col'}
                        colSpan={cell.colSpan}
                        rowSpan={cell.rowSpan}
                        style={{ top: ri * HEAD_ROW_H }}
                        className={[spanning && g.group, cell.kind === 'group' && g.mgroup, leaf && g.sortable, dragOver === cell.key && g.dropOn].filter(Boolean).join(' ')}
                        aria-sort={leaf ? ariaSort(leaf) : undefined}
                        draggable={draggable}
                        onDragStart={
                          draggable
                            ? (e) => {
                                e.dataTransfer.setData(cell.kind === 'group' ? MIME_GROUP : MIME, cell.ref)
                                e.dataTransfer.effectAllowed = 'move'
                              }
                            : undefined
                        }
                        onDragOver={(e) => {
                          const ok = (cell.kind === 'measure' && e.dataTransfer.types.includes(MIME)) || (cell.kind === 'group' && e.dataTransfer.types.includes(MIME_GROUP))
                          if (!ok) return
                          e.preventDefault()
                          setDragOver(cell.key)
                        }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={onDrop(cell)}
                        onClick={leaf ? () => sortBy(leaf) : undefined}
                        title={cell.kind === 'group' ? tr('Measure Group {0} — tarik untuk memindah', cell.label) : cell.kind === 'measure' ? tr('{0} — tarik untuk memindah{1}', engine.defs.get(cell.ref)?.description ?? cell.label, leaf ? tr(', klik untuk mengurutkan') : '') : tr('Klik untuk mengurutkan')}
                      >
                        <span className={spanning ? g.groupHead : undefined}>
                          <span className={g.thText}>
                            {cell.label}
                            {leaf && sortIcon(leaf)}
                            {cell.small && <small>{cell.small}</small>}
                          </span>
                          {cell.kind === 'measure' && <span onClick={(e) => e.stopPropagation()}>{calcMenu(cell.ref, cell.label)}</span>}
                        </span>
                        {leaf && handle(`m:${leaf}`, mW[cols.findIndex((c) => c.key === leaf)]!)}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {start > 0 && <tr aria-hidden style={{ height: start * rowH }} />}
              {slice.map((r) => {
                if (r.t === 'state') {
                  return (
                    <tr key={`s|${r.parent.key}|${r.kind}`} className={g.stateRow}>
                      {hcols.map((d, i) => (
                        <td key={d.id} className={`${t.lbl} ${t.e}${frz(i)}`} style={frozen(i)}>
                          {i === r.level && (
                            <span className={g.state}>
                              {r.kind === 'loading' ? tr('Memuat…') : r.kind === 'empty' ? tr('Tidak ada data') : r.kind === 'truncated' ? tr('Dibatasi 5.000 baris pertama') : (
                                <>
                                  {tr('Gagal dimuat.')}{tr(' ')}
                                  <button type="button" className={g.link} onClick={() => hier.retryBranch(r.parent)}>
                                    {tr('Coba lagi')}
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </td>
                      ))}
                      {cells(null, true)}
                    </tr>
                  )
                }
                const n = r.n
                if (r.t === 'sub')
                  return (
                    <tr key={`t|${n.key}`} className={t.total}>
                      {hcols.map((d, i) => (
                        <td key={d.id} className={`${t.lbl}${i < n.level ? ` ${t.e}` : ''}${frz(i)}`} style={frozen(i)}>
                          {i === n.level && <span className={g.cellText}>{n.label}{' '}{tr('Total')}</span>}
                        </td>
                      ))}
                      {cells(n.agg)}
                    </tr>
                  )
                return (
                  <tr key={n.key} className={n.hasChildren ? undefined : t.leaf}>
                    {hcols.map((d, i) => (
                      <td key={d.id} className={`${t.lbl}${i !== n.level ? ` ${t.e}` : ''}${frz(i)}`} style={frozen(i)}>
                        {i === n.level && (
                          <span className={g.cellText}>
                            {n.hasChildren && (
                              <button type="button" className={t.tg} onClick={() => hier.toggle(n)} aria-expanded={r.open} aria-label={`${r.open ? tr('Ciutkan') : tr('Buka')} ${n.label}`}>
                                {r.open ? tr('−') : tr('+')}
                              </button>
                            )}
                            <span title={n.label}>{n.label}</span>
                          </span>
                        )}
                      </td>
                    ))}
                    {/* With Subtotal on, an open group's numbers live in its Total row. */}
                    {cells(n.agg, r.open && opts.subtotal)}
                  </tr>
                )
              })}
              {end < rows.length && <tr aria-hidden style={{ height: (rows.length - end) * rowH }} />}
              {(opts.grandTotal || !dims.length) && total && (
                <tr className={t.grand}>
                  {hcols.length ? (
                    hcols.map((d, i) => (
                      <td key={d.id} className={`${t.lbl}${frz(i)}`} style={frozen(i)}>
                        {i === 0 && <span className={g.cellText}>{tr('Grand Total')}</span>}
                      </td>
                    ))
                  ) : (
                    <td className={`${t.lbl} ${g.frz} ${g.edge}`} style={{ left: 0, width: frozenW }}>
                      {tr('Grand Total')}
                    </td>
                  )}
                  {cells(total)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {hier.truncated && <p className="t-meta" style={{ marginTop: 8 }}>{tr('Level teratas dibatasi 5.000 baris. Persempit filter untuk melihat sisanya.')}</p>}
      </>
    )
  }

  const shown = rows.filter((r) => r.t === 'node').length
  return (
    <div data-print-table>
    <Card
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{titleInfo}{tr('Tabel Hasil')}</span>}
      subtitle={hier.status === 'ok' ? tr('{0} baris tampil · {1} dari {2} level hierarki{3}', formatNumber(shown), hcols.length, dims.length, periodLabel ? ` · ${periodLabel}` : '') : undefined}
      actions={
        <>
          {columnChoices.length > 0 && (
            <label className="t-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={tr('Tampilkan nilai sebuah dimensi sebagai kolom (mis. Hari 1–31), dengan total di ujung kanan')}>
              {tr('Kolom')}
              <select className="select select--sm" value={columnDim ?? ''} onChange={(e) => setTable({ columnDim: e.target.value || null })} aria-label={tr('Dimensi sebagai kolom')}>
                <option value="">{tr('— tidak ada —')}</option>
                {columnChoices.filter((f) => !dims.some((d) => d.id === f.id)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
          )}
          {!dims.length && !columnDim && <Switch label={tr('Ukuran sebagai baris')} checked={!!opts.transpose} onChange={(v) => setTable({ transpose: v })} />}
          <Switch label={tr('Subtotal')} checked={opts.subtotal} onChange={(v) => setTable({ subtotal: v })} />
          <Switch label={tr('Grand Total')} checked={opts.grandTotal} onChange={(v) => setTable({ grandTotal: v })} />
          <Button size="sm" active={opts.conditional} icon={<Paintbrush size={13} aria-hidden />} onClick={() => setTable({ conditional: !opts.conditional })} aria-pressed={opts.conditional}>
            {tr('Format Kondisi')}
          </Button>
          <Button size="sm" iconOnly icon={<Settings2 size={14} />} onClick={() => setRulesOpen(true)} aria-label={tr('Atur aturan Format Kondisi')} title={tr('Atur aturan Format Kondisi')} />
          {dims.length > 0 && (
            <Dropdown
              align="right"
              trigger={({ open, toggle, id }) => (
                <Button size="sm" icon={<Snowflake size={13} aria-hidden />} onClick={toggle} aria-haspopup="true" aria-expanded={open} aria-controls={id} title={tr('Pilih kolom dimensi yang dibekukan di kiri')}>
                  {tr('Kolom beku')}{opts.freeze ? ` (${frozenIds.size})` : tr('')}
                </Button>
              )}
            >
              {() => (
                <div className={g.freezeMenu}>
                  <div className="menu-head">{tr('Kolom beku')}</div>
                  <label className={g.menuItem}>
                    <input type="radio" name="freeze-mode" checked={!opts.freeze} onChange={() => setFreeze(null)} />
                    <span>
                      {tr('Otomatis')}
                      <small>{tr('dibekukan selama lebarnya ≤ setengah tabel')}</small>
                    </span>
                  </label>
                  <label className={g.menuItem}>
                    <input type="radio" name="freeze-mode" checked={!!opts.freeze && !opts.freeze.length} onChange={() => setFreeze([])} />
                    {tr('Tidak ada')}
                  </label>
                  <div className={g.menuSep} />
                  {dims.map((d) => (
                    <label key={d.id} className={g.menuItem}>
                      <input type="checkbox" checked={frozenIds.has(d.id)} onChange={() => toggleFreeze(d.id)} />
                      {d.label}
                      {!hcols.some((h) => h.id === d.id) && <small>{tr('belum tampil')}</small>}
                    </label>
                  ))}
                </div>
              )}
            </Dropdown>
          )}
          <Button size="sm" iconOnly icon={<ChevronsUpDown size={14} />} onClick={() => void hier.expandLevel(rows.flatMap((r) => (r.t === 'node' ? [r.n] : [])), maxLevel)} disabled={hier.status !== 'ok' || maxLevel >= dims.length - 1} aria-label={tr('Expand All: buka satu level lagi')} title={tr('Expand All (satu level per klik)')} />
          <Button size="sm" iconOnly icon={<ChevronsDownUp size={14} />} onClick={hier.collapseAll} disabled={!hier.expanded.size} aria-label={tr('Collapse All')} title={tr('Collapse All')} />
          <Button size="sm" icon={<FileSpreadsheet size={13} aria-hidden />} onClick={exportXlsx} disabled={hier.status !== 'ok'} title={tr('Excel dengan tata letak seperti di layar (header bertingkat, total)')}>
            {tr('Ekspor Excel')}
          </Button>
          <Button size="sm" icon={<Printer size={13} aria-hidden />} onClick={printTable} disabled={hier.status !== 'ok'} title={tr('Cetak tabel, atau simpan sebagai PDF dari dialog cetak')}>
            {tr('Cetak / PDF')}
          </Button>
          <Button size="sm" icon={<Download size={13} aria-hidden />} onClick={exportCsv} disabled={hier.status !== 'ok'}>
            {tr('Ekspor CSV')}
          </Button>
          {onToggleFocus && (
            <Button id="table-focus-btn" size="sm" icon={focus ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />} onClick={onToggleFocus} aria-pressed={!!focus} title={focus ? tr('Keluar dari Fokus Tabel (Esc)') : tr('Tabel memenuhi workspace')}>
              {focus ? tr('Keluar Fokus') : tr('Fokus Tabel')}
            </Button>
          )}
        </>
      }
    >
      {body}
      {rulesOpen && <FormatRulesModal engine={engine} columns={cols.map((c) => ({ key: c.key, label: colLabel(c) }))} onClose={() => setRulesOpen(false)} />}
    </Card>
    </div>
  )
}
