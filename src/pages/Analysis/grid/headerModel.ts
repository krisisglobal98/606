/**
 * Dynamic header generator: turns the Layout's measure configuration into leaf columns and header rows.
 *
 *   no groups, no sub-columns  →  one header row:          Produksi | Target | Cost
 *   sub-columns                →  + a calculation row:      Produksi (Value | Growth YoY) | Target
 *   Measure Groups             →  + a group row on top:     OPERATIONAL (Produksi | Luas) | Target
 *
 * Rows only exist when the configuration needs them. Nothing here knows any field name.
 */
import type { DisplayCalc, Engine, ColumnMeta, MeasureSetting } from '@/semantic/measureEngine'
import { sanitize, type MeasureBlock } from '@/stores/measureLayout'
import { tr } from '@/i18n'

export interface LeafCol {
  key: string
  m: string
  calc: DisplayCalc
  meta: ColumnMeta
  group: string | null
}

export interface HeaderCell {
  key: string
  kind: 'group' | 'measure' | 'calc'
  label: string
  /** Second line (unit or calculation), when there is one. */
  small?: string
  colSpan: number
  rowSpan: number
  /** Measure id for measure/calc cells, group id for group cells. */
  ref: string
  /** Leaf column key when this cell sits directly above one column (sortable, resizable). */
  leaf?: string
}

export interface HeaderModel {
  leaves: LeafCol[]
  rows: HeaderCell[][]
}

export function buildHeader(blocks: MeasureBlock[], settings: Record<string, MeasureSetting>, engine: Engine): HeaderModel {
  const valid = sanitize(blocks, (id) => engine.defs.has(id)).filter((b) => b.kind === 'measure' || b.measures.length > 0)
  const colsOf = (m: string): LeafCol[] =>
    engine.displays(m, settings[m]).map((calc) => ({ key: `${m}|${calc}`, m, calc, meta: engine.columnMeta(m, calc, settings[m]), group: null }))

  const hasGroups = valid.some((b) => b.kind === 'group')
  const multi = valid.some((b) => (b.kind === 'measure' ? [b.id] : b.measures).some((m) => colsOf(m).length > 1))
  const gRow: HeaderCell[] = []
  const mRow: HeaderCell[] = []
  const cRow: HeaderCell[] = []
  const leaves: LeafCol[] = []

  const measureCell = (m: string, cols: LeafCol[], topRowSpan: number): HeaderCell => {
    const single = cols.length === 1 ? cols[0]! : null
    const c0 = cols[0]!.meta
    // A single column shows the calculation name only when it is not the plain value.
    const small = single ? (single.calc === 'value' ? c0.unit || undefined : `${c0.calcLabel}${c0.unit ? ` (${c0.unit})` : ''}`) : undefined
    return { key: `m:${m}`, kind: 'measure', label: c0.measureLabel, small, colSpan: cols.length, rowSpan: topRowSpan + (single && multi ? 1 : 0), ref: m, leaf: single?.key }
  }
  const calcCells = (cols: LeafCol[]) => {
    if (cols.length < 2) return
    for (const c of cols) cRow.push({ key: `c:${c.key}`, kind: 'calc', label: c.meta.calcLabel, small: c.meta.unit || undefined, colSpan: 1, rowSpan: 1, ref: c.m, leaf: c.key })
  }

  for (const b of valid) {
    if (b.kind === 'measure') {
      const cols = colsOf(b.id)
      leaves.push(...cols)
      // An ungrouped measure starts in the top row and spans the group row when groups exist.
      ;(hasGroups ? gRow : mRow).push(measureCell(b.id, cols, hasGroups ? 2 : 1))
      calcCells(cols)
    } else {
      const all = b.measures.map((m) => colsOf(m).map((c) => ({ ...c, group: b.id })))
      gRow.push({ key: `g:${b.id}`, kind: 'group', label: b.name || tr('Tanpa nama'), colSpan: all.reduce((n, c) => n + c.length, 0), rowSpan: 1, ref: b.id })
      b.measures.forEach((m, i) => {
        leaves.push(...all[i]!)
        mRow.push(measureCell(m, all[i]!, 1))
        calcCells(all[i]!)
      })
    }
  }
  const rows = [gRow, mRow, cRow].filter((_, i) => (i === 0 ? hasGroups : i === 1 ? true : multi))
  return { leaves, rows: rows.filter((r) => r.length || rows.length === 1) }
}
