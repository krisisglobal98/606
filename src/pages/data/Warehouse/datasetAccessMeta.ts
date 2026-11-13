/** Texts of a dataset's data-access status (DatasetAccessCard, and the notice after a dataset is saved). */
import type { DatasetOrgInfo, DatasetOrgStatus, WhDataset } from '@/types/warehouse'
import { formatNumber } from '@/utils/format'
import { tr } from '@/i18n'

export const ACCESS_BADGE: Record<DatasetOrgStatus, { cls: string; label: string }> = {
  OK: { cls: 'badge--success', label: tr('Siap') },
  PARTIAL: { cls: 'badge--warning', label: tr('Siap sebagian') },
  UNVERIFIED: { cls: 'badge--warning', label: tr('Belum divalidasi') },
  FAILED: { cls: 'badge--danger', label: tr('Tidak cocok dengan master') },
  NONPIMS: { cls: 'badge--danger', label: tr('Kolom unit bukan kode PIMS') },
  NONE: { cls: 'badge--danger', label: tr('Kolom unit tidak lengkap') },
}

/** What the status means for the users, and what to do. */
export function statusText(st: DatasetOrgStatus, info?: DatasetOrgInfo | null): string {
  switch (st) {
    case 'OK':
      return tr('Data dibatasi sesuai akses data tiap pengguna.')
    case 'PARTIAL':
      return tr('Data dibatasi sesuai akses data; {0}% baris tanpa kode Unit Operasional PIMS disembunyikan dari pengguna bercakupan.', formatNumber((info?.validation?.detail.unmappedShare ?? 0) * 100, 1))
    case 'UNVERIFIED':
      return tr('Nilai kolom Unit Operasional belum dicocokkan dengan master organisasi PIMS (dataset baru atau baru diubah). Pengguna bercakupan belum dapat melihat datanya sampai divalidasi.')
    case 'FAILED':
      return tr('Tidak satu pun nilai kolom Unit Operasional cocok dengan kode Unit Operasional PIMS. Perbaiki sumbernya, lalu validasi lagi.')
    default:
      return info?.profile.standardProblem?.message ?? tr('Kolom Unit Operasional dataset tidak dapat dipakai untuk pembatasan akses data.')
  }
}

export const isUsable = (st: DatasetOrgStatus) => st === 'OK' || st === 'PARTIAL'

/** The notice after a dataset was saved, from the validation that ran right after it. */
export function savedValidationToast(r: WhDataset['orgValidation']): [string, 'success' | 'error'] {
  if (!r) return [tr('Dataset disimpan.'), 'success']
  if (isUsable(r.status)) return [tr('Dataset disimpan dan divalidasi: {0}.', ACCESS_BADGE[r.status].label.toLowerCase()), 'success']
  return [tr('Dataset disimpan, tetapi belum dapat dipakai pengguna bercakupan: {0}', r.error ?? statusText(r.status)), 'error']
}
