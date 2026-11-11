/**
 * Redis: connection, test and key discovery. A logical database (db0, db1 …) plays the role of a
 * schema; keys are grouped by their prefix before the first ":" (e.g. "panen:2026:01" → "panen:*"),
 * and a group plays the role of a table. Discovery uses SCAN with a hard ceiling, never KEYS, and
 * only read commands (PING, INFO, SCAN, TYPE, HKEYS on a sample key). Nothing is written.
 */
import { createClient, type RedisClientType } from 'redis'
import type { SourceConnectionConfig } from '../config/config.ts'
import { toSourceError } from '../http/errors.ts'
import { CachedMetadata, type Privileges, type SchemaInfo, type ServerInfo, type SourceMetadata, type TableInfo, type TableMetadata } from './metadata.ts'
import type { SourceRegistry } from './sourceRegistry.ts'

/** Maximum keys inspected per database when grouping (SCAN, COUNT 500 per round). */
const SCAN_LIMIT = 5000

const dbIndex = (schema: string) => Number(/^db(\d+)$/.exec(schema)?.[1] ?? 0)
const groupOf = (key: string) => (key.includes(':') ? `${key.slice(0, key.indexOf(':'))}:*` : key)

export class RedisMetadataService extends CachedMetadata implements SourceMetadata {
  private readonly src: SourceRegistry
  private readonly clients = new Map<string, RedisClientType>()

  constructor(src: SourceRegistry) {
    super()
    this.src = src
    src.onReset(async (prefix) => {
      for (const [k, cl] of this.clients)
        if (k.startsWith(`${prefix}|`)) {
          this.clients.delete(k)
          await cl.close().catch(() => undefined)
        }
    })
  }

  /** One client per (connection, database); SELECT is per connection in Redis. */
  private async client(c: SourceConnectionConfig, db = dbIndex(c.schema)): Promise<RedisClientType> {
    const key = `${c.id}|${db}`
    let cl = this.clients.get(key)
    if (cl) return cl
    cl = createClient({
      socket:
        c.sslMode === 'disable'
          ? { host: c.host, port: c.port, connectTimeout: c.connectTimeoutMs, reconnectStrategy: false }
          : { host: c.host, port: c.port, connectTimeout: c.connectTimeoutMs, reconnectStrategy: false, tls: true, rejectUnauthorized: c.sslMode === 'verify-full' },
      username: c.username || undefined,
      password: this.src.secret(c) ?? undefined,
      database: db,
      name: 'dod-dw',
    })
    cl.on('error', () => undefined)
    this.clients.set(key, cl as RedisClientType)
    try {
      await cl.connect()
    } catch (e) {
      this.clients.delete(key)
      throw e
    }
    return cl as RedisClientType
  }

  private async run<T>(c: SourceConnectionConfig, fn: (cl: RedisClientType) => Promise<T>, db?: number): Promise<T> {
    try {
      return await fn(await this.client(c, db))
    } catch (e) {
      throw toSourceError(e)
    }
  }

  async ping(c: SourceConnectionConfig): Promise<number> {
    const t = performance.now()
    await this.run(c, (cl) => cl.ping())
    return Math.round(performance.now() - t)
  }

  private async info(c: SourceConnectionConfig, section: string): Promise<Record<string, string>> {
    const text = await this.run(c, (cl) => cl.info(section))
    return Object.fromEntries(text.split(/\r?\n/).filter((l) => l.includes(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]))
  }

  async schemas(c: SourceConnectionConfig, _signal?: AbortSignal, fresh = false): Promise<SchemaInfo[]> {
    return this.cached(`${c.id}|schemas`, 60_000, async () => {
      const ks = await this.info(c, 'keyspace')
      const dbs = Object.entries(ks).map(([k, v]) => ({ name: k, keys: Number(/keys=(\d+)/.exec(v)?.[1] ?? 0) }))
      if (!dbs.some((d) => d.name === c.schema)) dbs.unshift({ name: c.schema, keys: 0 })
      return dbs.sort((a, b) => dbIndex(a.name) - dbIndex(b.name)).map((d) => ({ name: d.name, tableCount: d.keys, canUse: true, isDefault: d.name === c.schema }))
    }, fresh)
  }

  async tables(c: SourceConnectionConfig, schema: string, _signal?: AbortSignal, fresh = false): Promise<TableInfo[]> {
    return this.cached(`${c.id}|tables|${schema}`, 60_000, () =>
      this.run(c, async (cl) => {
        const groups = new Map<string, number>()
        let seen = 0
        for await (const keys of cl.scanIterator({ COUNT: 500 })) {
          for (const k of keys) groups.set(groupOf(k), (groups.get(groupOf(k)) ?? 0) + 1)
          seen += keys.length
          if (seen >= SCAN_LIMIT) break
        }
        const partial = seen >= SCAN_LIMIT
        return [...groups.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, n]) => ({ schema, name, kind: 'table' as const, estimatedRows: n, totalBytes: null, columnCount: 0, comment: partial ? `Dihitung dari ${SCAN_LIMIT} key pertama (SCAN)` : null, lastAnalyzedAt: null, canSelect: true }))
      }, dbIndex(schema)),
    fresh)
  }

  async table(c: SourceConnectionConfig, schema: string, name: string, _signal?: AbortSignal, fresh = false): Promise<TableMetadata> {
    return this.cached(`${c.id}|table|${schema}.${name}`, 60_000, () =>
      this.run(c, async (cl) => {
        const t = (await this.tables(c, schema, undefined, fresh)).find((x) => x.name === name)
        if (!t) throw toSourceError({ code: '42P01' })
        // One example key of the group tells its Redis type; a hash also shows its fields.
        let sample: string | null = null
        for await (const keys of cl.scanIterator({ MATCH: name.endsWith(':*') ? name : name.replace(/[*?[\]\\]/g, '\\$&'), COUNT: 500 })) {
          if (keys.length) {
            sample = keys[0]!
            break
          }
        }
        const type = sample ? await cl.type(sample) : 'none'
        const fields = type === 'hash' && sample ? (await cl.hKeys(sample)).slice(0, 100) : []
        const columns = [
          { name: 'key', ordinal: 1, dataType: 'string', typeCategory: 'string' as const, nullable: false, defaultValue: null, comment: sample ? `contoh: ${sample}` : null, stats: null },
          ...(fields.length
            ? fields.map((f, i) => ({ name: f, ordinal: i + 2, dataType: 'hash field', typeCategory: 'other' as const, nullable: true, defaultValue: null, comment: null, stats: null }))
            : [{ name: 'value', ordinal: 2, dataType: type, typeCategory: 'other' as const, nullable: false, defaultValue: null, comment: null, stats: null }]),
        ]
        return { ...t, columnCount: columns.length, comment: `Tipe Redis: ${type}${t.comment ? ` · ${t.comment}` : ''}`, columns, indexes: [] }
      }, dbIndex(schema)),
    fresh)
  }

  async serverInfo(c: SourceConnectionConfig): Promise<ServerInfo> {
    const s = await this.info(c, 'server')
    const time = await this.run(c, (cl) => cl.time())
    return { version: `Redis ${s.redis_version ?? ''}`.trim(), serverTime: new Date(Number(time[0]) * 1000).toISOString(), database: c.schema, account: c.username || 'default' }
  }

  async privileges(c: SourceConnectionConfig): Promise<Privileges> {
    // ACL WHOAMI / ACL GETUSER need extra rights; the account's write rights are reported as unknown.
    return { account: c.username || 'default', superuser: false, canCreateDatabase: false, canCreateInSchema: false, writableTables: 0, readableTables: (await this.schemas(c)).length, accountReadOnly: false, sessionReadOnly: true }
  }
}
