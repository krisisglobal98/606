import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { opensUp } from './dropPlacement'
import s from './SearchableSelect.module.css'
import { tr } from '@/i18n'

interface Props {
  label: string
  /** Every value that can be chosen (null while loading). */
  options: string[] | null
  selected: string[]
  onToggle: (v: string) => void
  onClear: () => void
  /** Text when nothing is chosen (nothing chosen = every value). */
  allLabel: string
  error?: string | null
  onRetry?: () => void
  /** Shown under the list, e.g. that only the first values are listed. */
  note?: string | null
  className?: string
}

/** A dropdown checklist with search and a scrolling list: nothing checked means every value. */
export function MultiSelect({ label, options, selected, onToggle, onClear, allLabel, error, onRetry, note, className }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [up, setUp] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = options ?? []
    return t ? all.filter((v) => v.toLowerCase().includes(t)) : all
  }, [options, q])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  // Inside a scrolling box (a modal body), bring the whole popover into view once it opens (or once its values load).
  const pop = useRef<HTMLDivElement>(null)
  const loaded = !!options
  useEffect(() => {
    if (open) pop.current?.scrollIntoView({ block: 'nearest' })
  }, [open, loaded])
  // Escape closes only this list (not a modal around it).
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
  }

  const summary = !selected.length ? allLabel : selected.length === 1 ? selected[0] : tr('{0} dipilih', selected.length)
  return (
    <div className={`field ${s.root}${className ? ` ${className}` : ''}`} ref={root}>
      <span className="t-label" id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className={`${s.trigger}${selected.length ? ` ${s.on}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? setOpen(false) : (setUp(opensUp(trigger.current)), setQ(''), setOpen(true)))}
      >
        <span id={`${id}-value`} className={selected.length ? s.value : s.placeholder}>{summary}</span>
        <ChevronDown size={15} aria-hidden className={s.chev} />
      </button>
      {open && (
        <div ref={pop} className={`${s.pop}${up ? ` ${s.up}` : ''}`} id={`${id}-pop`} role="dialog" aria-labelledby={`${id}-label`} onKeyDown={onKey}>
          {error ? (
            <p className={s.msg} role="alert">
              {error}{' '}
              {onRetry && <button type="button" className={s.link} onClick={onRetry}>{tr('Coba lagi')}</button>}
            </p>
          ) : !options ? (
            <p className={s.msg}>{tr('Memuat…')}</p>
          ) : (
            <>
              <div className={s.search}>
                <Search size={14} aria-hidden />
                <input autoFocus value={q} placeholder={tr('Cari {0}…', label.toLowerCase())} aria-label={tr('Cari {0}', label)} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className={`${s.list} ${s.checks}`} role="group" aria-labelledby={`${id}-label`}>
                {shown.map((v) => (
                  <label key={v} className="check" title={v}>
                    <input type="checkbox" checked={selected.includes(v)} onChange={() => onToggle(v)} />
                    <span>{v}</span>
                  </label>
                ))}
                {!shown.length && <p className={s.none}>{tr('Tidak ada yang cocok.')}</p>}
              </div>
              <div className={s.bar}>
                <span>{selected.length ? tr('{0} dipilih', selected.length) : allLabel}</span>
                <button type="button" className={s.link} onClick={onClear} disabled={!selected.length}>
                  {tr('Hapus pilihan')}
                </button>
              </div>
              {note && <p className={s.foot}>{note}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
