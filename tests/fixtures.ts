import type { Dataset } from '@/types/contracts'

/** A dataset with nothing in common with the Produksi sample: no target, no %, no Ton. */
export const SALES: Dataset = {
  id: 'sales',
  label: 'Sales',
  description: 'Generic sales dataset',
  coverage: { from: '2025-01-01', to: '2026-09-30' },
  kpi: { actual: 'revenue', target: null, achievement: null },
  defaultLayout: { dimensions: ['region'], measures: ['revenue', 'cost'] },
  fields: [
    { id: 'region', label: 'Region', kind: 'dimension', dataType: 'string' },
    { id: 'revenue', label: 'Revenue', kind: 'measure', dataType: 'number', unit: 'IDR', decimals: 0, calc: { kind: 'base' } },
    { id: 'cost', label: 'Cost', kind: 'measure', dataType: 'number', decimals: 0, calc: { kind: 'base' } },
    { id: 'units', label: 'Units', kind: 'measure', dataType: 'number', decimals: 0, calc: { kind: 'base' } },
    { id: 'margin_pct', label: 'Margin %', kind: 'measure', dataType: 'number', unit: '%', decimals: 1, calc: { kind: 'ratio', num: 'revenue', den: 'cost', scale: 100 } },
  ],
}

/** A dataset that does define an actual/target pair (so built-in comparisons exist). */
export const PLAN: Dataset = {
  ...SALES,
  id: 'plan',
  kpi: { actual: 'revenue', target: 'cost', achievement: 'margin_pct' },
}

export const agg = (cur: Record<string, number | null>, prev: Record<string, number | null> = {}) => ({ cur, prev })
