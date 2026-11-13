import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { en } from '../src/i18n/en.ts'
import { id } from '../src/i18n/id.ts'
import { tr } from '../src/i18n/index.ts'

const placeholders = (s: string) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort()

test('Indonesian is the default and fills placeholders', () => {
  assert.equal(tr('Simpan'), 'Simpan')
  assert.equal(tr('Baris {0}–{1}', 1, 20), 'Baris 1–20')
  assert.equal(tr('teks tanpa terjemahan'), 'teks tanpa terjemahan')
})

test('Indonesian wording replaces English terms and keeps placeholders', () => {
  assert.equal(tr('Report'), 'Laporan')
  assert.equal(tr('Settings'), 'Pengaturan')
  assert.equal(tr('Dataset "{0}" dihapus.', 'X'), 'Set data "X" dihapus.')
  for (const [source, text] of Object.entries(id)) assert.deepEqual(placeholders(text), placeholders(source), source)
})

test('every English entry keeps the placeholders of its Indonesian text', () => {
  for (const [id, text] of Object.entries(en)) assert.deepEqual(placeholders(text), placeholders(id), id)
})

// Strict (2026-11-13): every tr() text needs an English entry. A text that reads the same in English is recorded as
// such in en.ts ("Grand Total": "Grand Total"), so a forgotten translation can never pass as "probably English".
// (The earlier check only flagged texts with a few Indonesian words and let ~75 untranslated texts through.)
test('every tr() text in the code has an English entry', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : []
  })
  const missing = new Set<string>()
  for (const file of walk('src')) {
    if (file.includes(join('src', 'i18n'))) continue
    for (const m of readFileSync(file, 'utf8').matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)) {
      const key = m[1]!.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
      if (!(key in en) && /[A-Za-z]/.test(key)) missing.add(key)
    }
  }
  assert.deepEqual([...missing], [])
})
