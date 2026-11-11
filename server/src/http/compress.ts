/**
 * Response compression for large JSON (catalog ±370 KB → ±25 KB, analytics results, grids), without a dependency.
 *
 * Only when the client asks for it (Accept-Encoding: br or gzip), only JSON, only from `MIN_BYTES`, never for
 * /api/auth/* (tokens), and never when an encoding is already set. Brotli at a fast quality, else gzip. A reverse
 * proxy (IIS ARR, vite preview) passes the encoded body and the headers through unchanged.
 */
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import type { FastifyInstance } from 'fastify'

export const MIN_BYTES = 8 * 1024
const br = promisify(brotliCompress)
const gz = promisify(gzip)

/** The encoding to use for an Accept-Encoding header (q=0 means "not acceptable"). */
export function pickEncoding(accept: string | undefined): 'br' | 'gzip' | null {
  const ok = new Set<string>()
  for (const part of (accept ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    if (name && !(q && Number(q.slice(2)) === 0)) ok.add(name.trim())
  }
  return ok.has('br') ? 'br' : ok.has('gzip') ? 'gzip' : null
}

export function registerCompression(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload
    if (reply.getHeader('content-encoding') || req.url.startsWith('/api/auth/')) return payload
    if (!String(reply.getHeader('content-type') ?? '').includes('application/json')) return payload
    const body = typeof payload === 'string' ? Buffer.from(payload) : payload
    // Responses of this size may vary by Accept-Encoding: caches/proxies must know (even when sent unencoded).
    if (body.length < MIN_BYTES) return payload
    const vary = String(reply.getHeader('vary') ?? '')
    reply.header('Vary', vary ? (/accept-encoding/i.test(vary) ? vary : `${vary}, Accept-Encoding`) : 'Accept-Encoding')
    const enc = pickEncoding(req.headers['accept-encoding'])
    if (!enc) return payload
    const out = enc === 'br'
      ? await br(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
      : await gz(body, { level: 6 })
    reply.header('Content-Encoding', enc)
    reply.removeHeader('content-length')
    return out
  })
}
