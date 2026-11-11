/**
 * Measure part of the Analysis Layout: the order of measures and optional user-defined Measure Groups.
 * Pure functions (no state), used by the analysis store. This is the only place the column structure
 * of Tabel Hasil comes from; the table header is regenerated from it.
 *
 *   [ {measure produksi}, {group "Operational": [luas, cost]}, {measure target} ]
 *
 * Without groups every block is a plain measure → a flat header (raw dataset presentation).
 */
export type MeasureBlock = { kind: 'measure'; id: string } | { kind: 'group'; id: string; name: string; measures: string[] }

export const fromMeasures = (ids: string[]): MeasureBlock[] => ids.map((id) => ({ kind: 'measure', id }))

export function flatten(blocks: MeasureBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === 'measure' ? [b.id] : b.measures))
}

export function removeMeasure(blocks: MeasureBlock[], id: string): MeasureBlock[] {
  return blocks.filter((b) => !(b.kind === 'measure' && b.id === id)).map((b) => (b.kind === 'group' ? { ...b, measures: b.measures.filter((m) => m !== id) } : b))
}

/**
 * Puts a measure into a container: the top level (group = null; index counts top-level blocks) or a
 * group (index counts that group's measures). It is removed from wherever it was first.
 */
export function placeMeasure(blocks: MeasureBlock[], id: string, group: string | null, index?: number): MeasureBlock[] {
  // Index positions refer to the layout before removal; adjust when moving forward in the same container.
  const before = locate(blocks, id)
  let at = index
  if (at != null && before && before.group === group && before.index < at) at -= 1
  const rest = removeMeasure(blocks, id)
  if (group == null) {
    const i = Math.max(0, Math.min(at ?? rest.length, rest.length))
    return [...rest.slice(0, i), { kind: 'measure', id }, ...rest.slice(i)]
  }
  return rest.map((b) => {
    if (b.kind !== 'group' || b.id !== group) return b
    const i = Math.max(0, Math.min(at ?? b.measures.length, b.measures.length))
    return { ...b, measures: [...b.measures.slice(0, i), id, ...b.measures.slice(i)] }
  })
}

/** Where a measure sits: its container and index in it. */
export function locate(blocks: MeasureBlock[], id: string): { group: string | null; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    if (b.kind === 'measure' && b.id === id) return { group: null, index: i }
    if (b.kind === 'group') {
      const j = b.measures.indexOf(id)
      if (j >= 0) return { group: b.id, index: j }
    }
  }
  return null
}

export function addGroup(blocks: MeasureBlock[], id: string, name: string): MeasureBlock[] {
  return [...blocks, { kind: 'group', id, name, measures: [] }]
}

export function renameGroup(blocks: MeasureBlock[], id: string, name: string): MeasureBlock[] {
  return blocks.map((b) => (b.kind === 'group' && b.id === id ? { ...b, name } : b))
}

/** Deleting a group keeps its measures: they return to the top level at the group's position. */
export function removeGroup(blocks: MeasureBlock[], id: string): MeasureBlock[] {
  return blocks.flatMap((b) => (b.kind === 'group' && b.id === id ? fromMeasures(b.measures) : [b]))
}

/** Reorders a top-level block (a group or an ungrouped measure) by its id. */
export function moveBlock(blocks: MeasureBlock[], id: string, to: number): MeasureBlock[] {
  const from = blocks.findIndex((b) => b.id === id)
  if (from < 0) return blocks
  const next = blocks.filter((_, i) => i !== from)
  const at = Math.max(0, Math.min(from < to ? to - 1 : to, next.length))
  return [...next.slice(0, at), blocks[from]!, ...next.slice(at)]
}

/** Drops ids that are not valid measures of the current dataset (render-time view, not a mutation). */
export function sanitize(blocks: MeasureBlock[], valid: (id: string) => boolean): MeasureBlock[] {
  return blocks.flatMap((b): MeasureBlock[] => (b.kind === 'measure' ? (valid(b.id) ? [b] : []) : [{ ...b, measures: b.measures.filter(valid) }]))
}
