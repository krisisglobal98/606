import type { ReactNode } from 'react'

interface MetricProps {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
}

export function Metric({ label, value, unit, sub }: MetricProps) {
  return (
    <div className="metric">
      <small>{label}</small>
      <b className="num">
        {value}
        {unit && <em>{unit}</em>}
      </b>
      {sub && <span>{sub}</span>}
    </div>
  )
}
