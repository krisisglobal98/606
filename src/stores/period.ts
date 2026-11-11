/**
 * Default report period: the first day of the current month up to the day the report is opened (month to date).
 * Dates are the browser's local calendar date (WIB for the users), not UTC: at 06:00 WIB it is already "today".
 * Pure (no store, no env), so it is unit-tested directly.
 */
export interface Period {
  dateFrom: string
  dateTo: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function monthToDate(now: Date = new Date()): Period {
  return { dateFrom: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, dateTo: ymd(now) }
}

/** True when the filter's period is the month-to-date period of `now`. */
export function isMonthToDate(p: Period, now: Date = new Date()): boolean {
  const m = monthToDate(now)
  return p.dateFrom === m.dateFrom && p.dateTo === m.dateTo
}
