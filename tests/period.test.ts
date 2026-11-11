/**
 * Default report period (Analisis and saved reports): first day of the current month up to the day the report is
 * opened, on the local calendar (the tests build dates with local-time constructors, so they hold in any time zone).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isMonthToDate, monthToDate } from '../src/stores/period.ts'

test('month to date: first of the month up to today', () => {
  assert.deepEqual(monthToDate(new Date(2026, 10, 11, 14, 30)), { dateFrom: '2026-11-01', dateTo: '2026-11-11' })
})

test('the first day of the month is a one-day period', () => {
  assert.deepEqual(monthToDate(new Date(2026, 11, 1, 0, 5)), { dateFrom: '2026-12-01', dateTo: '2026-12-01' })
})

test('local calendar date, not UTC (early morning and late evening)', () => {
  // 06:00 local is still the previous day in UTC for UTC+7; 23:59 local may already be the next day in UTC-x.
  assert.deepEqual(monthToDate(new Date(2027, 0, 1, 6, 0)), { dateFrom: '2027-01-01', dateTo: '2027-01-01' })
  assert.deepEqual(monthToDate(new Date(2026, 11, 31, 23, 59)), { dateFrom: '2026-12-01', dateTo: '2026-12-31' })
})

test('zero-padded month and day', () => {
  assert.deepEqual(monthToDate(new Date(2026, 1, 5, 9)), { dateFrom: '2026-02-01', dateTo: '2026-02-05' })
})

test('isMonthToDate: only the current month-to-date period', () => {
  const now = new Date(2026, 10, 11, 8)
  assert.equal(isMonthToDate({ dateFrom: '2026-11-01', dateTo: '2026-11-11' }, now), true)
  assert.equal(isMonthToDate({ dateFrom: '2026-11-01', dateTo: '2026-11-10' }, now), false) // yesterday's default
  assert.equal(isMonthToDate({ dateFrom: '2026-01-01', dateTo: '2026-10-31' }, now), false) // a chosen period
})
