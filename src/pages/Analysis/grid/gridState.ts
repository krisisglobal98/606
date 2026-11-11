import { useState } from 'react'
import type { MeasureSetting } from '@/semantic/measureEngine'
import type { TableOptions } from '@/stores/analysisStore'
import { locate, moveBlock, placeMeasure, type MeasureBlock } from '@/stores/measureLayout'

/** What Tabel Hasil reads and changes; the Analysis page's own comes from analysisStore. */
export interface GridState {
  table: TableOptions
  setTable: (t: Partial<TableOptions>) => void
  layout: MeasureBlock[]
  settings: Record<string, MeasureSetting>
  moveMeasure: (id: string, group: string | null, index?: number) => void
  moveMeasureBlock: (id: string, index: number) => void
  setMeasureSetting: (id: string, patch: Partial<MeasureSetting> | null) => void
}

/** A grid over a saved layout: changes last while it is open, and touch neither the saved report nor Analisis. */
export function useLocalGridState(initial: { table: TableOptions; layout: MeasureBlock[]; settings: Record<string, MeasureSetting> }): GridState {
  const [table, setTableState] = useState(initial.table)
  const [layout, setLayout] = useState(initial.layout)
  const [settings, setSettings] = useState(initial.settings)
  return {
    table,
    setTable: (t) => setTableState((cur) => ({ ...cur, ...t })),
    layout,
    settings,
    moveMeasure: (id, group, index) => setLayout((cur) => (locate(cur, id) ? placeMeasure(cur, id, group, index) : cur)),
    moveMeasureBlock: (id, index) => setLayout((cur) => moveBlock(cur, id, index)),
    setMeasureSetting: (id, patch) =>
      setSettings((cur) => {
        if (patch != null) return { ...cur, [id]: { ...cur[id], ...patch } }
        const next = { ...cur }
        delete next[id]
        return next
      }),
  }
}

