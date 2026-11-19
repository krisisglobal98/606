import { tr } from '@/i18n'

/**
 * A value filter of one dimension (filter.fields): a value, a list (any of them) or { like } (contains the text,
 * case-insensitive, on the server). null / '' / [] = no filter. Pure: shared by the filter controls, chips, counts,
 * the report header and their tests.
 */
export type FieldFilterValue = string | string[] | { like: string } | null

export const isActiveFilter = (v: FieldFilterValue | undefined): boolean =>
  v != null && (typeof v === 'string' ? v !== '' : Array.isArray(v) ? v.length > 0 : v.like.trim() !== '')

/** Text of a filter for chips and the report header. */
export function filterText(v: FieldFilterValue | undefined): string {
  if (!isActiveFilter(v)) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.join(', ')
  return tr('berisi "{0}"', v!.like.trim())
}

/** The active value filters, in a stable order (for comparisons and counts). */
export const activeFields = (fields: Record<string, FieldFilterValue> | undefined): [string, FieldFilterValue][] =>
  Object.entries(fields ?? {}).filter(([, v]) => isActiveFilter(v)).sort(([a], [b]) => a.localeCompare(b))
