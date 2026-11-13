/** Labels and periods of Settings › Log Query. */
import { tr } from '@/i18n'

const KIND: Record<string, string> = {
  'analytics.query': tr('Analisis (ringkasan & grafik)'),
  'analytics.grid': tr('Analisis (tabel hasil)'),
  'dataset.values': tr('Nilai filter'),
  'dataset.coverage': tr('Rentang tanggal dataset'),
  'dataset.org_validation': tr('Validasi akses data'),
}
/** A readable name for a query kind; metadata reads and unknown kinds keep their code. */
export const kindLabel = (k: string) => KIND[k] ?? (k.startsWith('metadata') ? tr('Metadata sumber ({0})', k.slice(9) || k) : k)

const ERROR: Record<string, string> = {
  SOURCE_TIMEOUT: tr('waktu habis'),
  SOURCE_NETWORK_FAILURE: tr('sumber tidak terjangkau'),
  SOURCE_AUTH_FAILED: tr('login sumber ditolak'),
  SOURCE_SQL_ERROR: tr('kesalahan SQL'),
  SOURCE_QUERY_FAILED: tr('query gagal'),
  SOURCE_TOO_MANY_CONNECTIONS: tr('koneksi sumber penuh'),
}
export const errorLabel = (code: string) => ERROR[code] ?? code

export type PeriodPreset = 'today' | '7' | '30' | 'custom'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Calendar dates in the browser's time zone; `to` is today (included). */
export function periodRange(p: PeriodPreset, now = new Date()): { from: string; to: string } {
  const to = iso(now)
  if (p === 'today' || p === 'custom') return { from: to, to }
  const from = new Date(now)
  from.setDate(from.getDate() - (Number(p) - 1))
  return { from: iso(from), to }
}
