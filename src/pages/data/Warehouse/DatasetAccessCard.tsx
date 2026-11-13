/**
 * Data access of a dataset (Data › Set Data › dataset): which columns carry the organization (Unit Operasional,
 * Group, …), whether the Unit Operasional values were validated against the PIMS master, and the
 * "Validasi akses data" button. Until validated (and after every change of the dataset), users with a data access
 * scope get no data from it.
 */
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { ErrorState, Skeleton } from '@/components/common/StateView'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { datasetService as analysisCatalog } from '@/services/dataset/datasetService'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { toast } from '@/stores/uiStore'
import type { OrgDim, WhDataset } from '@/types/warehouse'
import { formatDateTime, formatNumber } from '@/utils/format'
import { ACCESS_BADGE as BADGE, isUsable, statusText } from './datasetAccessMeta'
import s from './Warehouse.module.css'
import { tr } from '@/i18n'

export function DatasetAccessCard({ d, canValidate }: { d: WhDataset; canValidate: boolean }) {
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const res = useResource((signal) => dataWarehouseService.getDatasetOrg(d.id, signal), `${d.id}|${d.updatedAt}|org#${nonce}`)
  const info = res.data
  const columnsOf = (dim: OrgDim | 'ambiguous' | null) => {
    if (!dim) return null
    if (dim === 'ambiguous') return tr('lebih dari satu kolom (tidak dipakai)')
    const x = d.semantic.dimensions.find((m) => m.id === dim.dim)
    return [...new Set(Object.values(x?.columns ?? {}).filter(Boolean))].join(', ')
  }
  const validate = async () => {
    setBusy(true)
    try {
      const r = await dataWarehouseService.validateDatasetOrg(d.id)
      analysisCatalog.invalidate()
      toast(isUsable(r.status) ? tr('Validasi selesai: {0}.', BADGE[r.status].label.toLowerCase()) : statusText(r.status), isUsable(r.status) ? 'success' : 'error')
      setNonce((n) => n + 1)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tr('Validasi akses data gagal dijalankan.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const blocked = !!info?.profile.standardProblem
  return (
    <Card
      title={tr('Akses data')}
      subtitle={tr('Kolom organisasi yang membatasi data per pengguna, dan validasinya terhadap master PIMS.')}
      actions={
        canValidate && (
          <Button size="sm" variant={info?.status === 'UNVERIFIED' ? 'primary' : 'default'} icon={<ShieldCheck size={14} aria-hidden />} loading={busy} disabled={!info || blocked} title={blocked ? tr('Perbaiki kolom Unit Operasional pada pemetaan terlebih dahulu.') : undefined} onClick={() => void validate()}>
            {tr('Validasi akses data')}
          </Button>
        )
      }
    >
      {res.status === 'error' && !info ? (
        <ErrorState message={res.error ?? tr('')} onRetry={res.reload} />
      ) : !info ? (
        <Skeleton h={120} />
      ) : (
        <>
          <div className={`callout ${info.status === 'OK' ? 'callout--success' : info.status === 'PARTIAL' || info.status === 'UNVERIFIED' ? 'callout--warning' : 'callout--danger'}`} role="status">
            <span>
              <span className={`badge ${BADGE[info.status].cls}`}>{BADGE[info.status].label}</span>{' '}
              {statusText(info.status, info)}
            </span>
          </div>
          <dl className={s.connKv} style={{ marginTop: 12 }}>
            {(
              [
                [tr('Unit Operasional (wajib)'), info.profile.businessUnit],
                [tr('Group'), info.profile.group],
                [tr('Region'), info.profile.region],
                [tr('Perusahaan'), info.profile.company],
                [tr('Rayon'), info.profile.rayon],
                [tr('Divisi'), info.profile.division],
                [tr('Kepemilikan'), info.profile.ownership],
              ] as const
            ).map(([label, dim]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="mono">{columnsOf(dim) ?? <span className="t-meta">{tr('— tidak ada')}</span>}</dd>
              </div>
            ))}
            {info.validation && (
              <div>
                <dt>{tr('Validasi terakhir')}</dt>
                <dd>
                  {formatDateTime(info.validation.checkedAt)} · {formatNumber(info.validation.detail.rows)}{' '}{tr('baris')}
                  {info.validation.detail.unmappedRows > 0 && <> · {formatNumber(info.validation.detail.unmappedRows)}{' '}{tr('baris tanpa kode PIMS')}</>}
                  {info.status === 'UNVERIFIED' && <> · <em>{tr('dataset sudah diubah sesudahnya')}</em></>}
                </dd>
              </div>
            )}
          </dl>
          {!!info.validation?.detail.unmappedValues.length && info.status !== 'UNVERIFIED' && (
            <p className="t-meta" style={{ marginTop: 8 }}>
              {tr('Nilai unit yang bukan kode PIMS:')}{' '}<span className="mono">{info.validation.detail.unmappedValues.slice(0, 8).join(', ')}{info.validation.detail.unmappedValues.length > 8 ? ' …' : ''}</span>
            </p>
          )}
          <p className="t-meta" style={{ marginTop: 8 }}>
            {tr('Kolom yang dikenali: Unit Operasional business_unit / kodebisnisunit (kode PIMS); Group groupcode; Region regioncode; Perusahaan company / companycodeora; Rayon ray / rayon; Divisi afd / afdeling / divisi; Kepemilikan ownership / ownershipname / statuskepemilikan.')}
          </p>
        </>
      )}
    </Card>
  )
}
