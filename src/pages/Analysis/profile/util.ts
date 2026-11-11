/** Pure helpers of the Data Profil reports. */
import { useEffect, useState } from 'react'
import type { ProfileReport } from '@/stores/analysisStore'
import { tr } from '@/i18n'

/** Reports of the Data Profil card; each one is also a sub-menu of Analisis (Settings → Hak Akses Menu). */
export const PROFILE_REPORTS: { value: ProfileReport; label: string; menu: string; hint: string }[] = [
  { value: 'blok', label: tr('Profil Blok'), menu: 'analisis.profil-blok', hint: tr('Organisasi, tanaman, lahan, luas, dan populasi pokok satu blok') },
  { value: 'kendaraan', label: tr('Kartu Kendaraan'), menu: 'analisis.kartu-kendaraan', hint: tr('Identitas, kepemilikan, dokumen, dan meter satu kendaraan atau alat') },
]

/** Search text that waits for typing to pause. */
export function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}

/** Days from today (Asia/Jakarta) to a YYYY-MM-DD day; negative when past. */
export function daysUntil(day: string, today = new Date()): number {
  const now = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000)
}

/**
 * A number typed in an editor: "1.250.000" and "1.250.000,5" (Indonesian), "0,75", "0.75" and "1250000" all
 * read as expected. Empty → null; anything else → NaN.
 */
export function parseNum(input: string): number | null {
  const v = input.trim().replace(/\s/g, '')
  if (!v) return null
  if (v.includes(',')) return Number(v.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, ''))
  return Number(v)
}

const MONTHS = [tr('Januari'), tr('Februari'), tr('Maret'), tr('April'), tr('Mei'), tr('Juni'), tr('Juli'), tr('Agustus'), tr('September'), tr('Oktober'), tr('November'), tr('Desember')]
/** "2026-10" → "Oktober 2026". */
export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`

/** Categorical colours of the cost breakdown (fixed order, so a category keeps its colour across months). */
export const COST_COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#64748b', '#9ca3af']
