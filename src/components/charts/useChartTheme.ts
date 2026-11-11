import { useMemo } from 'react'
import { useUiStore } from '@/stores/uiStore'

export interface ChartTheme {
  series: string[]
  ref: string
  ink: string
  muted: string
  grid: string
  axis: string
  surface: string
  line: string
  danger: string
  success: string
  font: string
}

const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Chart colours come from the same CSS tokens as the UI, re-read when the theme changes. */
export function useChartTheme(): ChartTheme {
  const theme = useUiStore((s) => s.settings.theme)
  return useMemo(() => {
    void theme
    return {
      series: ['--series-1', '--series-2', '--series-3', '--series-4'].map(read),
      ref: read('--series-ref'),
      ink: read('--ink'),
      muted: read('--muted'),
      grid: read('--chart-grid'),
      axis: read('--chart-axis'),
      surface: read('--surface'),
      line: read('--line-2'),
      danger: read('--danger'),
      success: read('--success'),
      font: read('--font'),
    }
  }, [theme])
}

/** Shared base: recessive grid/axes, token-coloured tooltip. */
export function baseOption(t: ChartTheme) {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: t.font, color: t.muted, fontSize: 11 },
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: t.surface,
      borderColor: t.line,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 12, fontFamily: t.font },
      extraCssText: 'box-shadow: var(--shadow-pop); border-radius: 6px;',
      axisPointer: { type: 'line' as const, lineStyle: { color: t.axis } },
    },
  }
}
