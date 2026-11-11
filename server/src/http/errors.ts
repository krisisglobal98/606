/**
 * Application errors. `message` is shown to users and must never contain credentials, connection
 * strings, host names, SQL or stack traces. `diagnostic` is for server logs only (still secret-free).
 */
export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly diagnostic: string | null
  /** Optional structured detail sent to the client (e.g. per-field problems of a form); never secrets. */
  details: unknown = undefined
  constructor(status: number, code: string, message: string, diagnostic: string | null = null) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.diagnostic = diagnostic
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message)
export const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message)
export const forbidden = (message = 'Anda tidak memiliki akses untuk tindakan ini.') => new AppError(403, 'FORBIDDEN', message)
export const unauthenticated = (message = 'Sesi berakhir. Silakan masuk kembali.') => new AppError(401, 'UNAUTHENTICATED', message)

/** Error categories for an external data source, in business language. */
export type SourceErrorCode =
  | 'SOURCE_NOT_CONFIGURED'
  | 'SOURCE_DNS_FAILURE'
  | 'SOURCE_NETWORK_FAILURE'
  | 'SOURCE_AUTH_FAILED'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_PERMISSION_DENIED'
  | 'SOURCE_SCHEMA_UNAVAILABLE'
  | 'SOURCE_TABLE_UNAVAILABLE'
  | 'SOURCE_SSL_ERROR'
  | 'SOURCE_QUERY_FAILED'
  | 'SOURCE_READ_ONLY_VIOLATION'

const MESSAGES: Record<SourceErrorCode, string> = {
  SOURCE_NOT_CONFIGURED: 'Koneksi sumber data belum lengkap dikonfigurasi di server (misalnya password belum diset). Hubungi administrator.',
  SOURCE_DNS_FAILURE: 'Alamat server sumber data tidak dapat ditemukan. Periksa konfigurasi host atau DNS server DOD.',
  SOURCE_NETWORK_FAILURE: 'Server DOD tidak dapat menjangkau database sumber. Periksa jaringan, firewall, atau allowlist IP.',
  SOURCE_AUTH_FAILED: 'Database sumber menolak login akun DOD. Periksa username dan password di konfigurasi server.',
  SOURCE_UNAVAILABLE: 'Database sumber sedang tidak tersedia atau menolak koneksi baru. Coba lagi beberapa saat.',
  SOURCE_TIMEOUT: 'Query melebihi batas waktu dan dibatalkan. Persempit periode atau filter, lalu coba lagi.',
  SOURCE_PERMISSION_DENIED: 'Akun DOD tidak memiliki izin membaca objek ini di database sumber.',
  SOURCE_SCHEMA_UNAVAILABLE: 'Schema yang dikonfigurasi tidak ditemukan atau tidak dapat diakses di database sumber.',
  SOURCE_TABLE_UNAVAILABLE: 'Tabel sumber tidak ditemukan. Tabel mungkin sudah diganti nama atau dihapus.',
  SOURCE_SSL_ERROR: 'Koneksi terenkripsi (SSL) ke database sumber gagal. Periksa pengaturan SSL mode.',
  SOURCE_QUERY_FAILED: 'Query ke database sumber gagal dijalankan.',
  SOURCE_READ_ONLY_VIOLATION: 'DOD hanya membaca database sumber; perintah yang mengubah data ditolak.',
}

const STATUS: Partial<Record<SourceErrorCode, number>> = {
  SOURCE_TIMEOUT: 504,
  SOURCE_PERMISSION_DENIED: 403,
  SOURCE_TABLE_UNAVAILABLE: 404,
  SOURCE_SCHEMA_UNAVAILABLE: 404,
  SOURCE_READ_ONLY_VIOLATION: 400,
}

export const sourceError = (code: SourceErrorCode, diagnostic: string | null = null) => new AppError(STATUS[code] ?? 503, code, MESSAGES[code], diagnostic)

interface PgLikeError {
  code?: string
  errno?: number
  syscall?: string
  message?: string
  /** ClickHouse server error name, e.g. AUTHENTICATION_FAILED (@clickhouse/client ClickHouseError). */
  type?: string
  /** Error class name (MongoDB driver errors). */
  name?: string
  /** MongoDB server error name, e.g. AuthenticationFailed. */
  codeName?: string
}

/** MySQL (mysql2), MongoDB and Redis errors → source error categories. */
const MYSQL: Record<string, SourceErrorCode> = {
  ER_ACCESS_DENIED_ERROR: 'SOURCE_AUTH_FAILED',
  ER_ACCESS_DENIED_NO_PASSWORD_ERROR: 'SOURCE_AUTH_FAILED',
  ER_NOT_SUPPORTED_AUTH_MODE: 'SOURCE_AUTH_FAILED',
  ER_HOST_NOT_PRIVILEGED: 'SOURCE_AUTH_FAILED',
  ER_DBACCESS_DENIED_ERROR: 'SOURCE_PERMISSION_DENIED',
  ER_TABLEACCESS_DENIED_ERROR: 'SOURCE_PERMISSION_DENIED',
  ER_SPECIFIC_ACCESS_DENIED_ERROR: 'SOURCE_PERMISSION_DENIED',
  ER_BAD_DB_ERROR: 'SOURCE_SCHEMA_UNAVAILABLE',
  ER_NO_SUCH_TABLE: 'SOURCE_TABLE_UNAVAILABLE',
  ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION: 'SOURCE_READ_ONLY_VIOLATION',
  ER_QUERY_TIMEOUT: 'SOURCE_TIMEOUT',
  PROTOCOL_SEQUENCE_TIMEOUT: 'SOURCE_TIMEOUT',
  ER_CON_COUNT_ERROR: 'SOURCE_UNAVAILABLE',
  HANDSHAKE_SSL_ERROR: 'SOURCE_SSL_ERROR',
  HANDSHAKE_NO_SSL_SUPPORT: 'SOURCE_SSL_ERROR',
}
const MONGO: Record<string, SourceErrorCode> = {
  AuthenticationFailed: 'SOURCE_AUTH_FAILED',
  Unauthorized: 'SOURCE_PERMISSION_DENIED',
  MaxTimeMSExpired: 'SOURCE_TIMEOUT',
  NamespaceNotFound: 'SOURCE_TABLE_UNAVAILABLE',
}

/** ClickHouse server error names → source error categories. */
const CLICKHOUSE: Record<string, SourceErrorCode> = {
  AUTHENTICATION_FAILED: 'SOURCE_AUTH_FAILED',
  UNKNOWN_USER: 'SOURCE_AUTH_FAILED',
  WRONG_PASSWORD: 'SOURCE_AUTH_FAILED',
  REQUIRED_PASSWORD: 'SOURCE_AUTH_FAILED',
  IP_ADDRESS_NOT_ALLOWED: 'SOURCE_AUTH_FAILED',
  TIMEOUT_EXCEEDED: 'SOURCE_TIMEOUT',
  QUERY_WAS_CANCELLED: 'SOURCE_TIMEOUT',
  ACCESS_DENIED: 'SOURCE_PERMISSION_DENIED',
  NOT_ENOUGH_PRIVILEGES: 'SOURCE_PERMISSION_DENIED',
  UNKNOWN_DATABASE: 'SOURCE_SCHEMA_UNAVAILABLE',
  UNKNOWN_TABLE: 'SOURCE_TABLE_UNAVAILABLE',
  READONLY: 'SOURCE_READ_ONLY_VIOLATION',
  TOO_MANY_SIMULTANEOUS_QUERIES: 'SOURCE_UNAVAILABLE',
  MEMORY_LIMIT_EXCEEDED: 'SOURCE_UNAVAILABLE',
  ALL_CONNECTION_TRIES_FAILED: 'SOURCE_UNAVAILABLE',
}

/**
 * Maps a driver/network error to a business-readable source error. The diagnostic keeps only the
 * error code and class; driver messages are dropped because they can echo host names or user names.
 */
export function toSourceError(e: unknown): AppError {
  if (e instanceof AppError) return e
  const err = (e ?? {}) as PgLikeError
  const code = err.code ?? ''
  const msg = String(err.message ?? '')
  const diag = `${code || 'NO_CODE'}${err.type ? `/${err.type}` : ''}${err.syscall ? `/${err.syscall}` : ''}`
  if (err.type) return sourceError(CLICKHOUSE[err.type] ?? 'SOURCE_QUERY_FAILED', diag)
  if (MYSQL[code]) return sourceError(MYSQL[code], diag)
  if (err.codeName) return sourceError(MONGO[err.codeName] ?? 'SOURCE_QUERY_FAILED', `${diag}/${err.codeName}`)
  if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError' || err.name === 'MongoNetworkTimeoutError') {
    if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return sourceError('SOURCE_DNS_FAILURE', `${diag}/${err.name}`)
    if (/SSL|TLS|certificate/i.test(msg)) return sourceError('SOURCE_SSL_ERROR', `${diag}/${err.name}`)
    return sourceError('SOURCE_NETWORK_FAILURE', `${diag}/${err.name}`)
  }
  if (/^(WRONGPASS|NOAUTH)/.test(msg)) return sourceError('SOURCE_AUTH_FAILED', `${diag}/redis-auth`)
  if (/^NOPERM/.test(msg)) return sourceError('SOURCE_PERMISSION_DENIED', `${diag}/redis-noperm`)
  if (err.name === 'ConnectionTimeoutError' || err.name === 'SocketTimeoutError') return sourceError('SOURCE_NETWORK_FAILURE', `${diag}/${err.name}`)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return sourceError('SOURCE_DNS_FAILURE', diag)
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ENOENT'].includes(code)) return sourceError('SOURCE_NETWORK_FAILURE', diag)
  if (code === 'ETIMEDOUT' || /timeout expired|Connection terminated due to connection timeout/i.test(msg)) return sourceError('SOURCE_NETWORK_FAILURE', `${diag}/connect-timeout`)
  if (code === '28P01' || code === '28000') return sourceError('SOURCE_AUTH_FAILED', diag)
  if (code === '57014' || /Query read timeout|^Timeout error/i.test(msg)) return sourceError('SOURCE_TIMEOUT', diag)
  if (code === '42501') return sourceError('SOURCE_PERMISSION_DENIED', diag)
  if (code === '3F000') return sourceError('SOURCE_SCHEMA_UNAVAILABLE', diag)
  if (code === '42P01') return sourceError('SOURCE_TABLE_UNAVAILABLE', diag)
  if (code === '25006') return sourceError('SOURCE_READ_ONLY_VIOLATION', diag)
  if (['3D000', '57P01', '57P02', '57P03', '53300', '08001', '08004', '08006'].includes(code)) return sourceError('SOURCE_UNAVAILABLE', diag)
  if (/SSL|self[- ]signed|certificate/i.test(msg)) return sourceError('SOURCE_SSL_ERROR', `${diag}/ssl`)
  if (/Connection terminated unexpectedly/i.test(msg)) return sourceError('SOURCE_UNAVAILABLE', `${diag}/terminated`)
  return sourceError('SOURCE_QUERY_FAILED', diag)
}
