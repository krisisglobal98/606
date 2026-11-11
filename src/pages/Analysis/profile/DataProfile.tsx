import { useEffect, useMemo, type ReactNode } from 'react'
import { Database, IdCard } from 'lucide-react'
import { useCanOpen } from '@/app/auth/menuAccess'
import { Card } from '@/components/common/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import { SearchableSelect } from '@/components/forms/SearchableSelect'
import { SelectField } from '@/components/forms/SelectField'
import { useResource } from '@/hooks/useResource'
import { profileService } from '@/services/profile/profileService'
import { useAnalysisStore, type ProfileReport } from '@/stores/analysisStore'
import { formatNumber } from '@/utils/format'
import { CollapseToggle } from '../CollapseToggle'
import s from '../Analysis.module.css'
import { BlockProfileView } from './BlockProfileView'
import { VehicleCardView } from './VehicleCardView'
import { PROFILE_REPORTS } from './util'
import { tr } from '@/i18n'

/**
 * Data Profil: one record of the master data at a time. The user picks a kebun / business unit, then the kind of
 * profile (blok, kendaraan), then a record of that unit. Everything opens inside the card, so the analysis
 * around it stays as it is.
 */
export function DataProfile() {
  const can = useCanOpen()
  const { unit, report } = useAnalysisStore((st) => st.profile)
  const setUnit = useAnalysisStore((st) => st.setProfileUnit)
  const setReport = useAnalysisStore((st) => st.setProfileReport)
  const allowed = useMemo(() => PROFILE_REPORTS.filter((r) => can(r.menu)), [can])
  const current = allowed.find((r) => r.value === report) ?? allowed[0]
  useEffect(() => {
    if (current && current.value !== report) setReport(current.value)
  }, [current, report, setReport])
  const units = useResource((signal) => profileService.units(signal), 'profile-units')
  const chosen = units.data?.find((u) => u.id === unit) ?? null
  const count = chosen && current ? (current.value === 'blok' ? chosen.blocks : chosen.vehicles) : null

  return (
    <Card
      title={
        <span className={s.iconTitle}>
          <IdCard size={15} aria-hidden />{' '}{tr('Data Profil')}
        </span>
      }
      subtitle={current ? current.hint : tr('Profil data master')}
      actions={<CollapseToggle panel="profile" label={tr('Data Profil')} controls="panel-profile" direction="left" />}
    >
      {!current ? (
        <EmptyState title={tr('Belum ada laporan profil untuk peran Anda')} message={tr('Administrator mengatur laporan Data Profil di Settings → Hak Akses Menu (Analisis → Profil Blok, Kartu Kendaraan).')} height={200} />
      ) : (
        <Body unit={chosen ? unit : tr('')} report={current.value} controls={
          <div className={s.profileControls}>
            {units.status === 'error' && !units.data ? (
              <ErrorState message={units.error ?? tr('')} onRetry={units.reload} height={120} />
            ) : !units.data ? (
              <Skeleton h={58} />
            ) : (
              <SearchableSelect
                label={tr('Kebun / Bisnis Unit')}
                value={chosen ? unit : ''}
                onChange={setUnit}
                placeholder={tr('Pilih kebun / bisnis unit')}
                searchPlaceholder={tr('Cari kode atau nama kebun')}
                options={units.data.map((u) => ({ value: u.id, label: `${u.code} · ${u.name}` }))}
              />
            )}
            <SelectField label={tr('Jenis profil')} value={current.value} onChange={(v) => setReport(v as ProfileReport)} options={allowed.map((r) => ({ value: r.value, label: r.value === 'blok' ? tr('Blok') : tr('Kendaraan') }))} />
            {chosen && count !== null && (
              <p className={s.profileCount}>
                <b>{formatNumber(count, 0)}</b> {current.value === 'blok' ? tr('blok aktif') : tr('kendaraan aktif')}{' '}{tr('di')}{' '}{chosen.code}
              </p>
            )}
          </div>
        } />
      )}
      <p className={s.profileSource}>
        <Database size={12} aria-hidden />{' '}{tr('Sumber: data master APIMS (baca-saja). Perubahan data dilakukan di APIMS.')}
      </p>
    </Card>
  )
}

/**
 * One grid for every state: the controls stay mounted in the top-left cell (no focus loss when the kind changes),
 * the report's list sits below them and its profile on the right.
 */
function Body({ unit, report, controls }: { unit: string; report: ProfileReport; controls: ReactNode }) {
  return (
    <div className={s.profileBody}>
      {controls}
      {!unit ? (
        <div className={s.profileView}>
          <EmptyState title={tr('Pilih kebun / bisnis unit')} message={tr('Pilih kebun atau bisnis unit di kiri; daftar {0} kebun itu tampil di bawahnya.', report === 'blok' ? 'blok' : 'kendaraan')} height={280} />
        </div>
      ) : report === 'blok' ? (
        <BlockProfileView key={unit} unit={unit} />
      ) : (
        <VehicleCardView key={unit} unit={unit} />
      )}
    </div>
  )
}
