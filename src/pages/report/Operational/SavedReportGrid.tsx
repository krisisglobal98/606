import { useMemo } from 'react'
import { Card } from '@/components/common/Card'
import { EmptyState } from '@/components/common/StateView'
import { PivotGrid } from '@/pages/Analysis/grid/PivotGrid'
import { useLocalGridState } from '@/pages/Analysis/grid/gridState'
import { useHierarchy } from '@/pages/Analysis/grid/useHierarchy'
import { createEngine, kpiMeasures, type CalcMeasure, type MeasureSetting } from '@/semantic/measureEngine'
import type { TableOptions } from '@/stores/analysisStore'
import { flatten, sanitize, type MeasureBlock } from '@/stores/measureLayout'
import type { AnalyticsQuery, DataScope, Dataset, Field, Filter } from '@/types/contracts'
import type { SavedReport } from '@/types/report'
import { formatDate } from '@/utils/format'
import { tr } from '@/i18n'

/**
 * A saved report as Tabel Hasil, with the same engine and hierarchy as Analisis. It reads the saved layout only;
 * the figures come from the source, and the Analysis page's own state is left alone. The filters are the page's
 * (the saved ones until the user applies others in the filter modal).
 */
export function SavedReportGrid({ report, dataset, filter, scope, focus, onToggleFocus }: { report: SavedReport; dataset: Dataset; filter: Filter; scope: DataScope; focus: boolean; onToggleFocus: () => void }) {
  const l = report.layout
  const engine = useMemo(() => createEngine(dataset, l.calc as CalcMeasure[]), [dataset, l.calc])
  const fields = useMemo(() => new Map([...dataset.fields, ...engine.extraFields].map((f) => [f.id, f])), [dataset, engine])
  const state = useLocalGridState({
    table: l.table as unknown as TableOptions,
    // Fields removed from the dataset since the report was saved are left out.
    layout: sanitize(l.measureLayout as MeasureBlock[], (id) => fields.get(id)?.kind === 'measure'),
    settings: l.measureSettings as Record<string, MeasureSetting>,
  })
  const measures = flatten(state.layout)
  const dims = l.dimensions.map((id) => fields.get(id)).filter((f): f is Field => f?.kind === 'dimension')
  const server = engine.serverMeasures(measures)
  const withCounts = measures.some((m) => state.settings[m]?.display?.some((c) => c === 'count' || c === 'average'))
  const query: AnalyticsQuery | null = server.length
    ? { datasetId: dataset.id, scope, filter, dimensions: dims.map((d) => d.id), measures: [...new Set([...server, ...kpiMeasures(dataset, engine)])], chartBy: 'trend' }
    : null
  const hier = useHierarchy(query, withCounts)
  return query ? (
    <PivotGrid hier={hier} engine={engine} dims={dims} periodLabel={`${formatDate(filter.dateFrom)} – ${formatDate(filter.dateTo)}`} focus={focus} onToggleFocus={onToggleFocus} state={state} />
  ) : (
    <Card><EmptyState title={tr('Laporan ini tidak punya measure')} message={tr('Measure yang disimpan sudah tidak ada di dataset.')} /></Card>
  )
}
