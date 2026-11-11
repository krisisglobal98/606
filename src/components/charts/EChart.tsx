import { useEffect, useRef } from 'react'
import { echarts, type EChartsOption } from './echarts'

interface EChartProps {
  option: EChartsOption
  height: number
  ariaLabel: string
}

/** Thin imperative wrapper: one instance per mount, option replaced on change, resizes with its box. */
export default function EChart({ option, height, ariaLabel }: EChartProps) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={el} className="chart-box" style={{ height }} role="img" aria-label={ariaLabel} />
}
