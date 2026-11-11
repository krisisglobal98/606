import type { SavedReport } from '@/types/report'

export interface CategoryRow {
  id: string
  name: string
  parentId: string | null
}
export interface CategoryNode {
  id: string
  name: string
  /** Reports on this category and its sub-categories. */
  count: number
  subs: { id: string; name: string; count: number }[]
}
/** Selection of the category tree. */
export const ALL = 'all'
export const NONE = 'none'

/** Master categories that hold reports (directly or in a sub-category), as a two-level tree. */
export function categoryTree(categories: CategoryRow[], reports: Pick<SavedReport, 'categoryId'>[]): CategoryNode[] {
  const own = (id: string) => reports.filter((r) => r.categoryId === id).length
  return categories
    .filter((c) => !c.parentId)
    .map((c) => {
      const subs = categories.filter((x) => x.parentId === c.id).map((x) => ({ id: x.id, name: x.name, count: own(x.id) })).filter((x) => x.count > 0)
      return { id: c.id, name: c.name, count: own(c.id) + subs.reduce((n, x) => n + x.count, 0), subs }
    })
    .filter((c) => c.count > 0)
}

type Named = Pick<SavedReport, 'categoryId' | 'name' | 'datasetName'>
export interface ReportGroup<T> {
  id: string
  name: string
  /** Reports directly on this category. */
  reports: T[]
  subs: { id: string; name: string; reports: T[] }[]
  /** Reports here and in the sub-categories. */
  count: number
}

/**
 * The sidebar's list: master categories → sub-categories → reports, narrowed by a search over the report and dataset
 * names. Empty categories are left out; reports whose category was deleted go to a last group with id `NONE`.
 */
export function reportTree<T extends Named>(categories: CategoryRow[], reports: T[], q = '', noneLabel = ''): ReportGroup<T>[] {
  const t = q.trim().toLowerCase()
  const shown = t ? reports.filter((r) => `${r.name} ${r.datasetName ?? ''}`.toLowerCase().includes(t)) : reports
  const on = (id: string) => shown.filter((r) => r.categoryId === id)
  const groups: ReportGroup<T>[] = categories
    .filter((c) => !c.parentId)
    .map((c) => {
      const subs = categories.filter((x) => x.parentId === c.id).map((x) => ({ id: x.id, name: x.name, reports: on(x.id) })).filter((x) => x.reports.length)
      const own = on(c.id)
      return { id: c.id, name: c.name, reports: own, subs, count: own.length + subs.reduce((n, x) => n + x.reports.length, 0) }
    })
    .filter((g) => g.count > 0)
  // A report on a sub-category whose parent is gone, or on a deleted category, is still listed.
  const placed = new Set(groups.flatMap((g) => [...g.reports, ...g.subs.flatMap((x) => x.reports)]))
  const rest = shown.filter((r) => !placed.has(r))
  if (rest.length) groups.push({ id: NONE, name: noneLabel, reports: rest, subs: [], count: rest.length })
  return groups
}

/** The reports of the selection: a category includes its sub-categories; `NONE` holds those whose category was deleted. */
export function reportsIn<T extends Pick<SavedReport, 'categoryId'>>(selection: string, categories: CategoryRow[], reports: T[]): T[] {
  if (selection === ALL) return reports
  if (selection === NONE) return reports.filter((r) => !r.categoryId)
  const ids = new Set([selection, ...categories.filter((c) => c.parentId === selection).map((c) => c.id)])
  return reports.filter((r) => r.categoryId != null && ids.has(r.categoryId))
}
