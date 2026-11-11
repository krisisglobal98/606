/**
 * Single HTTP boundary for the app: every call goes to the DOD API at VITE_API_BASE_URL.
 */
import type { z } from 'zod'
import { env } from '@/config/env'
import { beginLoading } from '@/stores/loadingStore'
import { ApiErrorBodySchema } from '@/types/contracts'
import { tr } from '@/i18n'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Structured detail from the server, e.g. per-field problems of a form. */
  readonly details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(tr(message)) // the server writes Indonesian; fixed messages have an English entry
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

let getToken: () => string | null = () => null
let onUnauthorized: () => void = () => {}

/** Wired once by the auth store, so the client never imports app state directly. */
export function configureApiClient(opts: { getToken: () => string | null; onUnauthorized: () => void }) {
  getToken = opts.getToken
  onUnauthorized = opts.onUnauthorized
}

interface RequestOptions<S extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Binary body (e.g. an uploaded file) sent as is, instead of `body` as JSON. */
  raw?: { data: Blob; type: string }
  query?: Record<string, string>
  schema?: S
  signal?: AbortSignal
  /** Skip the global 401 handler (used by the login call itself). */
  public?: boolean
  /** Background refresh (polling): no loading indicator. */
  silent?: boolean
  /** Text of the loading message while this call runs (default "Memuat data…"). */
  loadingLabel?: string
}

export async function request<S extends z.ZodType>(path: string, opts: RequestOptions<S> = {}): Promise<z.infer<S>> {
  const done = opts.silent ? null : beginLoading(opts.loadingLabel)
  try {
    return await send(path, opts)
  } finally {
    done?.()
  }
}

async function send<S extends z.ZodType>(path: string, opts: RequestOptions<S>): Promise<z.infer<S>> {
  const url = new URL(`${env.apiBaseUrl}${path}`, window.location.origin)
  if (opts.query) Object.entries(opts.query).forEach(([k, v]) => url.searchParams.set(k, v))
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.raw) headers['Content-Type'] = opts.raw.type
  else if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.raw ? opts.raw.data : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK_ERROR', tr('Tidak dapat terhubung ke server. Periksa koneksi Anda.'))
  }

  if (res.status === 204) return undefined as z.infer<S>
  const json: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const parsed = ApiErrorBodySchema.safeParse(json)
    const e = parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details)
      : new ApiError(res.status, 'HTTP_ERROR', tr('Permintaan gagal ({0}).', res.status))
    if (res.status === 401 && !opts.public) onUnauthorized()
    throw e
  }

  if (!opts.schema) return json as z.infer<S>
  const parsed = opts.schema.safeParse(json)
  if (!parsed.success) {
    console.error('[api] contract mismatch', path, parsed.error.issues)
    throw new ApiError(res.status, 'CONTRACT_MISMATCH', tr('Respons server tidak sesuai kontrak API.'))
  }
  return parsed.data
}

/** Typed JSON call for contracts defined as TS interfaces (Data Module); validation happens server-side. */
export function requestJson<T>(path: string, opts: Omit<RequestOptions<z.ZodType>, 'schema'> = {}): Promise<T> {
  return request(path, opts) as Promise<T>
}
