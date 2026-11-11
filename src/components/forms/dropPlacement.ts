/** Room a popover needs: search, list (260px) and the footer. */
const NEEDED = 340

/**
 * Whether a popover under `el` should open upward: when the room below it, inside the nearest scrolling box (a modal
 * body, a card) or the window, is too small and there is more room above.
 */
export function opensUp(el: HTMLElement | null): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  let top = 0
  let bottom = window.innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll' || o === 'hidden') {
      const b = p.getBoundingClientRect()
      top = Math.max(top, b.top)
      bottom = Math.min(bottom, b.bottom)
      break
    }
  }
  const below = bottom - r.bottom
  const above = r.top - top
  return below < NEEDED && above > below
}
