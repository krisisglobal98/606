import { EmptyState, ErrorState } from '@/components/common/StateView'
import { useResource } from '@/hooks/useResource'
import { profileService } from '@/services/profile/profileService'
import { useAnalysisStore } from '@/stores/analysisStore'
import type { BlockActivities, BlockCost, BlockOps, BlockProduction, BlockTab } from '@/types/profile'
import { formatDate, formatNumber } from '@/utils/format'
import s from '../Analysis.module.css'
import { ProfileSkeleton, Tile } from './parts'
import { OpsHead, PeriodSelect, ShareBar } from './ProfileTabs'
import { periodLabel } from './util'
import { tr } from '@/i18n'

const TITLE: Record<BlockTab, string> = { produksi: tr('Produksi'), perawatan: tr('Perawatan'), pemupukan: tr('Pemupukan'), biaya: tr('Biaya Tenaga Kerja') }
const SOURCE: Record<BlockTab, string> = {
  produksi: tr('Panen (trx_harvest), BKM panen (trx_blockactivity), BJR bulanan, taksasi'),
  perawatan: tr('BKM kegiatan perawatan (trx_blockactivity) dan material (trx_progress_material)'),
  pemupukan: tr('BKM kegiatan pemupukan (trx_blockactivity) dan material pupuk (trx_progress_material)'),
  biaya: tr('Alokasi biaya tenaga kerja ke blok (Keuangan.tr_costallocation)'),
}
const f0 = (v: number | null | undefined) => formatNumber(v, 0)
const f1 = (v: number | null | undefined) => formatNumber(v, 1)
const f2 = (v: number | null | undefined) => formatNumber(v, 2)

/** Operational tab of a block for one month; data straight from the unit database of the block. */
export function BlockOpsView({ blockId, tab }: { blockId: string; tab: BlockTab }) {
  const period = useAnalysisStore((st) => st.profile.period)
  const set = useAnalysisStore((st) => st.setProfile)
  const res = useResource((signal) => profileService.blockOps(blockId, tab, period, signal), `profile-block-ops|${blockId}|${tab}|${period}`)
  const d = res.data && res.data.block.id === blockId && res.data.tab === tab ? res.data : null
  if (res.status === 'error' && !d) return <ErrorState message={res.error ?? tr('')} onRetry={res.reload} height={260} />
  if (!d) return <ProfileSkeleton />
  return (
    <div className={s.opsBody}>
      <OpsHead title={TITLE[tab]} note={<>{tr('Sumber:')}{' '}{SOURCE[tab]}{d.source ? <> · <code>{d.source}</code></> : null}</>}>
        <PeriodSelect periods={d.periods} value={d.period} onChange={(p) => set({ period: p })} />
      </OpsHead>
      {!d.data ? (
        <EmptyState title={tr('Belum ada data')} message={d.notice ? tr(d.notice) : tr('Tidak ada transaksi untuk blok ini.')} height={220} />
      ) : tab === 'produksi' ? (
        <Production d={d.data as BlockProduction} ops={d} />
      ) : tab === 'biaya' ? (
        <Cost d={d.data as BlockCost} />
      ) : (
        <Activities d={d.data as BlockActivities} pupuk={tab === 'pemupukan'} />
      )}
    </div>
  )
}

function Production({ d, ops }: { d: BlockProduction; ops: BlockOps }) {
  const k = d.kpi
  const max = Math.max(1, ...d.daily.map((x) => x.kg))
  return (
    <>
      <div className={s.ptiles}>
        <Tile label={tr('Tonase')} value={f2(k.tonase)} unit={tr('ton')} sub={tr('{0} janjang · brondolan {1} kg', f0(k.janjang), f0(k.brondolanKg))} />
        <Tile label={tr('BJR')} value={k.bjr == null ? null : f2(k.bjr)} unit={tr('kg/jjg')} sub={k.bjrSource ? tr('dari {0}', k.bjrSource) : tr('belum tercatat')} />
        <Tile label={tr('Produktivitas')} value={k.produktivitas == null ? null : f2(k.produktivitas)} unit={tr('ton/ha')} sub={tr('luas tanam {0} ha', ops.block.plantedHa == null ? '–' : f2(ops.block.plantedHa))} />
        <Tile
          label={tr('Achievement')}
          value={k.achievement == null ? null : f1(k.achievement)}
          unit="%"
          sub={k.budgetTon == null ? tr('budget bulan ini belum tersedia') : tr('budget {0} ton', f2(k.budgetTon))}
          tone={k.achievement != null && k.achievement < 90 ? 'warning' : undefined}
        />
      </div>
      <div className={s.factLine}>
        <span>{tr('Hari panen')}{' '}<b>{f0(k.hariPanen)}</b></span>
        <span>{tr('Pemanen')}{' '}<b>{f0(k.pemanen)}</b></span>
        <span>{tr('HK panen')}{' '}<b>{f0(k.hkPanen)}</b></span>
        <span>{tr('Ha panen')}{' '}<b>{f2(k.haPanen)}</b></span>
        <span>{tr('Output')}{' '}<b>{k.outputHk == null ? tr('–') : tr('{0} ton/HK', f2(k.outputHk))}</b></span>
        <span>{tr('AKP taksasi')}{' '}<b>{k.akp == null ? tr('–') : `${f1(k.akp)}%`}</b>{k.taksasi ? tr(' ({0} sampel)', k.taksasi) : tr('')}</span>
      </div>
      <section aria-label={tr('Panen harian')}>
        <h4 className={s.opsSub}>{tr('Panen harian')}</h4>
        {d.daily.length ? (
          <div className={s.dayBars} role="img" aria-label={tr('Panen harian {0}: {1}', ops.period ? periodLabel(ops.period) : '', d.daily.map((x) => `${formatDate(x.day)} ${f0(x.kg)} kg`).join(', '))}>
            {d.daily.map((x) => (
              <div key={x.day} title={tr('{0}: {1} kg · {2} jjg', formatDate(x.day), f0(x.kg), f0(x.janjang))}>
                <i style={{ height: `${(x.kg / max) * 100}%` }} />
                <span>{Number(x.day.slice(8, 10))}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="t-meta">{tr('Tidak ada panen pada bulan ini.')}</p>
        )}
      </section>
      {d.monthly.length > 1 && (
        <section aria-label={tr('Tren bulanan')}>
          <h4 className={s.opsSub}>{tr('Tren bulanan')}</h4>
          <table className={s.otbl}>
            <thead><tr><th>{tr('Bulan')}</th><th className={s.r}>{tr('Tonase (ton)')}</th><th className={s.r}>{tr('Ha panen')}</th></tr></thead>
            <tbody>{d.monthly.map((m) => <tr key={m.period}><td>{periodLabel(m.period)}</td><td className={s.r}>{f2(m.ton)}</td><td className={s.r}>{f2(m.ha)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      <div className={s.adminEdit}>
        <span className="t-label">{tr('Budget produksi')}{' '}{periodLabel(ops.period!)}{' '}{tr('(ton)')}</span>
        <b>{k.budgetTon == null ? tr('belum tersedia') : f2(k.budgetTon)}</b>
      </div>
    </>
  )
}

function Activities({ d, pupuk }: { d: BlockActivities; pupuk: boolean }) {
  return (
    <>
      <div className={s.factLine}>
        <span>{tr('Kegiatan')}{' '}<b>{d.totals.kegiatan}</b></span>
        <span>{tr('HK')}{' '}<b>{f0(d.totals.hk)}</b></span>
        <span>{tr('Luas dikerjakan')}{' '}<b>{f2(d.totals.ha)}{' '}{tr('ha')}</b></span>
        <span>{tr('Material')}{' '}<b>{d.totals.material}</b></span>
      </div>
      {d.activities.length ? (
        <div className={s.oscroll}>
          <table className={s.otbl}>
            <thead>
              <tr><th>{tr('Kegiatan')}</th><th className={s.r}>{tr('Luas (ha)')}</th><th className={s.r}>{tr('Hasil')}</th>{pupuk && <th className={s.r}>{tr('Dosis')}</th>}<th className={s.r}>{tr('HK')}</th><th className={s.r}>{tr('Hari')}</th><th>{tr('Terakhir')}</th></tr>
            </thead>
            <tbody>
              {d.activities.map((a) => (
                <tr key={a.code}>
                  <td><b>{a.name}</b><small className={s.osub}>{a.code} · {a.modul}</small></td>
                  <td className={s.r}>{f2(a.ha)}</td>
                  {/* Area is its own column; a hectare unit on the output would repeat it (or mislabel kg of material). */}
                  <td className={s.r}>{f1(a.qty)} {a.uom && !/hektar/i.test(a.uom) ? a.uom.toLowerCase() : tr('')}</td>
                  {pupuk && <td className={s.r}>{a.dosis == null ? tr('–') : f2(a.dosis)}</td>}
                  <td className={s.r}>{f0(a.hk)}</td>
                  <td className={s.r}>{f0(a.hari)}</td>
                  <td>{formatDate(a.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={pupuk ? tr('Tidak ada pemupukan') : tr('Tidak ada kegiatan perawatan')} message={tr('Tidak ada BKM kegiatan ini untuk blok pada bulan terpilih.')} height={160} />
      )}
      <section aria-label={tr('Material')}>
        <h4 className={s.opsSub}>{pupuk ? tr('Pupuk yang diaplikasikan') : tr('Material perawatan')}</h4>
        {d.materials.length ? (
          <div className={s.oscroll}>
            <table className={s.otbl}>
              <thead><tr><th>{tr('Material')}</th><th>{tr('Kategori')}</th><th className={s.r}>{tr('Jumlah')}</th><th className={s.r}>{tr('Per ha tanam')}</th><th>{tr('Kegiatan')}</th></tr></thead>
              <tbody>
                {d.materials.map((m) => (
                  <tr key={m.code}>
                    <td><b>{m.name}</b><small className={s.osub}>{m.code}</small></td>
                    <td>{m.category ?? tr('–')}</td>
                    <td className={s.r}>{f1(m.qty)} {m.uom?.toLowerCase() ?? tr('')}</td>
                    <td className={s.r}>{m.perHa == null ? tr('–') : tr('{0} {1}/ha', f1(m.perHa), m.uom?.toLowerCase() ?? '')}</td>
                    <td>{m.activities.join(', ') || tr('–')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="t-meta">{tr('Tidak ada pemakaian material tercatat.')}</p>
        )}
      </section>
    </>
  )
}

function Cost({ d }: { d: BlockCost }) {
  if (!d.items.length) return <EmptyState title={tr('Belum ada alokasi biaya')} message={tr('Tidak ada alokasi biaya tenaga kerja ke blok ini pada bulan terpilih.')} height={200} />
  return (
    <>
      <div className={s.ptiles}>
        <Tile label={tr('Total biaya tenaga kerja')} value={`Rp ${f0(d.total)}`} sub={tr('{0} HK', f0(d.hk))} />
        <Tile label={tr('Biaya per ha tanam')} value={d.perHa == null ? null : `Rp ${f0(d.perHa)}`} />
        <Tile label={tr('Rata-rata per HK')} value={d.hk ? `Rp ${f0(d.total / d.hk)}` : null} />
      </div>
      <div className={s.oscroll}>
        <table className={s.otbl}>
          <thead><tr><th>{tr('Kegiatan')}</th><th className={s.r}>{tr('HK')}</th><th className={s.r}>{tr('Rp/HK')}</th><th className={s.r}>{tr('Nilai (Rp)')}</th><th style={{ width: '26%' }}>{tr('Porsi')}</th></tr></thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.code}>
                <td><b>{i.name}</b><small className={s.osub}>{i.code}</small></td>
                <td className={s.r}>{f1(i.hk)}</td>
                <td className={s.r}>{i.rate == null ? tr('–') : f0(i.rate)}</td>
                <td className={s.r}>{f0(i.nilai)}</td>
                <td><ShareBar value={d.total ? i.nilai / d.total : 0} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>{tr('Total')}</td><td className={s.r}>{f1(d.hk)}</td><td /><td className={s.r}>{f0(d.total)}</td><td /></tr></tfoot>
        </table>
      </div>
    </>
  )
}
