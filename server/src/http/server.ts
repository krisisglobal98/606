/** Fastify instance: logging with redaction, auth, error mapping and per-request abort signals. */
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import type { Config } from '../config/config.ts'
import type { Logger } from '../log/logger.ts'
import type { AuthService, Role, User } from '../auth/authService.ts'
import { registerCompression } from './compress.ts'
import { AppError, forbidden } from './errors.ts'

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null
    /** Aborted when the client goes away, so running source queries get cancelled. */
    abort: AbortSignal
  }
}

// (The Dashboard Generator share link was removed with the module; no data path is public.)
const PUBLIC = [/^\/api\/auth\/login$/, /^\/api\/health(\/|$)/]
/** Public paths that show more detail to a signed-in user (an invalid token is treated as anonymous). */
const OPTIONAL_AUTH = /^\/api\/health\/datawarehouse$/

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() || null : null
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): User {
  const u = req.user
  if (!u) throw new AppError(401, 'UNAUTHENTICATED', 'Sesi berakhir. Silakan masuk kembali.')
  if (roles.length && !roles.includes(u.role)) throw forbidden()
  return u
}

export function createServer(config: Config, log: Logger, auth: AuthService): FastifyInstance {
  const app = Fastify({
    loggerInstance: log as FastifyBaseLogger,
    // Follow X-Forwarded-For only through the configured reverse proxies (never `true`: that trusts any client).
    trustProxy: config.api.trustedProxies.length ? config.api.trustedProxies : false,
    bodyLimit: 512 * 1024,
    requestIdHeader: 'x-request-id',
  })

  app.decorateRequest('user', null)
  app.decorateRequest('abort', null as unknown as AbortSignal)

  app.addHook('onRequest', async (req, reply) => {
    const ctl = new AbortController()
    req.abort = ctl.signal
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) ctl.abort()
    })
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    if (config.api.corsOrigin) {
      reply.header('Access-Control-Allow-Origin', config.api.corsOrigin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
      if (req.method === 'OPTIONS') return reply.code(204).send()
    }
    const path = req.url.split('?')[0] ?? ''
    if (PUBLIC.some((r) => r.test(path))) {
      const token = bearer(req)
      if (token && OPTIONAL_AUTH.test(path)) req.user = await auth.userForToken(token).catch(() => null)
      return
    }
    req.user = await auth.userForToken(bearer(req))
  })

  registerCompression(app)

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.warn({ code: err.code, diagnostic: err.diagnostic }, 'request failed')
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } })
    }
    if (err instanceof ZodError) {
      const msg = err.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: `Permintaan tidak valid. ${msg}` } })
    }
    const e = err as { statusCode?: number; code?: string; name?: string }
    if (e.name === 'AbortError') return reply.code(499).send({ error: { code: 'CLIENT_ABORTED', message: 'Permintaan dibatalkan.' } })
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: 'Permintaan tidak valid.' } })
    // Unknown failure: full detail goes to the log only, never to the client.
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan di server DOD. Coba lagi atau hubungi administrator.' } })
  })

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } }))
  return app
}
