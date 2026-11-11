import { LOCALE, tr } from '@/i18n'

/** Compact row counts: 3.088.349 → "3,09 jt". */
export function rowsLabel(n: number | null | undefined): string {
  if (n == null) return tr('belum dianalisis')
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} jt`
  if (n >= 1e3) return `${(n / 1e3).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} rb`
  return n.toLocaleString(LOCALE)
}
