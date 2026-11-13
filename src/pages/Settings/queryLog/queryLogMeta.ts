/** Labels and periods of Settings › Log Query. */
import { tr } from '@/i18n'

/** Every kind the server records (tests/queryLogMeta.test.ts checks the server code against this list). */
export const KIND_LABELS: Record<string, string> = {
  'analytics.main': tr('Analisis (ringkasan)'),
  'analytics.chart': tr('Analisis (grafik)'),
  'analytics.grid': tr('Analisis (tabel hasil)'),
  'dataset.values': tr('Nilai filter'),
  'dataset.coverage': tr('Rentang tanggal dataset'),
  'dataset.org_validation': tr('Validasi akses data'),
  health: tr('Cek kesehatan sumber'),
  'test.ping': tr('Uji koneksi sumber'),
}
const METADATA: Record<string, string> = {
  schemas: tr('skema'),
  tables: tr('tabel'),
  columns: tr('kolom'),
  indexes: tr('indeks'),
  privileges: tr('hak akses akun'),
  server: tr('info server'),
}
/** A readable name for a query kind; kinds of older versions keep their code, marked as such. */
export function kindLabel(k: string): string {
  if (KIND_LABELS[k]) return KIND_LABELS[k]
  if (k.startsWith('metadata.')) return tr('Metadata sumber: {0}', METADATA[k.slice(9)] ?? k.slice(9))
  return tr('Versi lama ({0})', k)
}

const ERROR: Record<string, string> = {
  SOURCE_TIMEOUT: tr('waktu habis'),
  SOURCE_NETWORK_FAILURE: tr('sumber tidak terjangkau'),
  SOURCE_UNAVAILABLE: tr('sumber tidak tersedia'),
  SOURCE_AUTH_FAILED: tr('login sumber ditolak'),
  SOURCE_TABLE_UNAVAILABLE: tr('tabel sumber tidak ada / tidak boleh dibaca'),
  SOURCE_SQL_ERROR: tr('kesalahan SQL'),
  SOURCE_QUERY_FAILED: tr('query gagal'),
  SOURCE_TOO_MANY_CONNECTIONS: tr('koneksi sumber penuh'),
  SOURCE_NOT_CONFIGURED: tr('password koneksi belum diisi'),
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
