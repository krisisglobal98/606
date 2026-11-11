import { useState } from 'react'
import { Pencil, Save } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { EmptyState, ErrorState } from '@/components/common/StateView'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { profileService } from '@/services/profile/profileService'
import { useAnalysisStore, type VehicleProfileTab } from '@/stores/analysisStore'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import type { CostCategory, VehicleCardSettings, VehicleOps, VehicleOpsData } from '@/types/profile'
import { formatDate, formatNumber } from '@/utils/format'
import s from '../Analysis.module.css'
import { ProfileSkeleton, Tile } from './parts'
import { Donut, OpsHead, PeriodSelect, ShareBar } from './ProfileTabs'
import { COST_COLORS, parseNum, periodLabel } from './util'
import { tr } from '@/i18n'

type OpsTab = Exclude<VehicleProfileTab, 'profil'>
const TITLE: Record<OpsTab, string> = { kpi: tr('KPI Periode'), biaya: tr('Rincian Biaya'), kegiatan: tr('Dibebankan ke Kegiatan'), wo: tr('Riwayat Work Order'), keputusan: tr('Riwayat Kumulatif & Keputusan Peremajaan') }
const SOURCE: Record<OpsTab, string> = {
  kpi: tr('Aktivitas kendaraan (TractionWorkshop), biaya dan standar kartu (DOD)'),
  biaya: tr('Biaya per kategori: tabel DOD dor_vehicle_cost (dari ETL APIMS atau diisi administrator)'),
  kegiatan: tr('Pemakaian per kegiatan dari aktivitas kendaraan; charge = pemakaian × tarif aktual'),
  wo: tr('Work order bengkel (TractionWorkshop.tr_workorder)'),
  keputusan: tr('Biaya perbaikan (sparepart, ban, service luar, bengkel) terhadap nilai buku (dor_vehicle_card)'),
}
const f0 = (v: number | null | undefined) => formatNumber(v, 0)
const f1 = (v: number | null | undefined) => formatNumber(v, 1)
const f2 = (v: number | null | undefined) => formatNumber(v, 2)
const pct = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${formatNumber(v * 100, d)}%`)

/** Operational tabs of the Kartu Kendaraan for one month. */
export function VehicleOpsView({ vehicleId, tab }: { vehicleId: string; tab: OpsTab }) {
  const period = useAnalysisStore((st) => st.profile.period)
  const set = useAnalysisStore((st) => st.setProfile)
  const res = useResource((signal) => profileService.vehicleOps(vehicleId, period, signal), `profile-vehicle-ops|${vehicleId}|${period}`)
  const d = res.data && res.data.vehicle.id === vehicleId ? res.data : null
  if (res.status === 'error' && !d) return <ErrorState message={res.error ?? tr('')} onRetry={res.reload} height={260} />
  if (!d) return <ProfileSkeleton />
  return (
    <div className={s.opsBody}>
      <OpsHead title={TITLE[tab]} note={<>{tr('Sumber:')}{' '}{SOURCE[tab]}{d.source ? <> · <code>{d.source}</code></> : null}</>}>
        <PeriodSelect periods={d.periods} value={d.period} onChange={(p) => set({ period: p })} />
      </OpsHead>
      {d.notice && <div className="callout callout--info" role="note"><span>{tr(d.notice)}</span></div>}
      {!d.data ? (
        tab === 'keputusan' ? <CardEditor ops={d} onSaved={res.reload} /> : <EmptyState title={tr('Belum ada data')} message={d.notice ?? tr('Tidak ada aktivitas untuk kendaraan ini.')} height={220} />
      ) : tab === 'kpi' ? (
        <Kpi d={d.data} ops={d} />
      ) : tab === 'biaya' ? (
        <Costs d={d.data} ops={d} onSaved={res.reload} />
      ) : tab === 'kegiatan' ? (
        <Activities d={d.data} ops={d} />
      ) : tab === 'wo' ? (
        <WorkOrders d={d.data} />
      ) : (
        <Decision d={d.data} ops={d} onSaved={res.reload} />
      )}
    </div>
  )
}

function Kpi({ d, ops }: { d: VehicleOpsData; ops: VehicleOps }) {
  const k = d.kpi
  const sat = ops.satuan
  const std = ops.card?.bbmStandar ?? null
  const budget = ops.card?.tarifBudget ?? null
  return (
    <>
      <div className={s.ptiles}>
        <Tile label={tr('Total pemakaian')} value={f0(k.pemakaian)} unit={sat} sub={k.meterStart != null && k.meterEnd != null ? `${sat} ${f0(k.meterStart)} → ${f0(k.meterEnd)}` : undefined} />
        <Tile label={tr('Jumlah trip')} value={f0(k.trip)} unit={tr('trip')} sub={k.trip ? tr('{0} {1}/trip', f1(k.pemakaian / k.trip), sat) : undefined} />
        <Tile label={tr('Muatan diangkut')} value={f1(k.muatanTon)} unit={tr('ton')} sub={k.trip ? tr('{0} ton/trip', f2(k.muatanTon / k.trip)) : undefined} />
        <Tile label={tr('Jam operasi')} value={f1(k.jamOperasi)} unit={tr('jam')} sub={tr('{0} hari operasi', k.hariOperasi)} />
        <Tile label={tr('Physical Availability')} value={k.pa == null ? null : pct(k.pa, 0)} sub={k.pa == null ? tr('jam tersedia belum tercatat') : k.pa >= 0.85 ? tr('Baik') : tr('Perlu perhatian')} tone={k.pa != null && k.pa < 0.85 ? 'warning' : undefined} />
        <Tile label={tr('Downtime')} value={f1(k.jamRusak)} unit={tr('jam')} sub={tr('{0} work order', k.jumlahWO)} />
        <Tile
          label={tr('Rasio BBM')}
          value={k.bbmRasio == null ? null : formatNumber(k.bbmRasio, 3)}
          unit={`L/${sat}`}
          sub={std == null ? (k.bbmLiter == null ? tr('liter BBM belum diisi') : tr('standar belum diisi')) : tr('standar {0}', formatNumber(std, 3))}
          tone={k.bbmRasio != null && std != null && k.bbmRasio > std ? 'danger' : undefined}
        />
        <Tile label={tr('Biaya per ton angkut')} value={k.biayaPerTon == null ? null : `Rp ${f0(k.biayaPerTon)}`} sub={k.totalBiaya == null ? tr('biaya bulan ini belum diisi') : undefined} />
      </div>
      <section className={s.tariff} aria-label={tr('Tarif aktual vs budget')}>
        <h4 className={s.opsSub}>{tr('Tarif aktual vs budget')}</h4>
        {k.tarifAktual == null ? (
          <p className="t-meta">{tr('Tarif aktual = total biaya ÷ pemakaian. Isi biaya bulan ini di tab Biaya untuk melihatnya.')}</p>
        ) : (
          <>
            <b className={s.tariffBig}>{tr('Rp')}{' '}{f0(k.tarifAktual)} <small>/{sat}</small></b>
            {budget != null && (
              <>
                <div className={s.meter} role="img" aria-label={tr('Tarif aktual {0}, budget {1}', f0(k.tarifAktual), f0(budget))}>
                  <i style={{ width: `${(k.tarifAktual / (Math.max(k.tarifAktual, budget) * 1.15)) * 100}%`, background: k.indeks! <= 1 ? 'var(--success)' : 'var(--danger)' }} />
                  <em style={{ left: `${(budget / (Math.max(k.tarifAktual, budget) * 1.15)) * 100}%` }} title={tr('Budget')} />
                </div>
                <p className="t-meta">
                  <span className={`badge ${k.indeks! <= 1 ? 'badge--success' : 'badge--danger'}`}>{tr('Indeks')}{' '}{f2(k.indeks)}{' '}{tr('× budget')}</span>{tr(' ')}
                  {k.indeks! <= 1 ? tr('Hemat Rp {0} per {1} dibanding budget Rp {2}.', f0(budget - k.tarifAktual), sat, f0(budget)) : tr('Lebih mahal Rp {0} per {1} dari budget Rp {2}.', f0(k.tarifAktual - budget), sat, f0(budget))}
                </p>
              </>
            )}
            {budget == null && <p className="t-meta">{tr('Tarif budget belum diisi (tab Keputusan → Ubah data kartu).')}</p>}
          </>
        )}
      </section>
      {d.operators.length > 0 && (
        <p className="t-meta">{tr('Sopir/operator:')}{' '}{d.operators.map((o) => tr('{0} ({1} hari)', o.name, o.days)).join(', ')}</p>
      )}
    </>
  )
}

function Costs({ d, ops, onSaved }: { d: VehicleOpsData; ops: VehicleOps; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const admin = useAuthStore((st) => st.user?.role === 'admin')
  const total = d.costs.reduce((a, c) => a + c.nilai, 0)
  const usage = d.kpi.pemakaian
  const segs = d.costs.map((c, i) => ({ label: c.label, value: c.nilai, color: COST_COLORS[i]! })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value)
  return (
    <>
      {admin && !editing && (
        <div><Button size="sm" icon={<Pencil size={13} aria-hidden />} onClick={() => setEditing(true)}>{d.costRecorded ? tr('Ubah biaya') : tr('Isi biaya')} {periodLabel(ops.period!)}</Button></div>
      )}
      {editing ? (
        <CostEditor vehicleId={ops.vehicle.id} period={ops.period!} d={d} onDone={(saved) => (setEditing(false), saved && onSaved())} />
      ) : !d.costRecorded ? (
        <EmptyState title={tr('Biaya bulan ini belum diisi')} message={tr('Sumber APIMS tidak mencatat biaya per kendaraan. Administrator mengisinya di sini (tabel dor_vehicle_cost).')} height={200} />
      ) : (
        <div className={s.costGrid}>
          <div className={s.oscroll}>
            <table className={s.otbl}>
              <thead><tr><th>{tr('Kategori & sumber')}</th><th className={s.r}>{tr('Nilai (Rp)')}</th><th style={{ width: '28%' }}>{tr('% Total')}</th><th className={s.r}>{tr('Rp/')}{ops.satuan}</th></tr></thead>
              <tbody>
                {d.costs.map((c, i) => (
                  <tr key={c.kategori} className={c.nilai ? '' : s.zero}>
                    <td><span className={s.dot} style={{ background: COST_COLORS[i] }} />{c.label}<small className={s.osub}>{[c.sumber, c.qty != null ? `${f1(c.qty)}${c.kategori === 'BBM' ? ' L' : ''}` : null].filter(Boolean).join(' · ') || tr('–')}</small></td>
                    <td className={s.r}>{f0(c.nilai)}</td>
                    <td><ShareBar value={total ? c.nilai / total : 0} color={COST_COLORS[i]} /></td>
                    <td className={s.r}>{usage ? f0(c.nilai / usage) : tr('–')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>{tr('Total biaya unit')}</td><td className={s.r}>{f0(total)}</td><td>100%</td><td className={s.r}>{usage ? f0(total / usage) : tr('–')}</td></tr></tfoot>
            </table>
          </div>
          <div className={s.donutBox}>
            <Donut items={segs} label={tr('Komposisi biaya {0}', periodLabel(ops.period!))} sub={tr('Total biaya')} center={`Rp ${formatNumber(total / 1e6, 1)} jt`} />
            <ul className={s.legend}>{segs.map((x) => <li key={x.label}><span><i style={{ background: x.color }} />{x.label}</span><b>{pct(total ? x.value / total : 0)}</b></li>)}</ul>
          </div>
        </div>
      )}
    </>
  )
}

/** Administrator: costs of the month per category (replaces the month in dor_vehicle_cost). */
function CostEditor({ vehicleId, period, d, onDone }: { vehicleId: string; period: string; d: VehicleOpsData; onDone: (saved: boolean) => void }) {
  const [rows, setRows] = useState(() => d.costs.map((c) => ({ kategori: c.kategori, label: c.label, nilai: c.recorded ? String(c.nilai) : '', qty: c.qty == null ? '' : String(c.qty), sumber: c.sumber ?? '' })))
  const [saving, setSaving] = useState(false)
  const parse = parseNum
  const bad = rows.some((r) => [parse(r.nilai), parse(r.qty)].some((x) => x != null && (!Number.isFinite(x) || x < 0)))
  const upd = (i: number, p: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const save = async () => {
    setSaving(true)
    try {
      const items = rows.filter((r) => parse(r.nilai) != null).map((r) => ({ kategori: r.kategori as CostCategory, nilai: parse(r.nilai)!, qty: parse(r.qty), sumber: r.sumber.trim() || null }))
      await profileService.setVehicleCosts(vehicleId, period, items)
      toast(tr('Biaya {0} disimpan.', periodLabel(period)), 'success')
      onDone(true)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tr('Biaya gagal disimpan.'), 'error')
      setSaving(false)
    }
  }
  return (
    <div className={s.adminForm}>
      <div className={s.oscroll}>
        <table className={s.otbl}>
          <thead><tr><th>{tr('Kategori')}</th><th>{tr('Nilai (Rp)')}</th><th>{tr('Qty (mis. liter BBM)')}</th><th>{tr('Sumber data')}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.kategori}>
                <td>{r.label}</td>
                <td><input className="input input--sm" inputMode="decimal" value={r.nilai} onChange={(e) => upd(i, { nilai: e.target.value })} aria-label={tr('Nilai {0}', r.label)} /></td>
                <td><input className="input input--sm" inputMode="decimal" value={r.qty} onChange={(e) => upd(i, { qty: e.target.value })} aria-label={tr('Qty {0}', r.label)} /></td>
                <td><input className="input input--sm" value={r.sumber} onChange={(e) => upd(i, { sumber: e.target.value })} maxLength={200} aria-label={tr('Sumber {0}', r.label)} placeholder={tr('mis. Gudang — bon BBM')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.adminActs}>
        <span className="t-meta">{tr('Kosongkan nilai untuk menghapus kategori. Angka boleh memakai titik ribuan dan koma desimal.')}</span>
        <Button size="sm" onClick={() => onDone(false)}>{tr('Batal')}</Button>
        <Button size="sm" variant="primary" icon={<Save size={13} aria-hidden />} loading={saving} disabled={bad} onClick={() => void save()}>{tr('Simpan biaya')}</Button>
      </div>
    </div>
  )
}

function Activities({ d, ops }: { d: VehicleOpsData; ops: VehicleOps }) {
  if (!d.activities.length) return <EmptyState title={tr('Belum ada aktivitas')} message={tr('Tidak ada aktivitas kendaraan pada bulan terpilih.')} height={200} />
  const tot = d.activities.reduce((a, x) => a + x.usage, 0)
  const charge = d.activities.reduce((a, x) => a + (x.charge ?? 0), 0)
  return (
    <div className={s.oscroll}>
      <table className={s.otbl}>
        <thead><tr><th>{tr('Kode')}</th><th>{tr('Kegiatan')}</th><th className={s.r}>{tr('Pemakaian')}</th><th className={s.r}>{tr('Trip')}</th><th className={s.r}>{tr('Muatan (ton)')}</th><th className={s.r}>{tr('Charge (Rp)')}</th><th style={{ width: '24%' }}>{tr('Porsi')}</th></tr></thead>
        <tbody>
          {d.activities.map((a) => (
            <tr key={a.code}>
              <td className={s.mono}>{a.code}</td>
              <td>{a.name}</td>
              <td className={s.r}>{f0(a.usage)} {ops.satuan}</td>
              <td className={s.r}>{f0(a.trip)}</td>
              <td className={s.r}>{f1(a.kg / 1000)}</td>
              <td className={s.r}>{a.charge == null ? tr('–') : f0(a.charge)}</td>
              <td><ShareBar value={a.share} color="var(--info, #2563eb)" /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td /><td>{tr('Total')}</td><td className={s.r}>{f0(tot)} {ops.satuan}</td><td className={s.r}>{f0(d.kpi.trip)}</td><td className={s.r}>{f1(d.kpi.muatanTon)}</td><td className={s.r}>{d.kpi.tarifAktual == null ? tr('–') : f0(charge)}</td><td>100%</td></tr></tfoot>
      </table>
      {d.kpi.tarifAktual == null && <p className="t-meta">{tr('Charge muncul setelah biaya bulan ini diisi (tarif aktual = total biaya ÷ pemakaian).')}</p>}
    </div>
  )
}

function WorkOrders({ d }: { d: VehicleOpsData }) {
  if (!d.workOrders.length) return <EmptyState title={tr('Tidak ada work order')} message={tr('Tidak ada work order bengkel untuk kendaraan ini pada bulan terpilih.')} height={200} />
  return (
    <div className={s.oscroll}>
      <table className={s.otbl}>
        <thead><tr><th>{tr('No. WO')}</th><th>{tr('Tanggal')}</th><th>{tr('Jenis')}</th><th>{tr('Keluhan / pekerjaan')}</th><th>{tr('Bengkel')}</th><th className={s.r}>{tr('KM/HM masuk')}</th></tr></thead>
        <tbody>
          {d.workOrders.map((w) => (
            <tr key={w.nomor}>
              <td className={s.mono}>{w.nomor}</td>
              <td>{w.tanggal ? formatDate(w.tanggal) : tr('–')}</td>
              <td>{w.jenis ? <span className={`badge ${/prevent/i.test(w.jenis) ? 'badge--success' : 'badge--warning'}`}>{w.jenis}</span> : tr('–')}</td>
              <td>{w.keluhan ?? tr('–')}{w.penyebab && <small className={s.osub}>{tr('Penyebab:')}{' '}{w.penyebab}</small>}</td>
              <td>{w.bengkel ?? tr('–')}</td>
              <td className={s.r}>{w.meter == null ? tr('–') : f0(w.meter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Decision({ d, ops, onSaved }: { d: VehicleOpsData; ops: VehicleOps; onSaved: () => void }) {
  const c = d.cumulative
  const tone = c.rekomendasi === 'PERTAHANKAN' ? 'good' : c.rekomendasi === 'PANTAU' ? 'warn' : c.rekomendasi ? 'bad' : 'none'
  return (
    <>
      <div className={s.decision}>
        <dl className={s.rows}>
          <div><dt>{tr('Biaya perbaikan kumulatif s/d bulan lalu')}</dt><dd>{tr('Rp')}{' '}{f0(c.sdBulanLalu)}</dd></div>
          <div><dt>{tr('Biaya perbaikan bulan ini')}{' '}<small>{tr('(sparepart + ban + service luar + bengkel)')}</small></dt><dd>{tr('Rp')}{' '}{f0(c.bulanIni)}</dd></div>
          <div><dt>{tr('Biaya perbaikan kumulatif')}</dt><dd>{tr('Rp')}{' '}{f0(c.total)}</dd></div>
          <div><dt>{tr('Nilai buku akhir')}</dt><dd>{c.nilaiBuku == null ? tr('–') : tr('Rp {0}', f0(c.nilaiBuku))}</dd></div>
          <div><dt>{tr('Rasio perbaikan kumulatif ÷ nilai buku')}</dt><dd>{pct(c.rasio)}</dd></div>
        </dl>
        <div className={`${s.verdict} ${s[`verdict_${tone}`]}`}>
          <small>{tr('Rekomendasi')}</small>
          <b>{c.rekomendasi ?? tr('Belum bisa dihitung')}</b>
          {c.rasio != null && <span className={s.gauge}><i style={{ width: `${Math.min(c.rasio, 1) * 100}%` }} /></span>}
          <span>{c.rasio == null ? tr('Isi nilai buku di data kartu.') : tr('Pantau mulai {0}, evaluasi mulai {1} dari nilai buku.', pct(c.batasPantau, 0), pct(c.batasEvaluasi, 0))}</span>
        </div>
      </div>
      <p className="t-meta">{tr('Rekomendasi adalah aturan DOD atas rasio di atas (batasnya diatur per kendaraan), bukan keputusan; konfirmasikan dengan bagian traksi.')}</p>
      <CardEditor ops={ops} onSaved={onSaved} />
    </>
  )
}

const NUM_FIELDS: { key: keyof VehicleCardSettings; label: string; hint?: string }[] = [
  { key: 'tarifBudget', label: tr('Tarif budget (Rp per KM/HM)') },
  { key: 'bbmStandar', label: tr('Standar BBM (liter per KM/HM)') },
  { key: 'intervalService', label: tr('Interval service (KM/HM)') },
  { key: 'nilaiPerolehan', label: tr('Nilai perolehan (Rp)') },
  { key: 'nilaiBuku', label: tr('Nilai buku akhir (Rp)') },
  { key: 'biayaPerbaikanAwal', label: tr('Biaya perbaikan sebelum pencatatan DOD (Rp)'), hint: tr('kumulatif sebelum bulan pertama di DOD') },
  { key: 'batasPantau', label: tr('Batas PANTAU (rasio, mis. 0,5)') },
  { key: 'batasEvaluasi', label: tr('Batas EVALUASI (rasio, mis. 0,75)') },
]

/** Administrator: the vehicle's card data (dor_vehicle_card). */
function CardEditor({ ops, onSaved }: { ops: VehicleOps; onSaved: () => void }) {
  const admin = useAuthStore((st) => st.user?.role === 'admin')
  const [open, setOpen] = useState(false)
  const c = ops.card
  const [v, setV] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(NUM_FIELDS.map((f) => [f.key, c?.[f.key] == null ? (f.key === 'batasPantau' ? '0.5' : f.key === 'batasEvaluasi' ? '0.75' : f.key === 'biayaPerbaikanAwal' ? '0' : '') : String(c[f.key])])),
    satuan: c?.satuan ?? ops.satuan,
    nilaiBukuPer: c?.nilaiBukuPer ?? '',
    keterangan: c?.keterangan ?? '',
  }))
  const [saving, setSaving] = useState(false)
  if (!admin) return c ? null : <p className="t-meta">{tr('Data kartu (tarif budget, standar BBM, nilai buku) belum diisi administrator.')}</p>
  if (!open) return <div><Button size="sm" icon={<Pencil size={13} aria-hidden />} onClick={() => setOpen(true)}>{c ? tr('Ubah data kartu') : tr('Isi data kartu')}</Button></div>
  const num = (k: string) => parseNum(v[k]!)
  const nums = Object.fromEntries(NUM_FIELDS.map((f) => [f.key, num(f.key)]))
  const bad = Object.values(nums).some((x) => x != null && (!Number.isFinite(x) || x < 0)) || (nums.intervalService != null && nums.intervalService <= 0)
  const save = async () => {
    setSaving(true)
    try {
      await profileService.setVehicleCard(ops.vehicle.id, {
        tarifBudget: nums.tarifBudget ?? null,
        satuan: v.satuan === 'HM' ? 'HM' : 'KM',
        bbmStandar: nums.bbmStandar ?? null,
        intervalService: nums.intervalService ?? null,
        nilaiPerolehan: nums.nilaiPerolehan ?? null,
        nilaiBuku: nums.nilaiBuku ?? null,
        nilaiBukuPer: v.nilaiBukuPer || null,
        biayaPerbaikanAwal: nums.biayaPerbaikanAwal ?? 0,
        batasPantau: nums.batasPantau ?? 0.5,
        batasEvaluasi: nums.batasEvaluasi ?? 0.75,
        keterangan: v.keterangan!.trim() || null,
      })
      toast(tr('Data kartu kendaraan disimpan.'), 'success')
      setOpen(false)
      onSaved()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tr('Data kartu gagal disimpan.'), 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className={s.adminForm}>
      <div className={s.cardFields}>
        <label className="field">
          <span className="t-label">{tr('Satuan pemakaian')}</span>
          <select className="select" value={v.satuan} onChange={(e) => setV({ ...v, satuan: e.target.value })}><option value="KM">{tr('KM')}</option><option value="HM">{tr('HM')}</option></select>
        </label>
        {NUM_FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span className="t-label">{f.label}</span>
            <input className="input" inputMode="decimal" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            {f.hint && <span className="t-meta">{f.hint}</span>}
          </label>
        ))}
        <label className="field">
          <span className="t-label">{tr('Nilai buku per tanggal')}</span>
          <input className="input" type="date" value={v.nilaiBukuPer} onChange={(e) => setV({ ...v, nilaiBukuPer: e.target.value })} />
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span className="t-label">{tr('Keterangan')}</span>
          <input className="input" value={v.keterangan} maxLength={500} onChange={(e) => setV({ ...v, keterangan: e.target.value })} />
        </label>
      </div>
      <div className={s.adminActs}>
        <span className="t-meta">{tr('Disimpan di DOD (dor_vehicle_card): data ini tidak ada di APIMS.')}</span>
        <Button size="sm" onClick={() => setOpen(false)}>{tr('Batal')}</Button>
        <Button size="sm" variant="primary" icon={<Save size={13} aria-hidden />} loading={saving} disabled={bad} onClick={() => void save()}>{tr('Simpan data kartu')}</Button>
      </div>
    </div>
  )
}
