import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Skeleton } from '@/components/common/StateView'
import type { Kpi } from '@/types/contracts'
import { formatNumber, formatSigned } from '@/utils/format'
import { tr } from '@/i18n'

/** One KPI figure with its change against the comparison period (display only). */
export function KpiTile({ kpi }: { kpi: Kpi }) {
  const unitSuffix = kpi.unit === '%' ? '%' : null
  const d = kpi.delta
  const good = d == null ? null : kpi.invert ? d < 0 : d >= 0
  const content = (
    <>
      <span className="kpi-label">{kpi.label}</span>
      <span className="kpi-value num">
        {kpi.id === 'growth' && kpi.value != null ? formatSigned(kpi.value, kpi.decimals) : formatNumber(kpi.value, kpi.decimals)}
        {kpi.value != null && (unitSuffix ? unitSuffix : <small>{kpi.unit}</small>)}
      </span>
      <span className="kpi-delta">
        {d != null && (
          <b className={good ? 'up' : 'down'}>
            {d >= 0 ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
            {formatSigned(d, 1)}
            {kpi.deltaUnit === 'pp' ? tr(' pp') : tr('%')}
          </b>
        )}
        {kpi.value == null ? tr('Tidak ada data') : kpi.deltaLabel}
      </span>
    </>
  )
  return <div className="kpi">{content}</div>
}

export function KpiSkeleton() {
  return (
    <div className="kpi" aria-hidden>
      <Skeleton w="55%" h={11} />
      <Skeleton w="75%" h={22} style={{ margin: '4px 0' }} />
      <Skeleton w="60%" h={11} />
    </div>
  )
}
