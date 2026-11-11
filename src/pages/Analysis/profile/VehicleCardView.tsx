import { AlertTriangle, Building2, Truck } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/common/StateView'
import { useResource } from '@/hooks/useResource'
import { profileService } from '@/services/profile/profileService'
import { useAnalysisStore, type VehicleProfileTab } from '@/stores/analysisStore'
import type { VehicleCard } from '@/types/profile'
import { formatDate, formatNumber } from '@/utils/format'
import s from '../Analysis.module.css'
import { Facts, Meta, ProfileSkeleton, Tile } from './parts'
import { ProfilePicker } from './ProfilePicker'
import { ProfileTabs } from './ProfileTabs'
import { VehicleOpsView } from './VehicleOpsView'
import { daysUntil, useDebounced } from './util'
import { tr } from '@/i18n'

const TABS: { id: VehicleProfileTab; label: string }[] = [
  { id: 'profil', label: tr('Profil') },
  { id: 'kpi', label: tr('KPI') },
  { id: 'biaya', label: tr('Biaya') },
  { id: 'kegiatan', label: tr('Kegiatan') },
  { id: 'wo', label: tr('Work Order') },
  { id: 'keputusan', label: tr('Keputusan') },
]

/** Kartu Kendaraan: the vehicles of the chosen unit, then the card of the one picked next to the list. */
export function VehicleCardView({ unit }: { unit: string }) {
  const pickId = useAnalysisStore((st) => st.profile.kendaraan)
  const search = useAnalysisStore((st) => st.profile.q)
  const set = useAnalysisStore((st) => st.setProfile)
  const q = useDebounced(search)
  const list = useResource((signal) => profileService.vehicles({ unit, q }, signal), `profile-vehicles|${unit}|${q}`)
  const detail = useResource((signal) => (pickId ? profileService.vehicle(pickId, signal) : Promise.resolve(null)), `profile-vehicle|${pickId}`)
  const vehicle = detail.data && detail.data.id === pickId ? detail.data : null
  const tab = useAnalysisStore((st) => st.profile.kendaraanTab)

  return (
    <>
      <ProfilePicker
        label={tr('Kendaraan')}
        q={search}
        onQ={(v) => set({ q: v })}
        placeholder={tr('Kode, nama, no. polisi, no. aset')}
        items={list.data?.items.map((v) => ({ id: v.id, title: v.code, meta: [v.group, v.name !== v.code ? v.name : null].filter(Boolean).join(' · '), tag: v.registrationNo ? <span className={s.plateSm}>{v.registrationNo}</span> : undefined })) ?? null}
        more={!!list.data?.more}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        selected={pickId}
        onSelect={(id) => set({ kendaraan: id, period: '' })}
      />
      <div className={s.profileView} aria-live="polite">
        {!pickId ? (
          <EmptyState title={tr('Pilih kendaraan')} message={tr('Pilih kendaraan dari daftar di kiri; kartunya tampil di sini.')} height={320} />
        ) : detail.status === 'error' && !vehicle ? (
          <ErrorState message={detail.error ?? tr('')} onRetry={detail.reload} height={320} />
        ) : !vehicle ? (
          <ProfileSkeleton />
        ) : (
          <>
            <div className={s.recordLine}>
              <Truck size={15} aria-hidden /> <b>{vehicle.code}</b> {vehicle.identity.registrationNo && <span className={s.plateSm}>{vehicle.identity.registrationNo}</span>} <span>{[vehicle.group.name, vehicle.org.unit].filter(Boolean).join(' · ')}</span>
            </div>
            <ProfileTabs tabs={TABS} value={tab} onChange={(t) => set({ kendaraanTab: t })} label={tr('Kartu kendaraan {0}', vehicle.code)} panelId="profile-vehicle-panel" />
            <div id="profile-vehicle-panel" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
              {tab === 'profil' ? <VehicleDetail v={vehicle} /> : <VehicleOpsView vehicleId={vehicle.id} tab={tab} />}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function VehicleDetail({ v }: { v: VehicleCard }) {
  const uom = v.group.uom ? (/hour/i.test(v.group.uom) ? 'HM' : /kilo/i.test(v.group.uom) ? 'km' : v.group.uom) : ''
  const stnk = v.dates.stnkUntil ? daysUntil(v.dates.stnkUntil) : null
  const stnkTone = stnk === null ? undefined : stnk < 0 ? 'danger' : stnk <= 30 ? 'warning' : undefined
  const madeYear = v.dates.made ? Number(v.dates.made.slice(0, 4)) : null
  const age = madeYear ? new Date().getFullYear() - madeYear : null
  const used = v.meter.end !== null && v.meter.start !== null ? v.meter.end - v.meter.start : null
  return (
    <article className={s.profileDoc} aria-label={tr('Kartu kendaraan {0}', v.code)}>
      <header className={s.profileHead}>
        <span className={s.profileIcon} aria-hidden>
          {v.group.category && /alat|mesin/i.test(v.group.category) ? <Building2 size={18} /> : <Truck size={18} />}
        </span>
        <div>
          <h3>
            {v.code} <small>{v.name !== v.code ? v.name : tr('')}</small>
          </h3>
          <p className={s.profilePath}>{[v.group.name, v.group.category, v.org.unit, v.org.company].filter(Boolean).join(' · ') || tr('–')}</p>
        </div>
        <div className={s.profileBadges}>
          {v.identity.registrationNo && <span className={s.plate}>{v.identity.registrationNo}</span>}
          {v.downtime && (
            <span className="badge badge--warning">
              <AlertTriangle size={11} aria-hidden />{' '}{tr('Downtime')}
            </span>
          )}
          <span className={`badge ${v.active ? 'badge--success' : 'badge--danger'}`}>{v.active ? tr('Aktif') : tr('Nonaktif')}</span>
        </div>
      </header>

      <div className={s.ptiles}>
        <Tile label={tr('{0} terakhir', uom === 'HM' ? 'HM' : 'KM')} value={v.meter.end === null ? null : formatNumber(v.meter.end, 0)} unit={uom} sub={used !== null ? tr('{0} {1} sejak awal', formatNumber(used, 0), uom) : tr('meter awal belum tercatat')} />
        <Tile label={tr('Tahun pembuatan')} value={madeYear} sub={age !== null ? tr('umur {0} tahun', age) : tr('belum tercatat')} />
        <Tile
          label={tr('STNK berlaku s.d.')}
          value={v.dates.stnkUntil ? formatDate(v.dates.stnkUntil) : null}
          sub={stnk === null ? tr('belum tercatat') : stnk < 0 ? tr('lewat {0} hari', formatNumber(-stnk, 0)) : stnk <= 30 ? tr('{0} hari lagi', formatNumber(stnk, 0)) : tr('masih berlaku')}
          tone={stnkTone}
        />
        <Tile label={tr('Kepemilikan')} value={v.ownership.kind} sub={v.ownership.description ?? undefined} />
      </div>

      <div className={s.factGrid}>
        <Facts title={tr('Identitas')} rows={[[tr('No. polisi'), v.identity.registrationNo], [tr('No. aset'), v.identity.assetNumber], [tr('Alokasi kontrol'), v.identity.controlAllocation], [tr('No. mesin'), v.identity.engineNo], [tr('No. rangka'), v.identity.chassisNo]]} />
        <Facts title={tr('Spesifikasi')} rows={[[tr('Kelompok'), v.group.name && `${v.group.code} · ${v.group.name}`], [tr('Kategori'), v.group.category], [tr('Model'), v.identity.model], [tr('Merk'), v.identity.merk], [tr('Tipe'), v.identity.type], [tr('Satuan meter'), v.group.uom]]} />
        <Facts title={tr('Tanggal')} rows={[[tr('Pembuatan'), v.dates.made && formatDate(v.dates.made)], [tr('Pembelian'), v.dates.purchased && formatDate(v.dates.purchased)], [tr('STNK berlaku s.d.'), v.dates.stnkUntil && formatDate(v.dates.stnkUntil)], [tr('Pemutihan'), v.dates.whitened && formatDate(v.dates.whitened)]]} />
        <Facts title={tr('Meter')} rows={[[tr('Awal'), v.meter.start !== null ? `${formatNumber(v.meter.start, 0)} ${uom}` : null], [tr('Terakhir'), v.meter.end !== null ? `${formatNumber(v.meter.end, 0)} ${uom}` : null], [tr('Penyesuaian awal'), v.meter.startAdjust !== null ? `${formatNumber(v.meter.startAdjust, 0)} ${uom}` : null], [tr('Penyesuaian akhir'), v.meter.endAdjust !== null ? `${formatNumber(v.meter.endAdjust, 0)} ${uom}` : null]]} />
      </div>

      <Meta remark={v.remark} validFrom={v.validFrom} updatedAt={v.updatedAt} />
    </article>
  )
}
