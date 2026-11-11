import { useId, type SelectHTMLAttributes } from 'react'

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size'> {
  label: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  hideLabel?: boolean
  size?: 'sm' | 'md'
}

export function SelectField({ label, options, onChange, hideLabel, size = 'md', className, ...rest }: SelectFieldProps) {
  const id = useId()
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 't-label'}>
        {label}
      </label>
      <select id={id} className={`select${size === 'sm' ? ' select--sm' : ''}`} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
