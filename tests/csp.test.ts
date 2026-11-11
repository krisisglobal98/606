/**
 * Web server configuration of the SPA: the Content-Security-Policy of IIS (public/web.config) is the one
 * `vite preview` sends too, stays strict for scripts, and the app needs no inline or eval'd script; the IIS
 * rules keep /api away from the SPA fallback.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const webConfig = read('public/web.config')
const iisCsp = /name="Content-Security-Policy" value="([^"]+)"/.exec(webConfig)?.[1] ?? ''
const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

describe('Content-Security-Policy', () => {
  test('IIS defines the policy', () => {
    assert.ok(iisCsp, 'public/web.config sends Content-Security-Policy')
  })

  test('scripts only from the app itself: no inline, no eval', () => {
    assert.equal(directive(iisCsp, 'script-src'), "script-src 'self'")
    assert.doesNotMatch(iisCsp, /unsafe-eval|wasm-unsafe-eval|strict-dynamic/)
    for (const d of ['object-src', 'base-uri', 'frame-ancestors', 'connect-src']) assert.ok(directive(iisCsp, d), `${d} is set`)
    assert.equal(directive(iisCsp, 'object-src'), "object-src 'none'")
    // The browser calls only the DOD API on its own origin (no third-party API since the map module was removed).
    assert.equal(directive(iisCsp, 'connect-src'), "connect-src 'self'")
  })

  test('index.html has no inline script, and the app opts out of Zod eval before anything else', () => {
    const html = read('index.html')
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.match(tag, /\bsrc="/, tag)
    assert.match(read('src/main.tsx'), /^import '@\/config\/zod'/)
    assert.match(read('src/config/zod.ts'), /jitless: true/)
  })

  test('vite preview reads the policy from public/web.config', () => {
    const vite = read('vite.config.ts')
    assert.match(vite, /public\/web\.config/)
    assert.match(vite, /preview: \{[^}]*\bproxy, headers \}/)
  })
})

describe('IIS rewrite rules', () => {
  test('the API proxy comes first and stops processing; the SPA fallback skips /api and /assets', () => {
    const api = webConfig.indexOf('name="DOD API Reverse Proxy" stopProcessing="true"')
    const spa = webConfig.indexOf('name="DOD SPA fallback"')
    assert.ok(api > 0 && spa > api)
    const rule = webConfig.slice(spa, webConfig.indexOf('</rule>', spa))
    assert.match(rule, /matchType="IsFile" negate="true"/)
    assert.match(rule, /matchType="IsDirectory" negate="true"/)
    assert.match(rule, /pattern="\^\/\(api\|assets\)\/" negate="true"/)
    assert.match(rule, /url="\/index\.html"/)
  })
})

describe('reverse proxy configuration', () => {
  test('.env.example names no trusted proxy by default and has no trust-every-hop switch', () => {
    const env = read('.env.example')
    assert.match(env, /^DOD_TRUSTED_PROXIES=$/m)
    assert.doesNotMatch(env, /^DOD_API_TRUST_PROXY=/m)
  })
})
