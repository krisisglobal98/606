import { useMemo } from 'react'
import { AreaChart, BarChart3, Info, LineChart, Loader2 } from 'lucide-react'
import { ChartContainer, type LoadStatus } from '@/components/charts/ChartContainer'
import { ChartLegend } from '@/components/charts/ChartLegend'
import { baseOption, useChartTheme, type ChartTheme } from '@/components/charts/useChartTheme'
import type { EChartsOption } from '@/components/charts/echarts'
import { Segmented } from '@/components/common/Segmented'
import { SelectField } from '@/components/forms/SelectField'
import { useAnalysisStore } from '@/stores/analysisStore'
import type { AnalyticsResult, ChartType, Dataset, Field } from '@/types/contracts'
import { formatCompact, formatNumber } from '@/utils/format'
import { CollapseToggle } from './CollapseToggle'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

/** Colour follows the measure (its position in the dataset), never its rank in the current selection. Targets read as the grey reference. */
function colorFor(id: string, ds: Dataset, t: ChartTheme) {
  if (id === ds.kpi.target) return t.ref
  const order = ds.fields.filter((f) => f.kind === 'measure' && f.id !== ds.kpi.target).map((f) => f.id)
  return t.series[Math.max(0, order.indexOf(id)) % t.series.length]!
}

function buildOption(r: AnalyticsResult, type: ChartType, ds: Dataset, t: ChartTheme): EChartsOption {
  const many = r.chart.categories.length > 12
  return {
    ...baseOption(t),
    grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      ...baseOption(t).tooltip,
      axisPointer: type === 'bar' ? { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.5 } } : baseOption(t).tooltip.axisPointer,
      formatter: (p: unknown) => {
        const ps = (Array.isArray(p) ? p : [p]) as { axisValueLabel: string; seriesIndex: number; value: number | null; color: string }[]
        const rows = ps
          .map((x) => {
            const se = r.chart.series[x.seriesIndex]!
            const f = r.measures.find((m) => m.id === se.id)
            return `<div style="display:flex;justify-content:space-between;gap:18px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${x.color};margin-right:6px"></span>${se.name}</span><b style="font-variant-numeric:tabular-nums">${formatNumber(x.value, f?.decimals ?? 1)} ${se.unit}</b></div>`
          })
          .join('')
        return `<div style="min-width:170px"><b>${ps[0]?.axisValueLabel ?? ''}</b>${rows}</div>`
      },
    },
    xAxis: {
      type: 'category',
      data: r.chart.categories,
      boundaryGap: type === 'bar',
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 11, rotate: many ? 40 : 0, hideOverlap: true },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, fontSize: 11, formatter: formatCompact } },
    series: r.chart.series.map((se) => {
      const c = colorFor(se.id, ds, t)
      const isTarget = se.id === ds.kpi.target
      return type === 'bar'
        ? { name: se.name, type: 'bar', data: se.values, barMaxWidth: 26, barGap: '10%', itemStyle: { color: c, opacity: isTarget ? 0.6 : 1, borderRadius: [4, 4, 0, 0] } }
        : {
            name: se.name,
            type: 'line',
            data: se.values,
            symbol: 'circle',
            symbolSize: r.chart.categories.length > 24 ? 0 : 7,
            showSymbol: r.chart.categories.length <= 24,
            lineStyle: { color: c, width: 2, type: isTarget ? [5, 4] : 'solid' },
            itemStyle: { color: c, borderColor: t.surface, borderWidth: 2 },
            areaStyle: type === 'area' && !isTarget ? { color: c, opacity: 0.12 } : undefined,
          }
    }),
  }
}

interface Props {
  result: AnalyticsResult | null
  status: LoadStatus
  refreshing: boolean
  error?: string
  onRetry: () => void
  dataset: Dataset
  dimensions: Field[]
  isEmpty: boolean
}

const TYPES: { value: ChartType; label: string; icon: React.ReactNode }[] = [
  { value: 'line', label: tr('Line'), icon: <LineChart size={13} aria-hidden /> },
  { value: 'bar', label: tr('Bar'), icon: <BarChart3 size={13} aria-hidden /> },
  { value: 'area', label: tr('Area'), icon: <AreaChart size={13} aria-hidden /> },
]

export function ResultChart({ result, status, refreshing, error, onRetry, dataset, dimensions, isEmpty }: Props) {
  const t = useChartTheme()
  const chartType = useAnalysisStore((st) => st.chartType)
  const chartBy = useAnalysisStore((st) => st.chartBy)
  const setChartType = useAnalysisStore((st) => st.setChartType)
  const setChartBy = useAnalysisStore((st) => st.setChartBy)
  const option = useMemo(() => (result ? buildOption(result, chartType, dataset, t) : null), [result, chartType, dataset, t])
  const byLabel = chartBy === 'trend' ? 'bulan' : (dimensions.find((d) => d.id === chartBy)?.label.toLowerCase() ?? chartBy)

  return (
    <ChartContainer
      title={tr('Hasil Analisis')}
      subtitle={result ? tr('{0} per {1} · {2}', result.chart.series.map((x) => x.name).join(', '), byLabel, result.summary.periodLabel) : tr('Menyiapkan hasil…')}
      actions={
        <div className={s.chartActions}>
          {refreshing && (
            <span className={s.updating} role="status">
              <Loader2 size={13} className="spin" aria-hidden />{' '}{tr('Memperbarui…')}
            </span>
          )}
          <SelectField
            className={s.axisSel}
            size="sm"
            hideLabel
            label={tr('Sumbu grafik')}
            value={chartBy}
            onChange={setChartBy}
            options={[{ value: 'trend', label: tr('Tren bulanan') }, ...dimensions.map((d) => ({ value: d.id, label: tr('Per {0}', d.label) }))]}
          />
          <Segmented size="sm" label={tr('Jenis grafik')} value={chartType} options={TYPES} onChange={setChartType} />
          <CollapseToggle panel="chart" label={tr('Hasil Analisis')} controls="panel-chart" direction="left" />
        </div>
      }
      legend={
        result && result.chart.series.length > 1 ? (
          <div style={{ marginBottom: 6 }}>
            <ChartLegend items={result.chart.series.map((x) => ({ label: `${x.name} (${x.unit})`, color: colorFor(x.id, dataset, t), kind: x.id === dataset.kpi.target && chartType !== 'bar' ? 'dash' : chartType === 'bar' ? 'box' : 'line' }))} />
          </div>
        ) : undefined
      }
      footer={
        result && result.chart.omitted.length > 0 && !isEmpty ? (
          <p className={s.chartNote}>
            <Info size={13} aria-hidden />
            {result.chart.omitted.join(', ')}{' '}{tr('tidak digambar karena satuannya berbeda dari')}{' '}{result.chart.series[0]?.unit}{tr('; nilainya ada di tabel.')}
          </p>
        ) : undefined
      }
      status={status}
      error={error}
      onRetry={onRetry}
      isEmpty={isEmpty}
      emptyMessage={
        result?.summary.periodLabel
          ? tr('Data tidak tersedia untuk periode {0}. Ubah rentang tanggal atau filter data untuk menampilkan grafik.', result.summary.periodLabel)
          : tr('Data tidak tersedia untuk filter saat ini. Ubah rentang tanggal atau filter data untuk menampilkan grafik.')
      }
      option={option}
      height={300}
      ariaLabel={tr('Grafik hasil analisis')}
    />
  )
}
