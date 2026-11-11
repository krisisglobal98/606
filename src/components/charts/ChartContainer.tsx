import { lazy, Suspense, type ReactNode } from 'react'
import { Card } from '@/components/common/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import type { EChartsOption } from './echarts'
import { tr } from '@/i18n'

const EChart = lazy(() => import('./EChart'))

export type LoadStatus = 'loading' | 'success' | 'error'

interface ChartContainerProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  legend?: ReactNode
  footer?: ReactNode
  status: LoadStatus
  error?: string
  onRetry?: () => void
  isEmpty?: boolean
  emptyMessage?: string
  option: EChartsOption | null
  height?: number
  ariaLabel: string
  className?: string
}

/** Card + loading/empty/error handling around a chart. ECharts is lazy-loaded on first use. */
export function ChartContainer({ title, subtitle, actions, legend, footer, status, error, onRetry, isEmpty, emptyMessage, option, height = 260, ariaLabel, className }: ChartContainerProps) {
  const skeleton = (
    <div style={{ height, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '10px 4px' }} aria-busy="true" aria-label={tr('Memuat grafik')}>
      {[48, 66, 55, 80, 62, 74, 58, 70].map((h, i) => (
        <Skeleton key={i} h={`${h}%`} style={{ flex: 1 }} />
      ))}
    </div>
  )
  let body: ReactNode
  if (status === 'loading') body = skeleton
  else if (status === 'error') body = <ErrorState message={error ?? tr('Terjadi kesalahan.')} onRetry={onRetry} height={height} />
  else if (isEmpty || !option) body = <EmptyState title={tr('Tidak ada data')} message={emptyMessage ?? tr('Tidak ada data untuk pilihan saat ini.')} height={height} />
  else
    body = (
      <Suspense fallback={skeleton}>
        <EChart option={option} height={height} ariaLabel={ariaLabel} />
      </Suspense>
    )
  return (
    <Card title={title} subtitle={subtitle} actions={actions} className={className}>
      {status === 'success' && !isEmpty && legend}
      {body}
      {footer}
    </Card>
  )
}
