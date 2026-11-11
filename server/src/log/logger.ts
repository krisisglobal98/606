/**
 * Structured logging (pino, via Fastify). Redaction is a safety net: code never passes secrets to
 * the logger in the first place, but any field that looks like one is censored anyway.
 */
import pino from 'pino'

export type Logger = pino.Logger

export const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'connectionString',
  '*.connectionString',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
]

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { app: 'dod-api' },
    ...(pretty ? {} : { timestamp: pino.stdTimeFunctions.isoTime }),
  })
}
