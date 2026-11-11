/**
 * Server configuration, read once from the environment.
 *
 * Secrets (database passwords, the initial admin password) are only ever read here, on the server.
 * They are never returned by the API, written to logs, or stored in DOD's metadata database:
 * a connection record only stores the *name* of the environment variable that holds its password.
 */
import { readFileSync } from 'node:fs'
import { isIPv4 } from 'node:net'
import { z } from 'zod'
import { normalizeIp } from '../http/clientIp.ts'

export type SslMode = 'disable' | 'require' | 'verify-full'
export type SourceDbType = 'postgresql' | 'clickhouse' | 'mysql' | 'mongodb' | 'redis'
export const SOURCE_DB_TYPES = ['postgresql', 'clickhouse', 'mysql', 'mongodb', 'redis'] as const satisfies readonly SourceDbType[]
/** Source types DOD can build datasets and analytics on (SQL with GROUPING SETS). Others: connect, test, browse. */
export const ANALYTIC_DB_TYPES: ReadonlySet<SourceDbType> = new Set(['postgresql', 'clickhouse'])
/** Default port per type (ClickHouse: HTTP interface). */
export function defaultPort(t: SourceDbType, protocol: 'http' | 'https' = 'http'): number {
  return { postgresql: 5432, clickhouse: protocol === 'https' ? 8443 : 8123, mysql: 3306, mongodb: 27017, redis: 6379 }[t]
}
export interface PoolConfig { min: number; max: number; idleTimeoutMs: number }

export interface SourceConnectionConfig {
  /** Stable id derived from the env prefix, e.g. DEV → "dev"; "mc-…" for connections added in the UI. */
  id: string
  /** Always "env": DOD Minimal takes connections only from the server environment. */
  origin: 'env'
  name: string
  dbType: SourceDbType
  environment: string
  host: string
  port: number
  database: string
  username: string
  /** Name of the environment variable holding the password (never the password itself). */
  passwordSecret: string
  /** MongoDB authentication database (default "admin"). */
  authSource: string | null
  /** PostgreSQL schema; for ClickHouse the database (ClickHouse has no schema level). */
  schema: string
  /** PostgreSQL SSL mode; for ClickHouse derived from the protocol (http → disable, https → require). */
  sslMode: SslMode
  /** ClickHouse HTTP interface protocol (unused for PostgreSQL). */
  protocol: 'http' | 'https'
  /** CA bundle for verify-full; read from a file path. */
  sslRootCert: string | null
  connectTimeoutMs: number
  commandTimeoutMs: number
  /** Per-connection pool (DOD_DW_<P>_POOL_*), falling back to the global DOD_DW_POOL_*. */
  pool: PoolConfig
}

export interface Config {
  env: 'development' | 'production' | 'test'
  /** trustedProxies: reverse proxies whose X-Forwarded-For is followed (IP/CIDR); empty = none, use the TCP peer. */
  api: { host: string; port: number; corsOrigin: string | null; trustedProxies: string[] }
  logLevel: string
  /** The DOD application database (dor_application): the one database server of the app, set only by DOD_DB_* in .env. */
  metadataDb: { host: string; port: number; database: string; user: string; password: string; ssl: boolean; poolMax: number }
  /** Organization master source (dor_apims_master), read-only, on the application database's server and account; null = sync off. */
  orgMaster: { database: string } | null
  auth: {
    sessionHours: number
    adminUsername: string
    adminPassword: string | null
    adminName: string
    /** Failed sign-ins allowed per window (see auth/loginLimiter.ts). */
    loginLimit: { windowMs: number; maxPerUser: number; maxPerIp: number; maxKeys: number }
  }
  pool: PoolConfig
  limits: {
    analyticsTimeoutMs: number
    metadataTimeoutMs: number
    resultDefaultLimit: number
    resultMaxLimit: number
    exportMaxRows: number
    distinctValuesMax: number
    /** Lifetime of cached aggregated results (Analisis, reports), per dataset version and access scope; 0 = off. */
    resultCacheMs: number
  }
  /** Source connections, only from .env (DOD_DW_CONNECTIONS + DOD_DW_<PREFIX>_*). */
  connections: SourceConnectionConfig[]
  /** Prefixes in DOD_DW_CONNECTIONS without any DOD_DW_<PREFIX>_* variable (ignored, logged at start). */
  skippedConnections: string[]
  /**
   * Production budget per block for Analisis → Data Profil → Profil Blok (DOD_PRODUCTION_DB, e.g. DO_PIMS_REPORT): a
   * database on the same server and account as the application database, read in a read-only session. null = the
   * budget column of that tab stays empty.
   */
  production: { database: string } | null
  /**
   * Organization reference (dor_apims_master) for data access scope, read with its own read-only role
   * (DOD_ORG_DB_*; docs/DATA_ACCESS.md). null = not configured: no scoped user gets data.
   */
  orgDb: { host: string; port: number; database: string; user: string; password: string; ssl: boolean } | null
  /** Data access control (docs/DATA_ACCESS.md). Lists are lower-case usernames / numeric PIMS ids. */
  dataAccess: {
    /** Fixed lifetime of the organization snapshot (never extended); expired + unreachable master = 503. */
    cacheMs: number
    /** Source of level Region (K-04); null = level Region cannot be resolved. */
    regionSource: 'ms_region' | 'so_region' | null
    /** Approved ms_so_node ids of level Wilayah Administrasi (K-03). */
    wilayahNodeIds: string[]
    /** Approved ms_gmk_header ids of level GMK (K-05). */
    gmkHeaderIds: string[]
    /** Holders of unrestricted_data (K-10a): unrestricted data access, independent of role. */
    unrestrictedUsers: string[]
    /** Data access managers: may change other users' assignments (never their own). */
    managers: string[]
  }
}

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).default(def)
const str = (def: string) => z.string().trim().default(def)
const optInt0 = (min: number, max: number) => z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(min).max(max).optional())
/** Comma-separated numeric PIMS ids (snowflake); spaces allowed. */
const idList = (name: string) =>
  z.string().default('').transform((s, ctx) => {
    const ids = s.split(',').map((x) => x.trim()).filter(Boolean)
    if (ids.some((x) => !/^\d{1,20}$/.test(x))) ctx.addIssue({ code: 'custom', message: `${name}: daftar id angka dipisah koma` })
    return [...new Set(ids)]
  })
/** Comma-separated DOD usernames (case-insensitive). */
const userList = (name: string) =>
  z.string().default('').transform((s, ctx) => {
    const us = s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
    if (us.some((x) => !/^[a-z0-9._@-]{3,64}$/.test(x))) ctx.addIssue({ code: 'custom', message: `${name}: daftar username dipisah koma` })
    return [...new Set(us)]
  })

const Base = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DOD_API_HOST: str('127.0.0.1'),
  // DOD Minimal's API port (8181) differs from the full DOD installation (8080/8090) so both run side by side.
  DOD_API_PORT: int(8181, 1, 65535),
  DOD_API_CORS_ORIGIN: z.string().trim().optional(),
  DOD_TRUSTED_PROXIES: str(''),
  /** Replaced by DOD_TRUSTED_PROXIES; only an empty value or `false` is still accepted. */
  DOD_API_TRUST_PROXY: z.string().trim().optional(),
  DOD_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // No defaults: an empty value never falls back to a local database (requireAppDb refuses to start).
  DOD_DB_HOST: str(''),
  DOD_DB_PORT: int(5432, 1, 65535),
  DOD_DB_NAME: str(''),
  DOD_DB_USER: str(''),
  DOD_DB_PASSWORD: z.string().default(''),
  DOD_DB_SSL: z.enum(['true', 'false']).default('false'),
  DOD_DB_POOL_MAX: int(5, 1, 50),
  DOD_DB_MASTER_NAME: str(''),

  DOD_SESSION_HOURS: int(8, 1, 24 * 14),
  DOD_ADMIN_USERNAME: str('admin'),
  DOD_ADMIN_NAME: str('Administrator DOD'),
  DOD_ADMIN_PASSWORD: z.string().optional(),
  DOD_LOGIN_MAX_ATTEMPTS: int(5, 1, 100),
  DOD_LOGIN_MAX_ATTEMPTS_PER_IP: int(20, 1, 1_000),
  DOD_LOGIN_WINDOW_MINUTES: int(15, 1, 24 * 60),
  DOD_LOGIN_MAX_TRACKED: int(10_000, 100, 1_000_000),

  DOD_DW_CONNECTIONS: str(''),
  DOD_DW_POOL_MIN: int(0, 0, 20),
  DOD_DW_POOL_MAX: int(8, 1, 50),
  DOD_DW_POOL_IDLE_MS: int(30_000, 1_000),

  DOD_QUERY_TIMEOUT_MS: int(30_000, 1_000, 600_000),
  DOD_METADATA_TIMEOUT_MS: int(15_000, 1_000, 120_000),
  DOD_RESULT_DEFAULT_LIMIT: int(3_000, 1, 100_000),
  DOD_RESULT_MAX_LIMIT: int(20_000, 1, 200_000),
  DOD_EXPORT_MAX_ROWS: int(50_000, 1, 1_000_000),
  DOD_DISTINCT_VALUES_MAX: int(500, 10, 5_000),
  DOD_RESULT_CACHE_SECONDS: int(300, 0, 3_600),

  DOD_PRODUCTION_DB: z.string().trim().regex(/^$|^[A-Za-z0-9_]{1,63}$/, 'DOD_PRODUCTION_DB: nama database (huruf, angka, _)').default(''),
  /** Earlier name of DOD_PRODUCTION_DB (from the removed GIS module); still read when DOD_PRODUCTION_DB is empty. */
  DOD_GIS_PRODUCTION_DB: z.string().trim().regex(/^$|^[A-Za-z0-9_]{1,63}$/, 'DOD_GIS_PRODUCTION_DB: nama database (huruf, angka, _)').default(''),

  // Organization reference for data access scope: a dedicated read-only role (never the app account or a superuser).
  DOD_ORG_DB_HOST: z.string().trim().regex(/^[A-Za-z0-9.\-_:[\]/]*$/, 'DOD_ORG_DB_HOST hanya berisi nama host atau alamat IP').default(''),
  DOD_ORG_DB_PORT: optInt0(1, 65535),
  DOD_ORG_DB_NAME: z.string().trim().regex(/^$|^[A-Za-z0-9_]{1,63}$/, 'DOD_ORG_DB_NAME: nama database (huruf, angka, _)').default(''),
  DOD_ORG_DB_USER: z.string().trim().regex(/^$|^[A-Za-z0-9_]{1,63}$/, 'DOD_ORG_DB_USER: nama role (huruf, angka, _)').default(''),
  DOD_ORG_DB_PASSWORD: z.string().default(''),
  DOD_ORG_DB_SSL: z.enum(['', 'true', 'false']).default(''),
  DOD_ORG_CACHE_SECONDS: int(300, 0, 300),
  DOD_ORG_REGION_SOURCE: z.enum(['', 'ms_region', 'so_region']).default(''),
  DOD_ORG_WILAYAH_NODE_IDS: idList('DOD_ORG_WILAYAH_NODE_IDS'),
  DOD_ORG_GMK_HEADER_IDS: idList('DOD_ORG_GMK_HEADER_IDS'),
  DOD_DATA_UNRESTRICTED_USERS: userList('DOD_DATA_UNRESTRICTED_USERS'),
  DOD_DATA_ACCESS_MANAGERS: userList('DOD_DATA_ACCESS_MANAGERS'),
})

const optInt = (min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).optional()

const Source = z.object({
  NAME: z.string().trim().optional(),
  ENVIRONMENT: str('development'),
  TYPE: z.enum(SOURCE_DB_TYPES).default('postgresql'),
  /** Required. Host name or IP address only. */
  HOST: z.string().trim().regex(/^[A-Za-z0-9.\-_:[\]]*$/, 'HOST hanya berisi nama host atau alamat IP').default(''),
  /** Default per type: 5432 PostgreSQL, 8123/8443 ClickHouse http/https, 3306 MySQL, 27017 MongoDB, 6379 Redis. */
  PORT: optInt(1, 65535),
  /** Database name; Redis: database number 0–15 (default 0). */
  DATABASE: z.string().trim().default(''),
  /** Required for PostgreSQL, ClickHouse and MySQL. */
  USERNAME: z.string().trim().default(''),
  /** Default "public" (PostgreSQL) or DATABASE (ClickHouse). */
  SCHEMA: z.string().trim().optional(),
  AUTH_SOURCE: z.string().trim().optional(),
  SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('require'),
  SSL_ROOT_CERT: z.string().trim().optional(),
  PROTOCOL: z.enum(['http', 'https']).default('http'),
  CONNECT_TIMEOUT_MS: int(10_000, 500, 120_000),
  COMMAND_TIMEOUT_MS: int(30_000, 1_000, 600_000),
  POOL_MIN: optInt(0, 20),
  POOL_MAX: optInt(1, 50),
  POOL_IDLE_MS: optInt(1_000),
})

export class ConfigError extends Error {}

/** Fields of the application database, also the ones an old DOD_DB_<TARGET>_* profile used. */
const DB_FIELDS = ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'SSL', 'POOL_MAX', 'MASTER_NAME'] as const
const DB_KEYS = new Set(DB_FIELDS.map((f) => `DOD_DB_${f}`))
const LEGACY_PROFILE = new RegExp(`^DOD_DB_[A-Z][A-Z0-9]*_(${DB_FIELDS.join('|')})$`)

/**
 * The application database has one setup: DOD_DB_* in .env. DOD_DB_TARGET and its DOD_DB_<TARGET>_* profiles
 * were removed; a .env that still has them is refused, so the app can never read a database other than the one
 * the administrator sees in DOD_DB_*.
 */
function refuseLegacyDbProfiles(env: NodeJS.ProcessEnv) {
  const legacy = Object.keys(env).filter((k) => (k === 'DOD_DB_TARGET' && env[k]?.trim()) || (LEGACY_PROFILE.test(k) && !DB_KEYS.has(k)))
  if (legacy.length)
    throw new ConfigError(`${legacy.sort().join(', ')}: profil DOD_DB_TARGET tidak dipakai lagi. Isi satu set DOD_DB_* (HOST, PORT, NAME, USER, PASSWORD, SSL, MASTER_NAME) di .env lalu hapus variabel ini (docs/DATABASE_CONNECTION.md).`)
}

/** Throws when DOD_DB_HOST, DOD_DB_NAME or DOD_DB_USER is empty; called by the API and the scripts before connecting. */
export function requireAppDb(c: Config): void {
  const m = c.metadataDb
  const missing = [!m.host && 'DOD_DB_HOST', !m.database && 'DOD_DB_NAME', !m.user && 'DOD_DB_USER'].filter(Boolean)
  if (missing.length) throw new ConfigError(`${missing.join(', ')} belum diisi di .env: aplikasi memakai satu server database, yang diatur hanya oleh DOD_DB_* (docs/DATABASE_CONNECTION.md).`)
}

/**
 * Connection options for another database (or role) on the application database's server, for scripts that
 * provision databases there (webpwadh1/webpwadh2 samples). Host, port and SSL always come from DOD_DB_*.
 */
export function appServer(c: Config, database: string, as?: { user: string; password: string }) {
  const m = c.metadataDb
  return { host: m.host, port: m.port, database, user: as?.user ?? m.user, password: as?.password ?? m.password, ssl: m.ssl ? { rejectUnauthorized: false } : false }
}

/** How the DOD API reaches that server for a registered connection: a Unix socket path becomes 127.0.0.1. */
export const appServerAddress = (c: Config) => ({ host: c.metadataDb.host.startsWith('/') ? '127.0.0.1' : c.metadataDb.host, port: c.metadataDb.port })

/** A server's env file from before the DOD rename keeps working: DOR_x is read as DOD_x unless DOD_x is set. */
function adoptOldEnvNames(env: NodeJS.ProcessEnv) {
  for (const k of Object.keys(env)) if (k.startsWith('DOR_') && env[`DOD_${k.slice(4)}`] === undefined) env[`DOD_${k.slice(4)}`] = env[k]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  adoptOldEnvNames(env)
  refuseLegacyDbProfiles(env)
  const parsed = Base.safeParse(env)
  if (!parsed.success) throw new ConfigError(`Konfigurasi tidak valid: ${describe(parsed.error)}`)
  const b = parsed.data
  const legacyTrust = (b.DOD_API_TRUST_PROXY ?? '').toLowerCase()
  if (legacyTrust === 'true') throw new ConfigError('DOD_API_TRUST_PROXY=true tidak lagi didukung: nilai itu mempercayai X-Forwarded-For dari siapa pun. Hapus variabel ini dan isi DOD_TRUSTED_PROXIES dengan alamat reverse proxy (lihat docs/SECURITY.md).')
  if (legacyTrust && legacyTrust !== 'false') throw new ConfigError('DOD_API_TRUST_PROXY: nilai tidak dikenal. Variabel ini sudah diganti DOD_TRUSTED_PROXIES.')
  const trustedProxies = parseTrustedProxies(b.DOD_TRUSTED_PROXIES)

  const connections: SourceConnectionConfig[] = []
  const skippedConnections: string[] = []
  for (const prefix of b.DOD_DW_CONNECTIONS.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) throw new ConfigError(`DOD_DW_CONNECTIONS: prefix "${prefix}" tidak valid.`)
    const key = (k: string) => `DOD_DW_${prefix}_${k}`
    // Listed but no DOD_DW_<P>_* at all: skip it instead of blocking the whole app (login included).
    if (!Object.keys(Source.shape).some((k) => (env[key(k)] ?? '') !== '')) {
      skippedConnections.push(prefix)
      continue
    }
    const raw = Object.fromEntries(Object.keys(Source.shape).map((k) => [k, env[key(k)] === '' ? undefined : env[key(k)]]))
    const s = Source.safeParse(raw)
    if (!s.success) throw new ConfigError(`Koneksi ${prefix}: ${describe(s.error, (p) => key(p))}`)
    const c = s.data
    const need = (k: 'HOST' | 'DATABASE' | 'USERNAME') => {
      if (!c[k]) throw new ConfigError(`Koneksi ${prefix}: ${key(k)} wajib diisi untuk ${c.TYPE}.`)
    }
    need('HOST')
    if (c.TYPE !== 'redis') need('DATABASE')
    if (c.TYPE === 'postgresql' || c.TYPE === 'clickhouse' || c.TYPE === 'mysql') need('USERNAME')
    if (c.TYPE === 'redis' && c.DATABASE && !/^\d{1,2}$/.test(c.DATABASE)) throw new ConfigError(`Koneksi ${prefix}: ${key('DATABASE')} untuk Redis adalah nomor database 0–15.`)
    const ch = c.TYPE === 'clickhouse'
    let sslRootCert: string | null = null
    if (c.TYPE === 'postgresql' && c.SSL_MODE === 'verify-full') {
      if (!c.SSL_ROOT_CERT) throw new ConfigError(`${key('SSL_ROOT_CERT')} wajib diisi untuk SSL_MODE=verify-full.`)
      sslRootCert = readFileSync(c.SSL_ROOT_CERT, 'utf8')
    }
    const poolMax = c.POOL_MAX ?? b.DOD_DW_POOL_MAX
    connections.push({
      id: prefix.toLowerCase().replace(/_/g, '-'),
      origin: 'env',
      name: c.NAME || `${c.DATABASE} ${prefix}`,
      dbType: c.TYPE,
      environment: c.ENVIRONMENT,
      host: c.HOST,
      port: c.PORT ?? defaultPort(c.TYPE, c.PROTOCOL),
      database: c.TYPE === 'redis' ? c.DATABASE || '0' : c.DATABASE,
      username: c.USERNAME,
      passwordSecret: key('PASSWORD'),
      authSource: c.AUTH_SOURCE || null,
      schema: c.SCHEMA || defaultSchema(c.TYPE, c.DATABASE),
      sslMode: ch ? (c.PROTOCOL === 'https' ? 'require' : 'disable') : c.SSL_MODE,
      protocol: c.PROTOCOL,
      sslRootCert,
      connectTimeoutMs: c.CONNECT_TIMEOUT_MS,
      commandTimeoutMs: c.COMMAND_TIMEOUT_MS,
      pool: { min: Math.min(c.POOL_MIN ?? b.DOD_DW_POOL_MIN, poolMax), max: poolMax, idleTimeoutMs: c.POOL_IDLE_MS ?? b.DOD_DW_POOL_IDLE_MS },
    })
  }

  // The organization reference uses the existing application account (DOD_DB_USER) unless DOD_ORG_DB_USER names
  // another one. In dor_apims_master that account only gets SELECT on the organization tables (docs/sql/dor_apims_master);
  // the reader refuses it at runtime if it can write there, is a superuser, or can read ms_tenant / ms_user_*.
  const orgUser = b.DOD_ORG_DB_USER || b.DOD_DB_USER
  if (orgUser.toLowerCase() === 'postgres') throw new ConfigError('DOD_ORG_DB_USER tidak boleh akun superuser postgres: gunakan akun aplikasi (DOD_DB_USER) yang hanya diberi SELECT di dor_apims_master.')
  const orgPassword = b.DOD_ORG_DB_PASSWORD || (orgUser === b.DOD_DB_USER ? b.DOD_DB_PASSWORD : '')
  const orgDatabase = b.DOD_ORG_DB_NAME || b.DOD_DB_MASTER_NAME
  const orgDb =
    orgUser && orgPassword && orgDatabase
      ? { host: b.DOD_ORG_DB_HOST || b.DOD_DB_HOST, port: b.DOD_ORG_DB_PORT ?? b.DOD_DB_PORT, database: orgDatabase, user: orgUser, password: orgPassword, ssl: (b.DOD_ORG_DB_SSL || b.DOD_DB_SSL) === 'true' }
      : null

  return {
    env: b.NODE_ENV,
    api: { host: b.DOD_API_HOST, port: b.DOD_API_PORT, corsOrigin: b.DOD_API_CORS_ORIGIN || null, trustedProxies },
    orgDb,
    dataAccess: {
      cacheMs: b.DOD_ORG_CACHE_SECONDS * 1000,
      regionSource: b.DOD_ORG_REGION_SOURCE || null,
      wilayahNodeIds: b.DOD_ORG_WILAYAH_NODE_IDS,
      gmkHeaderIds: b.DOD_ORG_GMK_HEADER_IDS,
      unrestrictedUsers: b.DOD_DATA_UNRESTRICTED_USERS,
      managers: b.DOD_DATA_ACCESS_MANAGERS,
    },
    logLevel: b.DOD_LOG_LEVEL,
    metadataDb: { host: b.DOD_DB_HOST, port: b.DOD_DB_PORT, database: b.DOD_DB_NAME, user: b.DOD_DB_USER, password: b.DOD_DB_PASSWORD, ssl: b.DOD_DB_SSL === 'true', poolMax: b.DOD_DB_POOL_MAX },
    orgMaster: b.DOD_DB_MASTER_NAME ? { database: b.DOD_DB_MASTER_NAME } : null,
    auth: {
      sessionHours: b.DOD_SESSION_HOURS,
      adminUsername: b.DOD_ADMIN_USERNAME,
      adminName: b.DOD_ADMIN_NAME,
      adminPassword: b.DOD_ADMIN_PASSWORD || null,
      loginLimit: { windowMs: b.DOD_LOGIN_WINDOW_MINUTES * 60_000, maxPerUser: b.DOD_LOGIN_MAX_ATTEMPTS, maxPerIp: b.DOD_LOGIN_MAX_ATTEMPTS_PER_IP, maxKeys: b.DOD_LOGIN_MAX_TRACKED },
    },
    pool: { min: Math.min(b.DOD_DW_POOL_MIN, b.DOD_DW_POOL_MAX), max: b.DOD_DW_POOL_MAX, idleTimeoutMs: b.DOD_DW_POOL_IDLE_MS },
    limits: {
      analyticsTimeoutMs: b.DOD_QUERY_TIMEOUT_MS,
      metadataTimeoutMs: b.DOD_METADATA_TIMEOUT_MS,
      resultDefaultLimit: Math.min(b.DOD_RESULT_DEFAULT_LIMIT, b.DOD_RESULT_MAX_LIMIT),
      resultMaxLimit: b.DOD_RESULT_MAX_LIMIT,
      exportMaxRows: b.DOD_EXPORT_MAX_ROWS,
      distinctValuesMax: b.DOD_DISTINCT_VALUES_MAX,
      resultCacheMs: b.DOD_RESULT_CACHE_SECONDS * 1000,
    },
    connections,
    skippedConnections,
    production: (b.DOD_PRODUCTION_DB || b.DOD_GIS_PRODUCTION_DB) ? { database: b.DOD_PRODUCTION_DB || b.DOD_GIS_PRODUCTION_DB } : null,
  }
}

/**
 * DOD_TRUSTED_PROXIES: comma-separated IP addresses or CIDR ranges of the reverse proxies in front of the
 * API (IIS, nginx), or `loopback` (127.0.0.1/8 and ::1). Only requests whose TCP peer is in this list may
 * set the client address through X-Forwarded-For, hop by hop from the right. Empty: no proxy is trusted.
 * Ranges broader than /8 (IPv4) or /16 (IPv6), wildcards and malformed values are refused.
 */
export function parseTrustedProxies(raw: string): string[] {
  const out: string[] = []
  for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (item.toLowerCase() === 'loopback') {
      out.push('127.0.0.1/8', '::1/128')
      continue
    }
    const parts = item.split('/')
    const ip = parts.length <= 2 ? normalizeIp(parts[0]) : null
    if (!ip) throw new ConfigError(`DOD_TRUSTED_PROXIES: "${item.slice(0, 60)}" bukan alamat IP atau CIDR yang valid (contoh: 127.0.0.1, 10.20.0.0/24, ::1).`)
    const max = isIPv4(ip) ? 32 : 128
    const prefix = parts[1]
    if (prefix !== undefined && !/^\d{1,3}$/.test(prefix)) throw new ConfigError(`DOD_TRUSTED_PROXIES: prefix "/${prefix.slice(0, 10)}" tidak valid.`)
    const bits = prefix === undefined ? max : Number(prefix)
    if (bits > max) throw new ConfigError(`DOD_TRUSTED_PROXIES: prefix /${bits} melebihi /${max} untuk ${ip}.`)
    if (bits < (max === 32 ? 8 : 16)) throw new ConfigError(`DOD_TRUSTED_PROXIES: rentang ${ip}/${bits} terlalu luas; sebut alamat atau subnet reverse proxy saja.`)
    out.push(`${ip}/${bits}`)
  }
  return [...new Set(out)]
}

/** Default schema: "public" (PostgreSQL), the database (ClickHouse, MySQL, MongoDB), "db0" (Redis). */
export function defaultSchema(t: SourceDbType, database: string): string {
  return t === 'postgresql' ? 'public' : t === 'redis' ? `db${Number(database) || 0}` : database
}

/** Reads a connection's password at the moment it is needed; it is never cached elsewhere. */
export function readSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env[name]
  return v ? v : null
}

function describe(e: z.ZodError, name: (p: string) => string = (p) => p) {
  return e.issues.map((i) => `${name(String(i.path[0] ?? ''))}: ${i.message}`).join('; ')
}
