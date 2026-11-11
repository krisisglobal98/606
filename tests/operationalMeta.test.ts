import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ALL, categoryTree, NONE, reportsIn, reportTree } from '../src/pages/report/Operational/operationalMeta.ts'

const categories = [
  { id: 'a', name: 'Panen', parentId: null },
  { id: 'a1', name: 'Hasil', parentId: 'a' },
  { id: 'a2', name: 'Kosong', parentId: 'a' },
  { id: 'b', name: 'Tanpa laporan', parentId: null },
]
const reports = [{ categoryId: 'a' }, { categoryId: 'a1' }, { categoryId: 'a1' }, { categoryId: null }]

describe('Laporan Operasional categories', () => {
  test('the tree counts sub-categories into their parent and leaves out empty categories', () => {
    assert.deepEqual(categoryTree(categories, reports), [{ id: 'a', name: 'Panen', count: 3, subs: [{ id: 'a1', name: 'Hasil', count: 2 }] }])
  })
  test('a selected category includes its sub-categories; a sub-category only itself', () => {
    assert.equal(reportsIn('a', categories, reports).length, 3)
    assert.equal(reportsIn('a1', categories, reports).length, 2)
    assert.equal(reportsIn(ALL, categories, reports).length, 4)
    assert.deepEqual(reportsIn(NONE, categories, reports), [{ categoryId: null }])
  })
  const named = [
    { categoryId: 'a', name: 'Rekap panen', datasetName: 'Panen' },
    { categoryId: 'a1', name: 'Potong buah', datasetName: 'Produksi' },
    { categoryId: 'a1', name: 'Restan', datasetName: 'Produksi' },
    { categoryId: null, name: 'Lama', datasetName: null },
    { categoryId: 'x', name: 'Kategori dihapus', datasetName: 'Alat' },
  ]
  test('the sidebar lists category → sub-category → reports, with the unplaced ones last', () => {
    const t = reportTree(categories, named, '', 'Tanpa kategori')
    assert.deepEqual(t.map((g) => [g.id, g.count, g.reports.map((r) => r.name), g.subs.map((x) => [x.id, x.reports.length])]), [
      ['a', 3, ['Rekap panen'], [['a1', 2]]],
      [NONE, 2, ['Lama', 'Kategori dihapus'], []],
    ])
    assert.equal(t[1]!.name, 'Tanpa kategori')
  })
  test('the search narrows by report or dataset name and drops empty groups', () => {
    assert.deepEqual(reportTree(categories, named, 'produksi').map((g) => [g.id, g.count]), [['a', 2]])
    assert.deepEqual(reportTree(categories, named, 'ALAT').map((g) => g.id), [NONE])
    assert.deepEqual(reportTree(categories, named, 'zzz'), [])
  })
})
