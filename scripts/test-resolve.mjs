import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = new URL('../src/', import.meta.url)

export async function resolve(specifier, context, next) {
  let s = specifier
  if (s.startsWith('@/')) s = new URL(s.slice(2), src).href
  const relative = s.startsWith('.') || s.startsWith('file:')
  if (relative && !/\.[cm]?[jt]sx?$/.test(s)) {
    const base = s.startsWith('file:') ? s : new URL(s, context.parentURL).href
    for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(fileURLToPath(base + ext))) return next(base + ext, context)
  }
  return next(s, context)
}
