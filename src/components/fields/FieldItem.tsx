import { CalendarDays, Check, GripVertical, Hash, Type } from 'lucide-react'
import type { Field } from '@/types/contracts'
import { startFieldDrag } from './dnd'
import s from './fields.module.css'
import { tr } from '@/i18n'

interface FieldItemProps {
  field: Field
  used: boolean
  onToggle: () => void
}

/** Field List entry: draggable into a zone, or click / Enter to add & remove. */
export function FieldItem({ field, used, onToggle }: FieldItemProps) {
  const Icon = field.kind === 'measure' ? Hash : field.dataType === 'date' ? CalendarDays : Type
  return (
    <button
      type="button"
      className={`${s.item}${used ? ` ${s.used}` : ''}`}
      draggable
      onDragStart={(e) => startFieldDrag(e, { fieldId: field.id, kind: field.kind, from: 'list' })}
      onClick={onToggle}
      aria-pressed={used}
      title={tr('{0}. Tarik ke area {1}, atau klik untuk {2}.', tr(field.description ?? field.label).replace(/^Kolom: /, tr('Kolom: ')).replace(/ dari /, tr(' dari ')), field.kind === 'measure' ? tr('Measure') : tr('Dimensi'), used ? tr('menghapus') : tr('menambahkan'))}
    >
      <GripVertical size={13} className={s.grip} aria-hidden />
      <Icon size={13} className={s.type} aria-hidden />
      <span className={s.name}>{field.label}</span>
      {field.unit && <span className={s.unit}>{field.unit}</span>}
      {used && <Check size={13} className={s.check} aria-label={tr('dipakai')} />}
    </button>
  )
}
