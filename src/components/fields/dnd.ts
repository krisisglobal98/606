/**
 * Native HTML5 drag & drop for fields (no dependency). The payload travels in dataTransfer;
 * the field kind is also encoded in a MIME type so drop zones can accept/reject during dragover,
 * when the payload itself is not readable.
 */
import type { DragEvent } from 'react'
import type { FieldKind } from '@/types/contracts'
import type { Zone } from '@/stores/analysisStore'

const MIME = 'application/x-dod-field'
const kindMime = (k: FieldKind) => `application/x-dod-kind-${k}`

export interface DragPayload {
  fieldId: string
  kind: FieldKind
  from: Zone | 'list'
}

export function startFieldDrag(e: DragEvent, p: DragPayload) {
  e.dataTransfer.setData(MIME, JSON.stringify(p))
  e.dataTransfer.setData(kindMime(p.kind), '')
  e.dataTransfer.setData(`application/x-dod-from-${p.from}`, '')
  e.dataTransfer.setData('text/plain', p.fieldId)
  e.dataTransfer.effectAllowed = 'move'
}

export const dragHasKind = (e: DragEvent, k: FieldKind) => e.dataTransfer.types.includes(kindMime(k))
export const dragFromZone = (e: DragEvent) => e.dataTransfer.types.some((t) => t === 'application/x-dod-from-dimensions' || t === 'application/x-dod-from-measures')

export function readFieldDrag(e: DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(MIME)
    return raw ? (JSON.parse(raw) as DragPayload) : null
  } catch {
    return null
  }
}
