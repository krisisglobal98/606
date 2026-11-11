import { MapPin, Sprout } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/common/StateView'
import { useResource } from '@/hooks/useResource'
import { profileService } from '@/services/profile/profileService'
import { useAnalysisStore, type BlockProfileTab } from '@/stores/analysisStore'
import type { BlockProfile } from '@/types/profile'
import { formatDate, formatNumber } from '@/utils/format'
import s from '../Analysis.module.css'
import { ageAround, arealIndicators, arealNotAvailable } from './blockProfileMeta'
import { Facts, Meta, ProfileSkeleton, Tile } from './parts'
import { BlockOpsView } from './BlockOpsView'
import { ProfilePicker } from './ProfilePicker'
import { ProfileTabs } from './ProfileTabs'
import { useDebounced } from './util'
import { tr } from '@/i18n'

const TABS: { id: BlockProfileTab; label: string }[] = [
  { id: 'profil', label: tr('Profil') },
  { id: 'produksi', label: tr('Produksi') },
  { id: 'perawatan', label: tr('Perawatan') },
  { id: 'pemupukan', label: tr('Pemupukan') },
  { id: 'biaya', label: tr('Biaya') },
]

/** Profil Blok: the blocks of the chosen unit, then the profile of the one picked next to the list. */
export function BlockProfileView({ unit }: { unit: string }) {
  const pickId = useAnalysisStore((st) => st.profile.blok)
  const search = useAnalysisStore((st) => st.profile.q)
  const set = useAnalysisStore((st) => st.setProfile)
  const q = useDebounced(search)
  const list = useResource((signal) => profileService.blocks({ unit, q }, signal), `profile-blocks|${unit}|${q}`)
  const detail = useResource((signal) => (pickId ? profileService.block(pickId, signal) : Promise.resolve(null)), `profile-block|${pickId}`)
  const block = detail.data && detail.data.id === pickId ? detail.data : null
  const tab = useAnalysisStore((st) => st.profile.blokTab)

  return (
    <>
      <ProfilePicker
        label={tr('Blok')}
        q={search}
        onQ={(v) => set({ q: v })}
        placeholder={tr('Kode atau nama blok')}
        items={list.data?.items.map((b) => ({ id: b.id, title: b.code, meta: [b.division, b.plantedHa !== null ? `${formatNumber(b.plantedHa, 2)} ha` : null].filter(Boolean).join(' · '), tag: b.status ? <span className="badge">{b.status}</span> : undefined })) ?? null}
        more={!!list.data?.more}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        selected={pickId}
        onSelect={(id) => set({ blok: id, period: '' })}
      />
      <div className={s.profileView} aria-live="polite">
        {!pickId ? (
          <EmptyState title={tr('Pilih blok')} message={tr('Pilih blok dari daftar di kiri; profilnya tampil di sini.')} height={320} />
        ) : detail.status === 'error' && !block ? (
          <ErrorState message={detail.error ?? tr('')} onRetry={detail.reload} height={320} />
        ) : !block ? (
          <ProfileSkeleton />
        ) : (
          <>
            <div className={s.recordLine}>
              <Sprout size={15} aria-hidden /> <b>{block.code}</b> <span>{[block.org.unit, block.org.division].filter(Boolean).join(' · ')}</span>
            </div>
            <ProfileTabs tabs={TABS} value={tab} onChange={(t) => set({ blokTab: t })} label={tr('Profil blok {0}', block.code)} panelId="profile-block-panel" />
            <div id="profile-block-panel" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
              {tab === 'profil' ? <BlockDetail b={block} /> : <BlockOpsView blockId={block.id} tab={tab} />}
            </div>
          </>
        )}
      </div>
    </>
  )
}

const code = (c: string | null, name: string | null) => (c && name ? `${c} - ${name}` : name ?? c)
const haText = (v: number | null) => (v === null ? null : tr('{0} Ha', formatNumber(v, 2)))
const pokok = (v: number | null) => (v === null ? null : tr('{0} Pokok', formatNumber(v, 0)))
const none = (v: string | null) => v ?? tr('Belum tercatat')

/** Profil tab: the block's Areal Statement. The indicators lead; every part of the statement follows in its order. */
function BlockDetail({ b }: { b: BlockProfile }) {
  const st = b.stand
  const ind = arealIndicators(b)
  const year = new Date().getFullYear()
  const age = ageAround(b.planting.plantedOn, year)
  const missing = arealNotAvailable(b.validFrom)
  return (
    <article className={s.profileDoc} aria-label={tr('Areal Statement blok {0}', b.code)}>
      <header className={s.profileHead}>
        <span className={s.profileIcon} aria-hidden>
          <Sprout size={18} />
        </span>
        <div>
          <h3>
            {tr('Areal Statement Blok')}{' '}{b.code} <small>{b.name !== b.code ? b.name : tr('')}</small>
          </h3>
          <p className={s.profilePath}>
            <MapPin size={12} aria-hidden /> {[b.org.unit, b.org.estate, b.org.division].filter(Boolean).join(' › ') || tr('–')}
          </p>
        </div>
        <div className={s.profileBadges}>
          {b.planting.statusCode && <span className="badge badge--info" title={b.planting.status ?? undefined}>{b.planting.statusCode}</span>}
          <span className={`badge ${b.active ? 'badge--success' : 'badge--danger'}`}>{b.active ? tr('Aktif') : tr('Nonaktif')}</span>
        </div>
      </header>

      <section aria-label={tr('Ringkasan dan indikator')} className={s.arealTiles}>
        <Tile label={tr('Luas Areal')} value={b.area.blockHa === null ? null : formatNumber(b.area.blockHa, 2)} unit={tr('Ha')} />
        <Tile label={tr('Luas Tanam')} value={b.area.plantedHa === null ? null : formatNumber(b.area.plantedHa, 2)} unit={tr('Ha')} />
        <Tile label={tr('Persentase Luas Ditanam')} value={ind.plantedPct === null ? null : formatNumber(ind.plantedPct, 2)} unit="%" />
        <Tile label={tr('Kerapatan Pokok')} value={ind.density === null ? null : formatNumber(ind.density, 2)} unit={tr('Pokok/Ha')} />
        <Tile label={tr('Persentase Pokok Sisipan')} value={ind.insertionPct === null ? null : formatNumber(ind.insertionPct, 2)} unit="%" />
      </section>

      <div className={s.arealGrid}>
        <Facts title={tr('Identitas Wilayah dan Blok')} rows={[
          [tr('Business Unit'), b.org.unit],
          [tr('Estate Code'), b.org.estateCode],
          [tr('Estate Name'), b.org.estate],
          ['Afdeling', b.org.division],
          [tr('Kode Blok'), b.code],
          [tr('Nama Blok'), b.name],
          ['Rayon', b.org.rayon],
          [tr('Kepemilikan'), b.land.ownership],
          [tr('Status Blok'), b.active ? tr('Aktif') : tr('Nonaktif')],
        ]} />
        <Facts title={tr('Data Luas Areal')} rows={[
          [tr('Lahan Blok'), haText(b.area.blockHa)],
          [tr('Lahan yang Ditanam'), haText(b.area.plantedHa)],
          ...b.area.other.map((o): [string, string | null] => [o.label, haText(o.ha)]),
          [tr('Total Kategori Tambahan'), <b key="t">{haText(ind.otherTotalHa)}</b>],
          [tr('Selisih Blok dan Tanam'), <b key="g">{haText(ind.areaGapHa)}</b>],
        ]} />
        <Facts title={tr('Data Penanaman')} rows={[
          [tr('Tahun Pembersihan Lahan'), b.planting.tahunLc],
          [tr('Tanggal Tanam'), b.planting.plantedOn && formatDate(b.planting.plantedOn)],
          [tr('Tahun Tanam'), b.planting.plantedOn?.slice(0, 4)],
          [tr('Umur Tanaman per {0}', year), age === null ? null : tr('Sekitar {0} Tahun', age)],
          [tr('Varietas'), b.planting.variety],
          [tr('Jenis Tanah'), b.land.soil],
          [tr('Kondisi Medan'), b.land.terrain],
        ]} />
        <Facts title={tr('Data Populasi Tanaman')} rows={[
          [tr('Pokok Awal'), pokok(st.initial)],
          [tr('Jumlah Pokok'), pokok(st.total)],
          [tr('Pokok Sisipan'), pokok(st.insertion)],
          [tr('Selisih Pokok Awal dan Jumlah'), <b key="s">{pokok(ind.standGap)}</b>],
        ]} />
        <Facts title={tr('Kondisi Operasional')} rows={[
          [tr('Kondisi Perawatan'), none(code(b.land.upkeepCode, b.land.upkeep))],
          [tr('Kondisi Panen'), none(code(b.land.harvestCode, b.land.harvest))],
        ]} />
      </div>

      <details className={s.arealMissing}>
        <summary>{tr('Data yang belum tersedia (')}{missing.length})</summary>
        <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
      </details>

      <Meta remark={b.remark} validFrom={b.validFrom} updatedAt={b.updatedAt} />
    </article>
  )
}
