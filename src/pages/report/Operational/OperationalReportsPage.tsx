import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { BarChart3, ChevronDown, ChevronRight, FileText, Filter as FilterIcon, Folder, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Trash2 } from 'lucide-react'
import { canOpen } from '@/app/auth/menus'
import type { CalcMeasure } from '@/semantic/measureEngine'
import { useAnalysisStore } from '@/stores/analysisStore'
import { useGridPrefs } from '@/stores/gridPrefsStore'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { EdgeTab } from '@/components/common/EdgeTab'
import { StartCard } from '@/components/common/StartCard'
import { Modal } from '@/components/common/Modal'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import { SearchInput } from '@/components/forms/SearchInput'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { datasetService } from '@/services/dataset/datasetService'
import { savedReportService } from '@/services/report/savedReportService'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import type { DataScope, Filter } from '@/types/contracts'
import type { SavedReport } from '@/types/report'
import { formatDate, formatDateTime } from '@/utils/format'
import { FilterModal, activeFilterCount, normalized } from '@/pages/Analysis/FilterModal'
import { activeFields, filterText } from '@/pages/Analysis/fieldFilter'
import { SavedReportGrid } from './SavedReportGrid'
import { monthToDate } from '@/stores/period'
import { NONE, reportTree } from './operationalMeta'
import s from './Operational.module.css'
import { tr } from '@/i18n'

/** A collapsed card's state, remembered in this browser (a convenience only: it falls back to open). */
function usePanel(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  return [
    v,
    (next) => {
      setV(next)
      try {
        localStorage.setItem(key, next ? '1' : '0')
      } catch {
        /* storage unavailable: the state lasts for this page only */
      }
    },
  ]
}

/** Report → Laporan Operasional: saved Analysis layouts listed by master category; choosing one shows its Tabel Hasil. */
export default function OperationalReportsPage() {
  const user = useAuthStore((st) => st.user)
  const navigate = useNavigate()
  const [nonce, setNonce] = useState(0)
  const data = useResource(async (signal) => {
    const [reports, categories, catalog] = await Promise.all([savedReportService.list(signal), dataWarehouseService.getCategories(signal), datasetService.getCatalog()])
    return { reports, categories, datasets: catalog.datasets }
  }, `saved-reports#${nonce}`)
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  // Groups the user opened or closed; untouched groups are open when they hold the current report or match a search.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [focus, setFocus] = useState(false)
  const [sideHidden, setSideHidden] = usePanel('dod.report.sidebarCollapsed')
  const [headHidden, setHeadHidden] = usePanel('dod.report.headerCollapsed')
  const [filterOpen, setFilterOpen] = useState(false)
  // Filters applied to the open report; another report starts again from its saved filters.
  const [applied, setApplied] = useState<{ id: string; filter: Filter; scope: DataScope } | null>(null)
  const [deleting, setDeleting] = useState<SavedReport | null>(null)
  const [busy, setBusy] = useState(false)

  const reports = useMemo(() => data.data?.reports ?? [], [data.data])
  const categories = useMemo(() => data.data?.categories ?? [], [data.data])
  const groups = useMemo(() => reportTree(categories, reports, q, tr('Tanpa kategori')), [categories, reports, q])
  const categoryName = (id: string | null) => {
    const c = categories.find((x) => x.id === id)
    if (!c) return tr('Tanpa kategori')
    const parent = categories.find((x) => x.id === c.parentId)
    return parent ? `${parent.name} › ${c.name}` : c.name
  }

  // Only a report the user chose is shown: the page opens without a table (light), until a report is picked.
  const current = reports.find((r) => r.id === chosen) ?? null
  const recent = useMemo(() => [...reports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), [reports])
  const dataset = data.data?.datasets.find((d) => d.id === current?.datasetId) ?? null
  // A saved report opens at month to date (first of the current month up to today) with an automatic report date
  // (H.I = today); its other filters are kept. Another period or report date is chosen in the filter.
  const saved = current ? { filter: { ...(current.layout.filter as unknown as Filter), ...monthToDate(), reportDate: null }, scope: current.layout.scope as DataScope } : null
  const active = current && applied?.id === current.id ? applied : saved
  const changed = !!(active && saved && normalized(active) !== normalized(saved))
  const filterCount = active ? activeFilterCount(active) : 0

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await savedReportService.remove(deleting.id)
      toast(tr('Laporan {0} dihapus.', deleting.name), 'success')
      if (deleting.id === chosen) setChosen(null)
      setDeleting(null)
      setNonce((n) => n + 1)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tr('Laporan gagal dihapus.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (data.status === 'error' && !data.data) return <Card><ErrorState message={data.error ?? tr('')} onRetry={data.reload} /></Card>
  if (!data.data) return <Card><Skeleton h={320} /></Card>

  const holdsCurrent = (list: SavedReport[]) => !!current && list.some((r) => r.id === current.id)
  const isOpen = (id: string, list: SavedReport[]) => toggled[id] ?? (!!q.trim() || holdsCurrent(list))
  const flip = (id: string, list: SavedReport[]) => setToggled((t) => ({ ...t, [id]: !isOpen(id, list) }))
  // The creator of a report or an administrator may delete it (the API refuses everyone else).
  const canDelete = (r: SavedReport) => user?.role === 'admin' || r.createdBy === user?.id
  // Changing a report's layout happens in Analisis (same id on save): its owner or an administrator with that menu.
  const canEdit = (r: SavedReport) => canDelete(r) && canOpen(user, 'analisis')
  const editInAnalysis = () => {
    if (!current || !dataset) return
    // Calculated measures live in the browser; the report carries the ones its layout uses.
    for (const m of (current.layout.calc ?? []) as CalcMeasure[]) useGridPrefs.getState().saveCalc(dataset.id, m)
    useAnalysisStore.getState().openReport(dataset, current)
    navigate('/analisis')
  }
  // Report parameters shown in the header, like the input cells of the Excel report: report date and active filters.
  const labelOf = (id: string) => dataset?.fields.find((f) => f.id === id)?.label ?? id
  const params = active
    ? [
        ...Object.entries(active.scope).filter(([, v]) => v?.length).map(([k, v]) => `${labelOf(k)}: ${v.join(', ')}`),
        ...activeFields(active.filter.fields).map(([k, v]) => `${labelOf(k)}: ${filterText(v)}`),
      ]
    : []
  const reportBtn = (r: SavedReport) => (
    <li key={r.id} className={s.reportRow}>
      <button type="button" className={`${s.report}${r.id === current?.id ? ` ${s.reportOn}` : ''}`} aria-current={r.id === current?.id ? 'page' : undefined} onClick={() => setChosen(r.id)} title={r.name}>
        <FileText size={14} aria-hidden />
        <span>
          {r.name}
          <small>{r.datasetName ?? tr('Dataset dihapus')}</small>
        </span>
      </button>
      {canDelete(r) && (
        <button type="button" className={`icon-btn ${s.reportDel}`} onClick={() => setDeleting(r)} aria-label={tr('Hapus laporan {0}', r.name)} title={tr('Hapus laporan')}>
          <Trash2 size={14} />
        </button>
      )}
    </li>
  )
  const groupHead = (id: string, name: string, count: number, list: SavedReport[], sub = false) => (
    <button type="button" className={`${s.node}${sub ? ` ${s.nodeSub}` : ''}`} onClick={() => flip(id, list)} aria-expanded={isOpen(id, list)}>
      {isOpen(id, list) ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
      <Folder size={14} aria-hidden />
      <span>{name}</span>
      <small>{count}</small>
    </button>
  )

  const wrapCls = [s.wrap, sideHidden && s.wrapNoSide, focus && s.wrapFocus].filter(Boolean).join(' ')
  return (
    <div className={wrapCls}>
      <div className={s.rails} hidden={focus}>
        {sideHidden && <EdgeTab icon={<PanelLeftOpen size={16} aria-hidden />} label={tr('Daftar Laporan')} controls="report-list" onClick={() => setSideHidden(false)} />}
        {headHidden && current && <EdgeTab icon={<PanelLeftOpen size={16} aria-hidden />} label={tr('Info Laporan')} controls="report-head" onClick={() => setHeadHidden(false)} />}
        {current && dataset ? (
          <EdgeTab icon={<SlidersHorizontal size={16} aria-hidden />} label={tr('Filter')} badge={filterCount} on={changed} onClick={() => setFilterOpen(true)} />
        ) : (
          // Before a report is chosen the filter tab is in its place but cannot open yet.
          <EdgeTab icon={<SlidersHorizontal size={16} aria-hidden />} label={tr('Filter')} waiting={tr('Pilih laporan terlebih dahulu')} />
        )}
      </div>

      {!sideHidden && (
        <Card className={s.tree} id="report-list" aria-label={tr('Daftar laporan')} hidden={focus}>
          <div className={s.treeHead}>
            <h2 className={s.treeTitle}>{tr('Daftar Laporan')} <small>{reports.length}</small></h2>
            <button type="button" className="icon-btn" onClick={() => setSideHidden(true)} aria-label={tr('Ciutkan {0}', tr('Daftar Laporan'))} title={tr('Ciutkan {0}', tr('Daftar Laporan'))}>
              <PanelLeftClose size={16} />
            </button>
          </div>
          {reports.length > 0 && <SearchInput value={q} onChange={setQ} placeholder={tr('Cari laporan atau dataset…')} label={tr('Cari laporan')} />}
          <nav className={s.treeBody} aria-label={tr('Laporan')}>
            {!reports.length && <p className="t-meta">{tr('Belum ada laporan tersimpan.')}</p>}
            {reports.length > 0 && !groups.length && <p className="t-meta">{tr('Tidak ada laporan yang cocok.')}</p>}
            <ul>
              {groups.map((g) => {
                const all = [...g.reports, ...g.subs.flatMap((x) => x.reports)]
                return (
                  <li key={g.id}>
                    {groupHead(g.id, g.id === NONE ? tr('Tanpa kategori') : g.name, g.count, all)}
                    {isOpen(g.id, all) && (
                      <ul className={s.subs}>
                        {g.subs.map((x) => (
                          <li key={x.id}>
                            {groupHead(x.id, x.name, x.reports.length, x.reports, true)}
                            {isOpen(x.id, x.reports) && <ul className={s.subs}>{x.reports.map(reportBtn)}</ul>}
                          </li>
                        ))}
                        {g.reports.map(reportBtn)}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </nav>
        </Card>
      )}

      <div className={s.main}>
        {!reports.length ? (
          <Card><EmptyState title={tr('Belum ada laporan tersimpan')} message={tr('Atur tampilan di halaman Analisis, lalu tekan Simpan Laporan.')} /></Card>
        ) : current ? (
          <>
            {!headHidden && (
              <Card id="report-head" className={s.head} hidden={focus}>
                <div className={s.headMain}>
                  <h2 className={s.headTitle}>{current.name}</h2>
                  <p className="t-meta">
                    {categoryName(current.categoryId)} · {current.datasetName ?? tr('Dataset dihapus')} · {current.createdByName ?? tr('–')} · {formatDateTime(current.updatedAt)}
                  </p>
                  {active && dataset && (
                    <p className={s.headFilter}>
                      <FilterIcon size={13} aria-hidden />
                      <span>
                        {formatDate(active.filter.dateFrom)} – {formatDate(active.filter.dateTo)}
                        {' · '}{tr('tanggal laporan {0}', active.filter.reportDate ? formatDate(active.filter.reportDate) : tr('otomatis'))}
                        {filterCount > 0 && ` · ${tr('{0} filter aktif', filterCount)}`}
                        {changed && ` · ${tr('diubah dari filter laporan')}`}
                      </span>
                      <button type="button" className={s.link} onClick={() => setFilterOpen(true)}>{tr('Ubah filter')}</button>
                    </p>
                  )}
                  {params.length > 0 && (
                    <p className="t-meta" aria-label={tr('Parameter laporan')}>
                      {tr('Parameter:')}{' '}{params.join(' · ')}
                    </p>
                  )}
                </div>
                <div className={s.headActions}>
                  {canEdit(current) && dataset && (
                    <Button size="sm" icon={<BarChart3 size={14} aria-hidden />} onClick={editInAnalysis} title={tr('Buka layout laporan ini di Analisis; Simpan Laporan menyimpan perubahan ke laporan yang sama')}>
                      {tr('Ubah di Analisis')}
                    </Button>
                  )}
                  {canDelete(current) && (
                    <Button size="sm" icon={<Trash2 size={14} aria-hidden />} onClick={() => setDeleting(current)} aria-label={tr('Hapus laporan {0}', current.name)}>
                      {tr('Hapus')}
                    </Button>
                  )}
                  <button type="button" className="icon-btn" onClick={() => setHeadHidden(true)} aria-label={tr('Ciutkan {0}', tr('Info Laporan'))} title={tr('Ciutkan {0}', tr('Info Laporan'))}>
                    <PanelLeftClose size={16} />
                  </button>
                </div>
              </Card>
            )}
            {dataset && active ? (
              <SavedReportGrid key={current.id} report={current} dataset={dataset} filter={active.filter} scope={active.scope} focus={focus} onToggleFocus={() => setFocus((f) => !f)} onChangeFilter={() => setFilterOpen(true)} />
            ) : (
              <Card><EmptyState title={tr('Dataset laporan ini tidak tersedia')} message={tr('Dataset yang dipakai laporan ini sudah dihapus atau diarsipkan, jadi tabelnya tidak dapat ditampilkan.')} /></Card>
            )}
          </>
        ) : (
          <StartCard id="report-start" icon={<FileText size={22} />} title={tr('Pilih laporan untuk ditampilkan')}>
            <p>{tr('Halaman ini belum memuat laporan apa pun agar terbuka cepat. Pilih laporan dari Daftar Laporan; tabel hasil dimuat setelah laporan dipilih.')}</p>
            {sideHidden && (
              <Button variant="primary" icon={<PanelLeftOpen size={14} aria-hidden />} onClick={() => setSideHidden(false)}>
                {tr('Buka Daftar Laporan')}
              </Button>
            )}
            {recent.length > 0 && (
              <div className={s.recent}>
                <span className="t-label">{tr('Terakhir diperbarui')}</span>
                <ul>
                  {recent.map((r) => (
                    <li key={r.id}>
                      <button type="button" className={s.report} onClick={() => setChosen(r.id)}>
                        <FileText size={14} aria-hidden />
                        <span>
                          {r.name}
                          <small>{categoryName(r.categoryId)} · {r.datasetName ?? tr('Dataset dihapus')}</small>
                        </span>
                        <small className={s.recentWhen}>{formatDateTime(r.updatedAt)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </StartCard>
        )}
      </div>

      {filterOpen && current && dataset && active && saved && (
        <FilterModal
          dataset={dataset}
          subtitle={current.name}
          filter={active.filter}
          scope={active.scope}
          saved={saved}
          onApply={(filter, scope) => setApplied({ id: current.id, filter, scope })}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {deleting && (
        <Modal title={tr('Hapus laporan?')} onClose={() => setDeleting(null)} footer={<><Button onClick={() => setDeleting(null)}>{tr('Batal')}</Button><Button variant="primary" loading={busy} onClick={() => void remove()}>{tr('Hapus')}</Button></>}>
          <p>{tr('Laporan')}{' '}<b>{deleting.name}</b>{' '}{tr('dihapus dari daftar. Dataset dan data sumbernya tidak berubah.')}</p>
        </Modal>
      )}
    </div>
  )
}
