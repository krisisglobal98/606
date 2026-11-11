export interface LegendItem {
  label: string
  color: string
  kind?: 'line' | 'box' | 'dash'
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.kind === 'box' ? 'box' : i.kind === 'dash' ? 'dash' : undefined} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}
