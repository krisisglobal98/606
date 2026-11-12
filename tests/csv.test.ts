/** CSV text cells: quoting, and no spreadsheet formula from data or user-typed names (src/utils/csv.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvCell } from '../src/utils/csv.ts'

test('plain text is quoted; quotes are doubled; commas and line breaks stay inside the cell', () => {
  assert.equal(csvCell('SAM-1'), '"SAM-1"')
  assert.equal(csvCell('Kebun "A", Riau'), '"Kebun ""A"", Riau"')
  assert.equal(csvCell('baris 1\nbaris 2'), '"baris 1\nbaris 2"')
  assert.equal(csvCell(''), '""')
})

test('text a spreadsheet would run as a formula gets a leading apostrophe', () => {
  for (const v of ['=1+1', '=HYPERLINK("http://x","klik")', '+62812', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '=cmd|\' /C calc\'!A0'])
    assert.ok(csvCell(v).startsWith('"\''), v)
  assert.equal(csvCell('=HYPERLINK("http://x","klik")'), '"\'=HYPERLINK(""http://x"",""klik"")"')
})

test('ordinary values that only contain those characters later are left alone', () => {
  for (const v of ['AFDELING-03', 'A=B', 'a@b.co', 'Rayon A + B', '2026-01'])
    assert.equal(csvCell(v), `"${v}"`)
})
