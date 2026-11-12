import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { Save, ArrowLeft, Database, DatabaseZap, History, IdCard, Info, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { DatasetBrowser } from './DatasetBrowser'
import { KpiSkeleton, KpiTile } from '@/components/analytics/KpiTile'
import { Card } from '@/components/common/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/StateView'
import { useResource } from '@/hooks/useResource'
import { analyticsService } from '@/services/analytics/analyticsService'
import { datasetService } from '@/services/dataset/datasetService'
import { LEFT_PANELS, RIGHT_PANELS, useAnalysisStore, type Panel } from '@/stores/analysisStore'
import type { AnalyticsQuery, Dataset, Field } from '@/types/contracts'
import { Button } from '@/components/common/Button'
import { formatNumber } from '@/utils/format'
import { createEngine, kpiMeasures, type CalcMeasure } from '@/semantic/measureEngine'
import { selectCalc, useGridPrefs } from '@/stores/gridPrefsStore'
import { EdgeTab } from '@/components/common/EdgeTab'
import { StartCard } from '@/components/common/StartCard'
import { PanelTab } from './CollapseToggle'
import { DataSettingsPanel } from './DataSettingsPanel'
import { FieldList } from './FieldList'
import { AnalysisFilterModal, FilterSummary, FilterTab } from './FilterBar'
import { DataProfile } from './profile/DataProfile'
import { LayoutZones } from './LayoutZones'
import { ResultChart } from './ResultChart'
import { CalcMeasureModal } from './grid/CalcMeasureModal'
import { SaveReportModal } from './SaveReportModal'
import { PivotGrid } from './grid/PivotGrid'
import { useHierarchy } from './grid/useHierarchy'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

/**
 * Data Profil is hidden for now (not removed): its card, its edge tab and its standalone opener are left out while this
 * is false. Its code, routes and API stay as they are; set it to true to bring the card back.
 */
const PROFILE_ENABLED = false

export default function AnalysisPage() {
  const catalog = useResource((signal) => {
    void signal
    return datasetService.getCatalog()
  }, 'catalog')

  if (catalog.status === 'error' && !catalog.data)
    return (
      <Card>
        <ErrorState message={catalog.error ?? tr('')} onRetry={catalog.reload} height={480} />
      </Card>
    )
  if (!catalog.data) return <LoadingState label={tr('Memuat katalog data…')} height={480} />
  return <Workspace catalog={catalog.data} onReload={() => (datasetService.invalidate(), catalog.reload())} />
}

/**
 * A real dataset whose source cannot be reached. Shown instead of results: the page never swaps in
 * sample data for a real dataset.
 */
function SourceUnavailable({ dataset, message, datasets, onRetry }: { dataset: Dataset | null; message: string; datasets: Dataset[]; onRetry: () => void }) {
  const setDataset = useAnalysisStore((st) => st.setDataset)
  const other = datasets.find((d) => d.id !== dataset?.id && d.source?.available !== false)
  return (
    <Card>
      <ErrorState
        title={tr('Data Source Unavailable')}
        message={tr('{0} tidak dapat diakses saat ini. {1}', dataset ? tr('Dataset "{0}" ({1})', dataset.label, dataset.source?.connectionName ?? 'sumber') : tr('Dataset yang terakhir dipakai'), message)}
        onRetry={onRetry}
        action={other ? <Button size="sm" icon={<Database size={14} aria-hidden />} onClick={() => setDataset(other)}>{tr('Pakai')}{' '}{other.label}</Button> : undefined}
        height={420}
      />
    </Card>
  )
}

/**
 * The server refused this dataset for the signed-in user: not standard (no default parameter), or no access scope.
 * No figures are shown and no query is sent; the message is the server's (levels 5/8/9 get no parameter wording).
 */
function AccessDenied({ dataset, datasets }: { dataset: Dataset; datasets: Dataset[] }) {
  const setDataset = useAnalysisStore((st) => st.setDataset)
  const other = datasets.find((d) => d.id !== dataset.id && d.source?.available !== false && d.access?.status !== 'denied')
  const noScope = dataset.access?.code === 'SCOPE_UNRESOLVED'
  return (
    <Card>
      <ErrorState
        title={noScope ? tr('Cakupan akses data belum ditentukan') : tr('Data tidak ditampilkan')}
        message={dataset.access?.message ?? tr('Data tidak tersedia untuk cakupan akses Anda.')}
        action={other ? <Button size="sm" icon={<Database size={14} aria-hidden />} onClick={() => setDataset(other)}>{tr('Pakai')}{' '}{other.label}</Button> : undefined}
        height={420}
      />
    </Card>
  )
}

/** A collapsed card that cannot open yet (no data chosen): shown in its place, muted, with the reason. */
function WaitingTab({ label, side }: { label: string; side: 'left' | 'right' }) {
  return <EdgeTab label={label} icon={side === 'left' ? <PanelLeftOpen size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />} waiting={tr('Pilih data terlebih dahulu')} />
}

/**
 * The page before any data is chosen: the cards collapsed at their edges and, in the middle, a short message with the
 * dataset picker (Kategori → Sub-kategori → Dataset, with search). Nothing is queried until a dataset is chosen.
 * The last analysis of this session can be picked up as it was.
 */
function StartView({ datasets, last, onPick, onResume }: { datasets: Dataset[]; last: Dataset | null; onPick: (d: Dataset) => void; onResume: () => void }) {
  const usable = last && last.source?.available !== false && last.access?.status !== 'denied' ? last : null
  return (
    <div className={`${s.ws} ${s.sideNarrow}`} style={{ '--left-w': '44px', '--right-w': '44px' } as CSSProperties}>
      <aside className={`${s.left} ${s.sticky}`} aria-label={tr('Pengaturan data')}>
        <div className={`${s.tabs} ${s.tabsLeft}`}>
          <WaitingTab label={tr('Pengaturan Data')} side="left" />
          <WaitingTab label={tr('Hasil Analisis')} side="left" />
          <WaitingTab label={tr('Filter')} side="left" />
        </div>
      </aside>
      <div className={s.main}>
        <h1 className="sr-only">{tr('Analisis')}</h1>
        <StartCard id="start-title" icon={<DatabaseZap size={22} />} title={tr('Pilih data untuk mulai analisis')}>
          <p>{tr('Halaman ini belum memuat data apa pun agar terbuka cepat. Pilih set data di bawah; tabel hasil dimuat setelah data dipilih.')}</p>
          {usable && (
            <Button variant="primary" icon={<History size={14} aria-hidden />} onClick={onResume}>
              {tr('Lanjutkan analisis terakhir: {0}', usable.label)}
            </Button>
          )}
          <div className={s.startPick}>
            <span className="t-label">{usable ? tr('Atau pilih set data lain') : tr('Set data')}</span>
            <DatasetBrowser datasets={datasets} current={null} onPick={onPick} className={s.startBrowser} />
          </div>
        </StartCard>
      </div>
      <aside className={`${s.right} ${s.sticky}`} aria-label={tr('Daftar field')}>
        <div className={`${s.tabs} ${s.tabsRight}`}>
          <WaitingTab label={tr('Field List')} side="right" />
          <WaitingTab label={tr('Layout (Drag & Drop)')} side="right" />
        </div>
      </aside>
    </div>
  )
}

function Workspace({ catalog, onReload }: { catalog: NonNullable<Awaited<ReturnType<typeof datasetService.getCatalog>>>; onReload: () => void }) {
  const datasetId = useAnalysisStore((st) => st.datasetId)
  const scope = useAnalysisStore((st) => st.scope)
  const filter = useAnalysisStore((st) => st.filter)
  const dimIds = useAnalysisStore((st) => st.dimensions)
  const meaIds = useAnalysisStore((st) => st.measures)
  const chartBy = useAnalysisStore((st) => st.chartBy)
  const collapsed = useAnalysisStore((st) => st.collapsed)
  // The chart (ECharts, ~180 KB compressed) is mounted once its card is first opened, not while it is collapsed:
  // a slow connection then gets KPI and Tabel Hasil without waiting for the chart library. Once opened it stays mounted.
  const [chartSeen, setChartSeen] = useState(!collapsed.chart)
  if (!collapsed.chart && !chartSeen) setChartSeen(true)
  const setPanel = useAnalysisStore((st) => st.setPanel)
  const focus = useAnalysisStore((st) => st.tableFocus)
  const setFocus = useAnalysisStore((st) => st.setTableFocus)
  const scrollY = useRef(0)
  const backRef = useRef<HTMLButtonElement>(null)

  const setDataset = useAnalysisStore((st) => st.setDataset)
  const refreshPeriod = useAnalysisStore((st) => st.refreshPeriod)
  const found = catalog.datasets.find((d) => d.id === datasetId) ?? null
  // The page opens empty and light: no dataset is loaded and no query is sent until the user chooses data (or picks
  // up the last analysis of this session). Choosing marks the page as started until the user leaves it.
  const [started, setStarted] = useState(false)
  const dataset = started ? found : null
  const choose = (d: Dataset) => {
    // A new dataset starts at month to date; the last analysis of the session moves a default period to today.
    if (d.id !== datasetId) setDataset(d)
    else refreshPeriod()
    setStarted(true)
  }
  const denied = dataset?.access?.status === 'denied'
  // A refused dataset is treated like an unreachable one: no query is sent.
  const unavailable = dataset?.source?.available === false || denied
  // One semantic measure engine for the dataset: raw, derived (built-in) and calculated measures.
  const calc = useGridPrefs(selectCalc(dataset?.id ?? ''))
  const saveCalc = useGridPrefs((st) => st.saveCalc)
  const removeCalc = useGridPrefs((st) => st.removeCalc)
  const placeField = useAnalysisStore((st) => st.placeField)
  const removeField = useAnalysisStore((st) => st.removeField)
  const [calcEdit, setCalcEdit] = useState<CalcMeasure | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const engine = useMemo(() => (dataset ? createEngine(dataset, calc) : null), [dataset, calc])
  const allFields = useMemo(() => [...(dataset?.fields ?? []), ...(engine?.extraFields ?? [])], [dataset, engine])
  const fieldMap = useMemo(() => new Map(allFields.map((f) => [f.id, f])), [allFields])
  // Ignore stale ids (e.g. a layout restored from another warehouse).
  const dimensions = dimIds.map((id) => fieldMap.get(id)).filter((f): f is Field => f?.kind === 'dimension')
  const measures = meaIds.filter((id) => fieldMap.get(id)?.kind === 'measure')
  // Only warehouse/sample measures go to the server; derived and calculated ones are computed from them.
  const serverMeasures = engine?.serverMeasures(measures) ?? []
  const chartDim = chartBy !== 'trend' && dimensions.some((d) => d.id === chartBy) ? chartBy : 'trend'

  // Summary query (chart): row dimensions are not needed, the table loads lazily.
  const query: AnalyticsQuery | null =
    dataset && !unavailable && serverMeasures.length
      ? { datasetId: dataset.id, scope, filter, dimensions: chartDim === 'trend' ? [] : [chartDim], measures: serverMeasures, chartBy: chartDim }
      : null
  // The grid asks only for what is shown: the Layout's measures plus the dataset KPI measures that the
  // KPI tiles read from the same grand total. Row counts only when Count/Average is chosen.
  const measureSettings = useAnalysisStore((st) => st.measureSettings)
  const gridMeasures = engine && dataset ? [...new Set([...serverMeasures, ...kpiMeasures(dataset, engine)])] : []
  const withCounts = measures.some((m) => measureSettings[m]?.display?.some((c) => c === 'count' || c === 'average'))
  const gridQuery: AnalyticsQuery | null = query ? { ...query, measures: gridMeasures, dimensions: dimensions.map((d) => d.id), chartBy: 'trend' } : null
  const hier = useHierarchy(gridQuery, withCounts)
  const key = JSON.stringify(query)
  const fetcher = useCallback((signal: AbortSignal) => (query ? analyticsService.query(query, signal) : Promise.resolve(null)), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const res = useResource(fetcher, key, 220)

  // A result of another dataset is never shown while the new one loads (no mixing sample and real data).
  const result = res.data && res.data.datasetId === dataset?.id ? res.data : null
  const refreshing = res.status === 'loading' && !!result
  const status = refreshing ? 'success' : res.status
  const isEmpty = !!result && result.summary.sourceRowCount === 0
  const panel = { result, status, error: res.error ?? undefined, onRetry: res.reload, isEmpty } as const
  const tableInfo = !focus && result?.execution ? (
          <span className={s.infoWrap}>
            <button type="button" className="icon-btn" aria-label={tr('Informasi data')} aria-describedby="analysis-info">
              <Info size={15} aria-hidden />
            </button>
            <span id="analysis-info" role="tooltip" className={s.infoPop}>
              <span className={s.exec}>
                <Database size={13} aria-hidden />
                <span>
                  {tr('Diagregasi di')}{' '}<b>{result.execution.source}</b>: <b>{formatNumber(result.execution.sourceRows)}</b>{' '}{tr('baris sumber · tabel dimuat per level saat dibuka · ringkasan')}{' '}{result.execution.queries}{' '}{tr('query ·')}{' '}{formatNumber(result.execution.durationMs / 1000, 1)}{' '}{tr('detik')}
                </span>
              </span>
            </span>
          </span>
  ) : null

  // Table Focus Mode: other cards are only hidden, so leaving it restores the page as it was,
  // including the scroll position.
  const prevFocus = useRef(focus)
  useLayoutEffect(() => {
    if (prevFocus.current === focus) return
    prevFocus.current = focus
    if (focus) {
      window.scrollTo(0, 0)
      backRef.current?.focus()
    } else {
      window.scrollTo(0, scrollY.current)
      document.getElementById('table-focus-btn')?.focus()
    }
  }, [focus])
  useEffect(() => {
    if (!focus) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocus(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, setFocus])
  useEffect(() => () => setFocus(false), [setFocus])
  const collapseAll = useAnalysisStore((st) => st.collapseAll)
  // Every visit starts with the cards collapsed (they open again on request).
  useEffect(() => collapseAll(), [collapseAll])
  const enterFocus = () => {
    scrollY.current = window.scrollY
    collapseAll()
    setFocus(true)
  }

  // Data Profil reads the master data, not the dataset, so it stays reachable when there is no usable dataset.
  const profileOpen = PROFILE_ENABLED && !collapsed.profile
  const standaloneProfile = !PROFILE_ENABLED ? null : collapsed.profile ? (
    <Card>
      <div className={s.profileOpen}>
        <span>
          <b>{tr('Data Profil')}</b>
          <small>{tr('Profil blok dan kartu kendaraan dari data master tetap dapat dibuka.')}</small>
        </span>
        <Button size="sm" icon={<IdCard size={14} aria-hidden />} onClick={() => setPanel('profile', false)}>
          {tr('Buka Data Profil')}
        </Button>
      </div>
    </Card>
  ) : (
    <div id="panel-profile" className={s.enter}>
      <DataProfile />
    </div>
  )
  if (!dataset && catalog.datasets.length)
    return <StartView datasets={catalog.datasets} last={found} onPick={choose} onResume={() => setStarted(true)} />
  if (!dataset)
    return (
      <div className={s.standalone}>
        <Card>
          <EmptyState
            title={tr('Belum ada dataset')}
            message={tr('Analisis memakai dataset dari database DOD. Buat dataset dari tabel sumber di Data → Set Data untuk mulai menganalisis.')}
            action={<Link className="btn btn--sm btn--primary" to="/data/dataset"><DatabaseZap size={13} aria-hidden />{' '}{tr('Buka Set Data')}</Link>}
            height={420}
          />
        </Card>
        {standaloneProfile}
      </div>
    )
  if (denied)
    return (
      <div className={s.standalone}>
        <AccessDenied dataset={dataset} datasets={catalog.datasets} />
        {standaloneProfile}
      </div>
    )
  if (unavailable)
    return (
      <div className={s.standalone}>
        <SourceUnavailable
          dataset={dataset}
          message={dataset.source?.error?.message ?? tr('Sumber data tidak dapat dihubungi.')}
          datasets={catalog.datasets}
          onRetry={onReload}
        />
        {standaloneProfile}
      </div>
    )

  // Edge columns: the full card when Pengaturan Data / Field List is open, otherwise just the width of
  // the vertical tabs. Collapsed cards release their space; open cards sit in their original places.
  const LABEL: Record<Panel, string> = { settings: tr('Pengaturan Data'), chart: tr('Hasil Analisis'), profile: tr('Data Profil'), fields: tr('Field List'), layout: tr('Layout (Drag & Drop)') }
  const wsStyle = { '--left-w': collapsed.settings ? '44px' : '236px', '--right-w': collapsed.fields ? '44px' : '248px' } as CSSProperties
  const sideNarrow = collapsed.settings && collapsed.fields
  // Data Profil sits right after Hasil Analisis and does not depend on the dataset query.
  const profile = PROFILE_ENABLED ? (
    <div id="panel-profile" className={s.enter} hidden={focus || !profileOpen}>
      <DataProfile />
    </div>
  ) : null
  const leftTabs = LEFT_PANELS.filter((p) => collapsed[p] && (p !== 'profile' || PROFILE_ENABLED))
  const rightTabs = RIGHT_PANELS.filter((p) => collapsed[p])

  return (
    <div className={[s.ws, sideNarrow && s.sideNarrow, focus && s.focusWs].filter(Boolean).join(' ')} style={wsStyle}>
      <aside className={`${s.left} ${s.sticky}`} aria-label={tr('Pengaturan data')} hidden={focus}>
        <div id="panel-settings" className={s.enter} hidden={collapsed.settings}>
          <DataSettingsPanel datasets={catalog.datasets} dataset={dataset} sourceRows={result?.summary.sourceRowCount ?? null} />
        </div>
        <div className={`${s.tabs} ${s.tabsLeft}`}>
          {leftTabs.map((p) => (
            <PanelTab key={p} panel={p} label={LABEL[p]} side="left" />
          ))}
          <FilterTab onOpen={() => setFilterOpen(true)} />
        </div>
      </aside>

      <div className={s.main}>
        <h1 className="sr-only">{tr('Analisis')}{' '}{dataset.label}</h1>
        {dataset.access?.status === 'partial' && (
          <div className="callout callout--info" role="note" hidden={focus}>
            <span>
              {dataset.access.unmappedShare != null
                ? tr('{0}% baris dataset ini tidak memiliki Unit Operasional yang valid dan tidak ditampilkan.', (dataset.access.unmappedShare * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }))
                : tr('Sebagian baris dataset ini tidak memiliki Unit Operasional yang valid dan tidak ditampilkan.')}
            </span>
          </div>
        )}
        {focus && (
          <div>
            <button ref={backRef} type="button" className="btn btn--sm btn--ghost" onClick={() => setFocus(false)}>
              <ArrowLeft size={14} aria-hidden />{' '}{tr('Kembali ke Analisis')}
            </button>
          </div>
        )}
        <div className={s.saveBar} hidden={focus}>
          <FilterSummary dataset={dataset} onOpen={() => setFilterOpen(true)} />
          <Button size="sm" icon={<Save size={14} aria-hidden />} disabled={!query} title={query ? undefined : tr('Pilih minimal satu measure lebih dulu')} onClick={() => setSaving(true)}>
            {tr('Simpan Laporan')}
          </Button>
        </div>
        {saving && <SaveReportModal datasetId={dataset.id} onClose={() => setSaving(false)} />}
        {filterOpen && <AnalysisFilterModal key={dataset.id} dataset={dataset} onClose={() => setFilterOpen(false)} />}
        <div id="panel-layout" className={s.enter} hidden={focus || collapsed.layout}>
          <LayoutZones fields={allFields} engine={engine} />
        </div>

        {!query ? (
          <>
            <Card>
              <EmptyState title={tr('Belum ada measure')} message={tr('Tarik minimal satu measure dari Field List ke area Measure untuk menampilkan hasil.')} height={320} />
            </Card>
            {profile}
          </>
        ) : res.status === 'error' ? (
          <>
            <Card>
              <ErrorState title={tr('Data Source Unavailable')} message={tr('{0} Hasil tidak ditampilkan.', res.error ?? '')} onRetry={res.reload} height={320} />
            </Card>
            {profile}
          </>
        ) : (
          <>
            {/* KPI tiles use the same semantic engine as the table (grand total of the current context). */}
            <section className={s.kpis} aria-label={tr('Ringkasan hasil')} aria-busy={hier.status === 'loading'} hidden={focus || profileOpen}>
              {hier.total && engine
                ? engine.kpis(hier.total, hier.sourceRows === 0).map((k) => <KpiTile key={k.id} kpi={k} />)
                : Array.from({ length: 4 }, (_, i) => <KpiSkeleton key={i} />)}
            </section>
            <div id="panel-chart" className={s.enter} hidden={focus || collapsed.chart}>
              {chartSeen && <ResultChart {...panel} refreshing={refreshing} dataset={dataset} dimensions={dimensions} />}
            </div>
            {profile}
            {/* Data Profil and Tabel Hasil take turns: opening the profile collapses the table, collapsing it brings the table back. */}
            <div id="panel-table" className={s.tableSlot} hidden={!focus && profileOpen}>
              {engine && <PivotGrid hier={hier} engine={engine} dims={dimensions} periodLabel={result?.summary.periodLabel ?? null} titleInfo={tableInfo} focus={focus} onToggleFocus={() => (focus ? setFocus(false) : enterFocus())} />}
            </div>
          </>
        )}
      </div>

      {calcEdit && engine && (
        <CalcMeasureModal
          engine={engine}
          existing={calc}
          initial={calcEdit === 'new' ? null : calcEdit}
          onClose={() => setCalcEdit(null)}
          onSave={(m) => {
            saveCalc(dataset.id, m)
            if (calcEdit === 'new') placeField(m.id, 'measures')
            setCalcEdit(null)
          }}
        />
      )}
      <aside className={`${s.right} ${s.sticky}`} aria-label={tr('Daftar field')} hidden={focus}>
        <div id="panel-fields" className={s.enter} hidden={collapsed.fields}>
          <FieldList
            fields={allFields}
            category={engine?.category}
            onAddCalc={() => setCalcEdit('new')}
            onEditCalc={(id) => setCalcEdit(calc.find((c) => c.id === id) ?? null)}
            onRemoveCalc={(id) => {
              removeField(id)
              removeCalc(dataset.id, id)
            }}
          />
        </div>
        <div className={`${s.tabs} ${s.tabsRight}`}>
          {rightTabs.map((p) => (
            <PanelTab key={p} panel={p} label={LABEL[p]} side="right" />
          ))}
        </div>
      </aside>
    </div>
  )
}
