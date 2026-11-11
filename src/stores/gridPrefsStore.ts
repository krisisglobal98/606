/**
 * Result-table preferences that outlive a session (localStorage): calculated measure definitions per
 * dataset, conditional-format rules and column widths. The table's column structure (groups, measures,
 * display calculations) is NOT here: it belongs to the Analysis Layout (analysisStore).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { CalcMeasure } from '@/semantic/measureEngine'

export type RuleStyle = 'positive' | 'warning' | 'negative' | 'text-positive' | 'text-negative'
export type RuleOp = '<' | '<=' | '>' | '>=' | '='

export interface FormatRule {
  id: string
  /** "*%" = value of every percentage ratio of the dataset (Achievement-like) · "*growth" = every Growth column · "<measureId>|<view>" = one column */
  target: string
  op: RuleOp
  value: number
  style: RuleStyle
}

export const DEFAULT_RULES: FormatRule[] = [
  { id: 'r1', target: '*%', op: '>=', value: 100, style: 'positive' },
  { id: 'r2', target: '*%', op: '>=', value: 90, style: 'warning' },
  { id: 'r3', target: '*%', op: '<', value: 90, style: 'negative' },
  { id: 'r4', target: '*growth', op: '<', value: 0, style: 'text-negative' },
  { id: 'r5', target: '*growth', op: '>', value: 0, style: 'text-positive' },
]

interface GridPrefs {
  calc: Record<string, CalcMeasure[]>
  rules: FormatRule[]
  widths: Record<string, number>
  saveCalc: (datasetId: string, m: CalcMeasure) => void
  removeCalc: (datasetId: string, id: string) => void
  setRules: (rules: FormatRule[]) => void
  setWidth: (col: string, w: number) => void
}

export const useGridPrefs = create<GridPrefs>()(
  persist(
    (set, get) => ({
      calc: {},
      rules: DEFAULT_RULES,
      widths: {},
      saveCalc: (ds, m) => {
        const list = (get().calc[ds] ?? []).filter((x) => x.id !== m.id)
        set({ calc: { ...get().calc, [ds]: [...list, m] } })
      },
      removeCalc: (ds, id) => set({ calc: { ...get().calc, [ds]: (get().calc[ds] ?? []).filter((x) => x.id !== id) } }),
      setRules: (rules) => set({ rules }),
      setWidth: (col, w) => set({ widths: { ...get().widths, [col]: Math.round(Math.max(72, Math.min(480, w))) } }),
    }),
    {
      name: 'dod.grid',
      // v2: sub-column choices moved into the Analysis Layout; old per-measure views are dropped.
      version: 2,
      migrate: (persisted) => {
        const { views: _views, ...rest } = (persisted ?? {}) as Record<string, unknown>
        void _views
        return rest as unknown as GridPrefs
      },
      storage: createJSONStorage(() => localStorage),
    },
  ),
)

const NO_CALC: CalcMeasure[] = []
export const selectCalc = (datasetId: string) => (s: GridPrefs) => s.calc[datasetId] ?? NO_CALC

export function ruleMatches(r: FormatRule, v: number) {
  return r.op === '<' ? v < r.value : r.op === '<=' ? v <= r.value : r.op === '>' ? v > r.value : r.op === '>=' ? v >= r.value : v === r.value
}
