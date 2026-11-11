/**
 * Analysis workspace configuration (what to ask), never the result data itself.
 * Kept in sessionStorage so a refresh keeps the user's layout.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChartType, DataScope, Dataset, FieldKind, Filter } from '@/types/contracts'
import type { MeasureSetting } from '@/semantic/measureEngine'
import { addGroup, flatten, fromMeasures, moveBlock, placeMeasure, removeGroup, removeMeasure, renameGroup, type MeasureBlock } from './measureLayout'
import { useUiStore } from './uiStore'
import type { SavedLayout } from '@/types/report'

export type Zone = 'dimensions' | 'measures'
export const zoneFor = (kind: FieldKind): Zone => (kind === 'dimension' ? 'dimensions' : 'measures')

/**
 * Supporting cards of the Analysis page. Collapsed, a card becomes a vertical tab at the left
 * (settings, chart, profile) or right edge (the rest); opened, it returns to its original place. Each card
 * has its own state, and all start collapsed so KPI and Tabel Hasil lead the page. Filters are not a card: they open
 * in a modal from the Filter tab.
 */
export type Panel = 'settings' | 'fields' | 'layout' | 'chart' | 'profile'
export const LEFT_PANELS: Panel[] = ['settings', 'chart', 'profile']
export const RIGHT_PANELS: Panel[] = ['fields', 'layout']
const ALL_COLLAPSED: Record<Panel, boolean> = { settings: true, fields: true, layout: true, chart: true, profile: true }

export interface TableOptions {
  subtotal: boolean
  grandTotal: boolean
  conditional: boolean
  /**
   * Frozen hierarchy columns (dimension ids). null = automatic: columns from the left are frozen
   * while they take at most half of the table's visible width, so measures can always scroll.
   */
  freeze?: string[] | null
}

/**
 * Data Profil card: the kebun / business unit, the kind of profile (blok, kendaraan), the search text and,
 * per kind, the open record. A record belongs to one unit, so changing the unit clears both.
 */
export type ProfileReport = 'blok' | 'kendaraan'
export type BlockProfileTab = 'profil' | 'produksi' | 'perawatan' | 'pemupukan' | 'biaya'
export type VehicleProfileTab = 'profil' | 'kpi' | 'biaya' | 'kegiatan' | 'wo' | 'keputusan'
export interface ProfileState {
  unit: string
  report: ProfileReport
  q: string
  blok: string
  kendaraan: string
  /** Open tab of each report, and the month of the operational tabs ('' = the latest month with data). */
  blokTab: BlockProfileTab
  kendaraanTab: VehicleProfileTab
  period: string
}
const DEFAULT_PROFILE: ProfileState = { unit: '', report: 'blok', q: '', blok: '', kendaraan: '', blokTab: 'profil', kendaraanTab: 'profil', period: '' }
const BLOCK_TABS: BlockProfileTab[] = ['profil', 'produksi', 'perawatan', 'pemupukan', 'biaya']
const VEHICLE_TABS: VehicleProfileTab[] = ['profil', 'kpi', 'biaya', 'kegiatan', 'wo', 'keputusan']

interface AnalysisState {
  datasetId: string
  scope: DataScope
  filter: Filter
  dimensions: string[]
  /** Flat measure order, derived from measureLayout (kept for readers that need a plain list). */
  measures: string[]
  /** Measure order and optional Measure Groups: the single source of the table's column structure. */
  measureLayout: MeasureBlock[]
  /** Per-measure presentation (display calculations, alias, format). Absent = raw presentation. */
  measureSettings: Record<string, MeasureSetting>
  chartType: ChartType
  chartBy: string
  table: TableOptions
  collapsed: Record<Panel, boolean>
  profile: ProfileState
  setProfileUnit: (unit: string) => void
  setProfileReport: (r: ProfileReport) => void
  setProfile: (patch: Partial<Pick<ProfileState, 'q' | ProfileReport | 'blokTab' | 'kendaraanTab' | 'period'>>) => void
  /** Tabel Hasil uses the whole workspace; every other card is hidden (not unmounted). Not persisted. */
  tableFocus: boolean
  togglePanel: (p: Panel) => void
  setPanel: (p: Panel, collapsed: boolean) => void
  collapseAll: () => void
  setTableFocus: (on: boolean) => void
  setDataset: (ds: Dataset) => void
  clearScope: (key: string) => void
  /** The filter modal's Terapkan: period, single-value filters and multi-value lists at once (one query). */
  applyFilters: (filter: Filter, scope: DataScope) => void
  /** Single-value dimension filter (warehouse datasets' filter bar). */
  setFieldFilter: (dim: string, value: string | null) => void
  /** Adds or moves a field into a zone at `index` (end when omitted). */
  placeField: (fieldId: string, zone: Zone, index?: number) => void
  removeField: (fieldId: string) => void
  /** Moves a measure to the top level (group null) or into a group, at an index of that container. */
  moveMeasure: (id: string, group: string | null, index?: number) => void
  moveMeasureBlock: (id: string, index: number) => void
  addMeasureGroup: (name: string) => string
  renameMeasureGroup: (id: string, name: string) => void
  removeMeasureGroup: (id: string) => void
  setMeasureSetting: (id: string, patch: Partial<MeasureSetting> | null) => void
  /** Removes all groups and per-measure settings: back to the raw dataset presentation. */
  resetMeasureConfig: () => void
  setChartType: (t: ChartType) => void
  setChartBy: (by: string) => void
  setTable: (t: Partial<TableOptions>) => void
}

const EMPTY_SCOPE: DataScope = { group: [], region: [], wilayah: [], perusahaan: [] }
export const DEFAULT_FILTER: Filter = { perusahaan: null, wilayah: null, dateFrom: '2026-01-01', dateTo: '2026-09-30' }

/** Year-to-date of the latest data, clamped to the dataset's coverage. */
function defaultWindow(ds: Dataset): Pick<Filter, 'dateFrom' | 'dateTo'> {
  // End at the last complete month, so a month that has only a few days of data does not read as a drop.
  let to = ds.coverage.to
  const [y, m, d] = to.split('-').map(Number) as [number, number, number]
  const monthEnd = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d < monthEnd && m > 1) {
    const prev = new Date(Date.UTC(y, m - 1, 0))
    to = prev.toISOString().slice(0, 10)
  }
  if (to < ds.coverage.from) to = ds.coverage.to
  const from = `${to.slice(0, 4)}-01-01`
  return { dateFrom: from < ds.coverage.from ? ds.coverage.from : from, dateTo: to }
}

export const useAnalysisStore = create<AnalysisState>()(
  persist(
    (set, get) => ({
      // Empty until the Analysis page picks a dataset from DOD's database (setDataset).
      datasetId: '',
      scope: EMPTY_SCOPE,
      filter: DEFAULT_FILTER,
      dimensions: [],
      measures: [],
      measureLayout: [],
      measureSettings: {},
      chartType: useUiStore.getState().settings.defaultChartType,
      chartBy: 'trend',
      table: { subtotal: true, grandTotal: true, conditional: true },
          collapsed: ALL_COLLAPSED,
      profile: DEFAULT_PROFILE,
      setProfileUnit: (unit) => set({ profile: { ...get().profile, unit, q: '', blok: '', kendaraan: '' } }),
      setProfileReport: (report) => set({ profile: { ...get().profile, report, q: '' } }),
      setProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
      tableFocus: false,
      togglePanel: (p) => set({ collapsed: { ...get().collapsed, [p]: !get().collapsed[p] } }),
      setPanel: (p, c) => set({ collapsed: { ...get().collapsed, [p]: c } }),
      collapseAll: () => set({ collapsed: ALL_COLLAPSED }),
      setTableFocus: (tableFocus) => set({ tableFocus }),

      setDataset: (ds) => {
        // Start from the dataset's own raw measures only: derived/calculated ones are added by the user.
        const raw = [...new Set(ds.defaultLayout.measures)].filter((id) => ds.fields.some((f) => f.id === id && f.kind === 'measure' && f.calc?.kind !== 'ratio'))
        set({
          datasetId: ds.id,
          dimensions: [...new Set(ds.defaultLayout.dimensions)],
          measures: raw,
          measureLayout: fromMeasures(raw),
          measureSettings: {},
          chartBy: 'trend',
          table: { ...get().table, freeze: null },
          // Each dataset has its own dimensions: scope and filters start empty, dates at its latest data.
          scope: {},
          filter: { perusahaan: null, wilayah: null, fields: {}, ...defaultWindow(ds) },
        })
      },
      clearScope: (key) => set({ scope: { ...get().scope, [key]: [] } }),
      applyFilters: (filter, scope) => set({ filter, scope }),
      setFieldFilter: (dim, value) => set({ filter: { ...get().filter, fields: { ...get().filter.fields, [dim]: value } } }),
      placeField: (fieldId, zone, index) => {
        if (zone === 'measures') {
          // Adding from the Field List puts the measure at the top level; existing ones stay where they are.
          if (get().measures.includes(fieldId) && index == null) return
          const measureLayout = placeMeasure(get().measureLayout, fieldId, null, index)
          set({ measureLayout, measures: flatten(measureLayout) })
          return
        }
        const list = get()[zone].filter((f) => f !== fieldId)
        const from = get()[zone].indexOf(fieldId)
        let at = index ?? list.length
        if (from > -1 && index != null && from < index) at -= 1
        list.splice(Math.max(0, Math.min(at, list.length)), 0, fieldId)
        set({ [zone]: list } as Pick<AnalysisState, Zone>)
      },
      removeField: (fieldId) => {
        const s = get()
        const measureLayout = removeMeasure(s.measureLayout, fieldId)
        const measureSettings = { ...s.measureSettings }
        delete measureSettings[fieldId]
        set({
          dimensions: s.dimensions.filter((f) => f !== fieldId),
          measures: flatten(measureLayout),
          measureLayout,
          measureSettings,
          chartBy: s.chartBy === fieldId ? 'trend' : s.chartBy,
        })
      },
      moveMeasure: (id, group, index) => {
        const measureLayout = placeMeasure(get().measureLayout, id, group, index)
        set({ measureLayout, measures: flatten(measureLayout) })
      },
      moveMeasureBlock: (id, index) => {
        const measureLayout = moveBlock(get().measureLayout, id, index)
        set({ measureLayout, measures: flatten(measureLayout) })
      },
      addMeasureGroup: (name) => {
        const id = `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
        set({ measureLayout: addGroup(get().measureLayout, id, name) })
        return id
      },
      renameMeasureGroup: (id, name) => set({ measureLayout: renameGroup(get().measureLayout, id, name) }),
      removeMeasureGroup: (id) => {
        const measureLayout = removeGroup(get().measureLayout, id)
        set({ measureLayout, measures: flatten(measureLayout) })
      },
      setMeasureSetting: (id, patch) => {
        const cur = get().measureSettings
        if (patch == null) {
          const next = { ...cur }
          delete next[id]
          set({ measureSettings: next })
          return
        }
        set({ measureSettings: { ...cur, [id]: { ...cur[id], ...patch } } })
      },
      resetMeasureConfig: () => {
        const measures = get().measures
        set({ measureLayout: fromMeasures(measures), measureSettings: {} })
      },
      setChartType: (chartType) => set({ chartType }),
      setChartBy: (chartBy) => set({ chartBy }),
      setTable: (t) => set({ table: { ...get().table, ...t } }),
    }),
    {
      name: 'dod.analysis',
      // v3: cards start collapsed. v4: measure layout (groups, per-measure settings) is part of Layout.
      // v5: sample datasets removed; a session still on one starts over on a database dataset.
      // v6: the Auto Insights and Explain This Number cards were removed (their panel state is dropped in merge).
      version: 6,
      migrate: (persisted, version) => {
        const p = { ...(persisted as Partial<AnalysisState>) }
        if (version < 3) p.collapsed = ALL_COLLAPSED
        if (version < 4) {
          p.measureLayout = fromMeasures(p.measures ?? [])
          p.measureSettings = {}
        }
        if (version < 5 && ['produksi', 'perawatan', 'pemupukan'].includes(p.datasetId ?? '')) {
          Object.assign(p, { datasetId: '', dimensions: [], measures: [], measureLayout: [], measureSettings: {}, scope: EMPTY_SCOPE, filter: DEFAULT_FILTER })
        }
        return p as AnalysisState
      },
      storage: createJSONStorage(() => sessionStorage),
      // Focus mode is a momentary view; a refresh always returns to the normal page.
      partialize: (st) => {
        const { tableFocus: _focus, ...rest } = st
        void _focus
        return rest
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AnalysisState>
        const collapsed = Object.fromEntries((Object.keys(ALL_COLLAPSED) as Panel[]).map((k) => [k, p.collapsed?.[k] ?? true])) as Record<Panel, boolean>
        const merged = { ...current, ...p, collapsed, profile: profileOf(p.profile) }
        delete (merged as { explainKpi?: unknown }).explainKpi
        // measures is always derived from measureLayout.
        if (!p.measureLayout && p.measures) merged.measureLayout = fromMeasures(p.measures)
        merged.measures = flatten(merged.measureLayout)
        return merged
      },
    },
  ),
)

/** Session state of an older Data Profil card (a picker per report) starts over on the defaults. */
function profileOf(p: unknown): ProfileState {
  const o = (p ?? {}) as Record<string, unknown>
  const str = (k: keyof ProfileState) => (typeof o[k] === 'string' ? (o[k] as string) : DEFAULT_PROFILE[k])
  const pick = <T extends string>(v: unknown, all: T[]): T => (all.includes(v as T) ? (v as T) : all[0]!)
  return {
    unit: str('unit'),
    report: o.report === 'kendaraan' ? 'kendaraan' : 'blok',
    q: str('q'),
    blok: str('blok'),
    kendaraan: str('kendaraan'),
    blokTab: pick(o.blokTab, BLOCK_TABS),
    kendaraanTab: pick(o.kendaraanTab, VEHICLE_TABS),
    period: typeof o.period === 'string' && /^\d{4}-\d{2}$/.test(o.period) ? o.period : '',
  }
}

/** What Simpan Laporan stores: the page's configuration, without result data or momentary panel state. */
export const selectSavedLayout = (s: AnalysisState, calc: unknown[]): SavedLayout => ({
  scope: s.scope,
  filter: s.filter as unknown as Record<string, unknown>,
  dimensions: s.dimensions,
  measureLayout: s.measureLayout,
  measureSettings: s.measureSettings,
  chartType: s.chartType,
  chartBy: s.chartBy,
  table: s.table as unknown as Record<string, unknown>,
  calc,
})
