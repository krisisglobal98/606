import assert from 'node:assert/strict'
import { test } from 'node:test'
import { colName, crc32, sheetXml, workbook } from '@/utils/xlsx'

test('xlsx: column letters, CRC-32, merged header cells, numbers stay numbers, text escaped', () => {
  assert.deepEqual([colName(0), colName(25), colName(26), colName(27), colName(701), colName(702)], ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const x = sheetXml([[{ v: 'Sub Group', header: true, rowSpan: 2 }, { v: 'STATUS HARIAN UNIT', header: true, colSpan: 2 }, null], [null, { v: 'H.I', header: true }, { v: 'S.D.H.I', header: true }], [{ v: 'Dump Truck & <x>' }, { v: 29, decimals: 0 }, { v: 99.651, decimals: 2 }]], { freezeRows: 2, freezeCols: 1 })
  assert.match(x, /<mergeCell ref="A1:A2"\/>/)
  assert.match(x, /<mergeCell ref="B1:C1"\/>/)
  assert.match(x, /<c r="B3" s="\d+"><v>29<\/v><\/c>/)
  assert.match(x, /Dump Truck &amp; &lt;x&gt;/)
  assert.match(x, /ySplit="2"/)
  const z = workbook('Tabel Hasil', x)
  assert.deepEqual([...z.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'a ZIP file')
  assert.ok(new TextDecoder().decode(z).includes('xl/worksheets/sheet1.xml'))
})
