import { LOCALE, tr } from '@/i18n'
export const MONTH_SHORT = [tr('Jan'), tr('Feb'), tr('Mar'), tr('Apr'), tr('Mei'), tr('Jun'), tr('Jul'), tr('Agu'), tr('Sep'), tr('Okt'), tr('Nov'), tr('Des')]

const nf = new Map<number, Intl.NumberFormat>()
function formatter(decimals: number) {
  let f = nf.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    nf.set(decimals, f)
  }
  return f
}

/** Indonesian number format (1.234,5). Returns "–" for missing values. */
export function formatNumber(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return '–'
  return formatter(decimals).format(v)
}

export function formatSigned(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '–'
  const s = formatNumber(Math.abs(v), decimals)
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s
}

/** Compact form for chart axes: 12,5 rb / 1,2 jt / 3,4 M. */
export function formatCompact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e12) return `${formatNumber(v / 1e12, 1)} T`
  if (a >= 1e9) return `${formatNumber(v / 1e9, 1)} M`
  if (a >= 1e6) return `${formatNumber(v / 1e6, 1)} jt`
  if (a >= 1e4) return `${formatNumber(v / 1e3, 0)} rb`
  if (a >= 1e3) return `${formatNumber(v / 1e3, 1)} rb`
  return formatNumber(v, a < 10 ? 1 : 0)
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d} ${MONTH_SHORT[Number(m) - 1]} ${y}`
}

/** ISO → "04 Okt 2026 14:00" (local wall time of the source, WIB). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–'
  if (!iso.includes('T')) return formatDate(iso)
  // Always shown in WIB, whatever offset the timestamp was written with.
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '–'
  const wib = new Date(ms + 7 * 3600e3).toISOString()
  return `${formatDate(wib.slice(0, 10))} ${wib.slice(11, 16)}`
}

/** Short relative time against the current clock ("12 mnt lalu", "3 hari lalu"). */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–'
  const diff = (now - Date.parse(iso)) / 1000
  if (!Number.isFinite(diff)) return '–'
  if (diff < 60) return tr('baru saja')
  if (diff < 3600) return tr('{0} mnt lalu', Math.floor(diff / 60))
  if (diff < 86400) return tr('{0} jam lalu', Math.floor(diff / 3600))
  const days = Math.floor(diff / 86400)
  return days < 45 ? tr('{0} hari lalu', days) : formatDateTime(iso)
}
