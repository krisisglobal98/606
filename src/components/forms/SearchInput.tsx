import { Search, X } from 'lucide-react'
import { tr } from '@/i18n'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
  className?: string
}

export function SearchInput({ value, onChange, placeholder, label, className }: SearchInputProps) {
  return (
    <div className={['input-wrap', 'search', className].filter(Boolean).join(' ')}>
      <Search size={14} aria-hidden />
      <input className="input" type="search" value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <span className="input-action">
          <button type="button" className="icon-btn" onClick={() => onChange('')} aria-label={tr('Hapus pencarian')}>
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  )
}
