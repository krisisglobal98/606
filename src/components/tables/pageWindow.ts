/** Page numbers around the current one, with the first and last always shown and gaps as null (at most 7 entries). */
export function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const from = Math.max(2, Math.min(page - 1, pages - 4))
  const to = Math.min(pages - 1, Math.max(page + 1, 5))
  const mid = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  return [1, ...(from > 2 ? [null] : []), ...mid, ...(to < pages - 1 ? [null] : []), pages]
}
