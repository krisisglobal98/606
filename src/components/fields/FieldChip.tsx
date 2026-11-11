import type { KeyboardEvent, ReactNode } from 'react'
import { GripVertical, X } from 'lucide-react'
import type { Field } from '@/types/contracts'
import type { Zone } from '@/stores/analysisStore'
import { startFieldDrag } from './dnd'
import s from './fields.module.css'
import { tr } from '@/i18n'

interface FieldChipProps {
  field: Field
  zone: Zone
  index: number
  count: number
  onRemove: () => void
  onMove: (to: number) => void
  /** Optional display name (e.g. a measure alias) instead of the field label. */
  label?: string
  /** Optional second line under the name (e.g. the chosen display calculations). */
  note?: string
  /** Optional menu (e.g. measure configuration), shown before the remove button. */
  menu?: ReactNode
}

/** A field placed in a layout zone. Drag to reorder/move; Alt+←/→ reorders, Delete removes. */
export function FieldChip({ field, zone, index, count, onRemove, onMove, label, note, menu }: FieldChipProps) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onRemove()
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp') && index > 0) {
      e.preventDefault()
      onMove(index - 1)
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown') && index < count - 1) {
      e.preventDefault()
      onMove(index + 2)
    }
  }
  return (
    <div
      className={s.chip}
      draggable
      tabIndex={0}
      data-chip-index={index}
      onDragStart={(e) => {
        startFieldDrag(e, { fieldId: field.id, kind: field.kind, from: zone })
        e.currentTarget.classList.add(s.dragging!)
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove(s.dragging!)}
      onKeyDown={onKey}
      aria-label={tr('{0}, posisi {1} dari {2}', field.label, index + 1, count)}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Delete"
    >
      <GripVertical size={13} className={s.grip} aria-hidden />
      <span title={label && label !== field.label ? `${label} (${field.label})` : undefined}>
        {label || field.label}
        {note && <em className={s.note}>{note}</em>}
      </span>
      {field.unit && <small>{field.unit}</small>}
      {menu}
      <button type="button" className="chip-x" onClick={onRemove} aria-label={tr('Hapus {0}', field.label)}>
        <X size={12} />
      </button>
    </div>
  )
}
