/**
 * Response compression: large JSON is sent br/gzip when asked, decodes to the identical body; small responses,
 * clients without Accept-Encoding, q=0 and /api/auth/* stay unencoded; Vary: Accept-Encoding on large responses.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import type { FastifyInstance } from 'fastify'
import { MIN_BYTES, pickEncoding } from '../src/http/compress.ts'
import { createServer } from '../src/http/server.ts'
import { createLogger } from '../src/log/logger.ts'

const big = { datasets: Array.from({ length: 400 }, (_, i) => ({ id: `ds-${i}`, label: `Dataset ${i}`, description: 'Produksi harian per blok dan afdeling' })) }

describe('response compression', () => {
  let app: FastifyInstance
  before(async () => {
    const config = { api: { trustedProxies: [], corsOrigin: null } } as never
    app = createServer(config, createLogger('silent', false), { userForToken: async () => ({ id: 'u', username: 'u', name: 'U', role: 'viewer' }) } as never)
    app.get('/api/big', async () => big)
    app.get('/api/small', async () => ({ ok: true }))
    app.get('/api/auth/big', async () => big)
    await app.ready()
  })
  after(() => app.close())
  const get = (url: string, enc?: string) => app.inject({ method: 'GET', url, headers: { authorization: 'Bearer x', ...(enc ? { 'accept-encoding': enc } : {}) } })

  test('brotli and gzip decode to the identical JSON; Vary is set', async () => {
    const plain = await get('/api/big')
    assert.ok(plain.rawPayload.length > MIN_BYTES)
    const b = await get('/api/big', 'gzip, deflate, br')
    assert.equal(b.headers['content-encoding'], 'br')
    assert.match(String(b.headers.vary), /Accept-Encoding/)
    assert.ok(b.rawPayload.length < plain.rawPayload.length / 5)
    assert.deepEqual(JSON.parse(brotliDecompressSync(b.rawPayload).toString()), big)
    const g = await get('/api/big', 'gzip')
    assert.equal(g.headers['content-encoding'], 'gzip')
    assert.deepEqual(JSON.parse(gunzipSync(g.rawPayload).toString()), big)
  })
  test('unencoded: no Accept-Encoding, small body, br;q=0 + gzip;q=0, /api/auth/*', async () => {
    const none = await get('/api/big')
    assert.equal(none.headers['content-encoding'], undefined)
    assert.deepEqual(none.json(), big)
    assert.equal((await get('/api/small', 'br')).headers['content-encoding'], undefined)
    assert.equal((await get('/api/big', 'br;q=0, gzip;q=0')).headers['content-encoding'], undefined)
    assert.equal((await get('/api/auth/big', 'br')).headers['content-encoding'], undefined)
  })
  test('errors still work (compressed only when large)', async () => {
    const r = await get('/api/missing', 'br')
    assert.equal(r.statusCode, 404)
    assert.equal(r.json().error.code, 'NOT_FOUND')
  })
  test('pickEncoding', () => {
    assert.equal(pickEncoding('gzip, br'), 'br')
    assert.equal(pickEncoding('gzip;q=1.0, br;q=0'), 'gzip')
    assert.equal(pickEncoding('identity'), null)
    assert.equal(pickEncoding(undefined), null)
  })
})
