import type { ReactNode } from 'react'

interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: ReactNode; icon?: ReactNode }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}

/** Pill tab group from the reference top bar; used for small mutually exclusive choices. */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className={`seg${size === 'sm' ? ' seg--sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
