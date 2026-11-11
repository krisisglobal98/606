import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { opensUp } from './dropPlacement'
import s from './SearchableSelect.module.css'
import { tr } from '@/i18n'

interface Props {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  placeholder: string
  searchPlaceholder: string
  disabled?: boolean
  className?: string
  /** The selection differs from the default (highlighted trigger). */
  active?: boolean
}

/**
 * A select whose list can be searched: type to narrow it, arrows and Enter to choose, Escape to close. The list has a
 * fixed height and scrolls, so long lists never run down the page.
 */
export function SearchableSelect({ label, value, options, onChange, placeholder, searchPlaceholder, disabled, className, active: on }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options
  }, [options, q])
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])
  // Inside a scrolling box (a modal body), bring the whole popover into view once it opens.
  useEffect(() => {
    if (open) pop.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  const [up, setUp] = useState(false)
  const show = () => {
    setUp(opensUp(trigger.current))
    setQ('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    trigger.current?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (shown[active]) pick(shown[active].value)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className={`field ${s.root}${className ? ` ${className}` : ''}`} ref={root}>
      <span className="t-label" id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className={`${s.trigger}${on ? ` ${s.on}` : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault()
            show()
          }
        }}
      >
        <span id={`${id}-value`} className={current ? s.value : s.placeholder}>{current?.label ?? placeholder}</span>
        <ChevronDown size={15} aria-hidden className={s.chev} />
      </button>
      {open && (
        <div ref={pop} className={`${s.pop}${up ? ` ${s.up}` : ''}`}>
          <div className={s.search}>
            <Search size={14} aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={shown[active] ? `${id}-o${active}` : undefined}
              aria-label={tr('Cari {0}', label)}
              value={q}
              placeholder={searchPlaceholder}
              onChange={(e) => (setQ(e.target.value), setActive(0))}
              onKeyDown={onKey}
            />
          </div>
          <ul id={`${id}-list`} ref={list} role="listbox" aria-labelledby={`${id}-label`} className={s.list}>
            {shown.map((o, i) => (
              <li key={o.value} id={`${id}-o${i}`} role="option" aria-selected={o.value === value} data-active={i === active} className={i === active ? s.active : undefined} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)} title={o.label}>
                <span>{o.label}</span>
                {o.value === value && <Check size={14} aria-hidden />}
              </li>
            ))}
            {!shown.length && <li className={s.none}>{tr('Tidak ada yang cocok.')}</li>}
          </ul>
          {q.trim() && shown.length > 0 && <p className={s.foot}>{tr('{0} dari {1} pilihan', shown.length, options.length)}</p>}
        </div>
      )}
    </div>
  )
}
