import type { BlockProfile } from '@/types/profile'
import { tr } from '@/i18n'

/** Figures of the Areal Statement that are worked out from the master data; null when a part is missing. */
export function arealIndicators(b: Pick<BlockProfile, 'area' | 'stand'>) {
  const { blockHa, plantedHa, other } = b.area
  const { initial, total, insertion } = b.stand
  const round2 = (v: number) => Math.round(v * 100) / 100
  return {
    otherTotalHa: round2(other.reduce((a, o) => a + o.ha, 0)),
    areaGapHa: blockHa !== null && plantedHa !== null ? round2(blockHa - plantedHa) : null,
    plantedPct: blockHa && plantedHa !== null ? round2((plantedHa / blockHa) * 100) : null,
    standGap: initial !== null && total !== null ? initial - total : null,
    density: total !== null && plantedHa ? round2(total / plantedHa) : null,
    insertionPct: total && insertion !== null ? round2((insertion / total) * 100) : null,
  }
}

/** Age by calendar year, the way the Areal Statement reads it ("Sekitar 26 Tahun"). */
export function ageAround(plantedOn: string | null, year: number): number | null {
  const y = plantedOn ? Number(plantedOn.slice(0, 4)) : NaN
  return Number.isFinite(y) && y <= year ? year - y : null
}

/** Items of the statement that DOD has no source for yet; the validity date comes from the master when it is filled. */
export function arealNotAvailable(validFrom: string | null): string[] {
  return [
    tr('Luas TM (Tanaman Menghasilkan)'),
    tr('Luas TBM (Tanaman Belum Menghasilkan)'),
    tr('Luas TTI/TK (jika digunakan)'),
    tr('Jumlah Pokok Hidup'),
    tr('Jumlah Pokok Mati'),
    tr('Jumlah Pokok per Ha Standar'),
    tr('Sumber Luas (GIS/Survei)'),
    ...(validFrom ? [] : [tr('Tanggal Berlaku Areal Statement')]),
    tr('Tanggal Sensus Pokok'),
    tr('Nomor Dokumen'),
    tr('Disiapkan Oleh'),
    tr('Diperiksa Oleh'),
    tr('Disetujui Oleh'),
  ]
}
