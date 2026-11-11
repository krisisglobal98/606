/**
 * MongoDB: connection, test and discovery. A database plays the role of a schema and a collection
 * the role of a table; fields are inferred from a bounded random sample ($sample, 200 documents)
 * because MongoDB has no fixed schema. DOD only issues read commands (listDatabases,
 * listCollections, aggregate with $sample, listIndexes, estimatedDocumentCount).
 */
import { MongoClient, type Document } from 'mongodb'
import type { Config, SourceConnectionConfig } from '../config/config.ts'
import { toSourceError } from '../http/errors.ts'
import { CachedMetadata, type ColumnInfo, type Privileges, type SchemaInfo, type ServerInfo, type SourceMetadata, type TableInfo, type TableMetadata } from './metadata.ts'
import type { SourceRegistry } from './sourceRegistry.ts'

const SAMPLE = 200
const SYSTEM = ['admin', 'local', 'config']
const READ_ROLES = new Set(['read', 'readAnyDatabase', 'clusterMonitor'])

function typeOf(v: unknown): { type: string; cat: ColumnInfo['typeCategory'] } {
  if (v === null) return { type: 'null', cat: 'other' }
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'int' : 'double', cat: 'number' }
  if (typeof v === 'string') return { type: 'string', cat: 'string' }
  if (typeof v === 'boolean') return { type: 'bool', cat: 'boolean' }
  if (v instanceof Date) return { type: 'date', cat: 'date' }
  if (Array.isArray(v)) return { type: 'array', cat: 'other' }
  const bson = (v as { _bsontype?: string })._bsontype
  if (bson === 'ObjectId') return { type: 'objectId', cat: 'string' }
  if (bson === 'Decimal128' || bson === 'Long' || bson === 'Double' || bson === 'Int32') return { type: bson.toLowerCase(), cat: 'number' }
  return { type: bson ? bson.toLowerCase() : 'object', cat: 'other' }
}

/** Short display of a sample value: dates as ISO, ObjectId as hex, documents/arrays as JSON. */
function example(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (v && typeof v === 'object' && (v as { _bsontype?: string })._bsontype) return String(v)
  return (typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 80)
}

export class MongoMetadataService extends CachedMetadata implements SourceMetadata {
  private readonly src: SourceRegistry
  private readonly timeoutMs: number
  private readonly clients = new Map<string, MongoClient>()

  constructor(src: SourceRegistry, config: Config) {
    super()
    this.src = src
    this.timeoutMs = config.limits.metadataTimeoutMs
    src.onReset(async (id) => {
      const cl = this.clients.get(id)
      this.clients.delete(id)
      await cl?.close()
    })
  }

  private async client(c: SourceConnectionConfig): Promise<MongoClient> {
    let cl = this.clients.get(c.id)
    if (cl) return cl
    const password = this.src.secret(c)
    cl = new MongoClient(`mongodb://${c.host.includes(':') ? `[${c.host}]` : c.host}:${c.port}/`, {
      auth: c.username ? { username: c.username, password: password ?? '' } : undefined,
      authSource: c.username ? (c.authSource ?? 'admin') : undefined,
      tls: c.sslMode !== 'disable',
      tlsAllowInvalidCertificates: c.sslMode === 'require',
      serverSelectionTimeoutMS: c.connectTimeoutMs,
      connectTimeoutMS: c.connectTimeoutMs,
      maxPoolSize: c.pool.max,
      minPoolSize: c.pool.min,
      maxIdleTimeMS: c.pool.idleTimeoutMs,
      appName: 'dod-dw',
      readPreference: 'secondaryPreferred',
    })
    this.clients.set(c.id, cl)
    return cl
  }

  private async run<T>(c: SourceConnectionConfig, fn: (cl: MongoClient) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.client(c))
    } catch (e) {
      throw toSourceError(e)
    }
  }

  async ping(c: SourceConnectionConfig): Promise<number> {
    const t = performance.now()
    await this.run(c, (cl) => cl.db(c.database).command({ ping: 1 }, { timeoutMS: c.connectTimeoutMs }))
    return Math.round(performance.now() - t)
  }

  async schemas(c: SourceConnectionConfig, _signal?: AbortSignal, fresh = false): Promise<SchemaInfo[]> {
    return this.cached(`${c.id}|schemas`, 60_000, () =>
      this.run(c, async (cl) => {
        // An account limited to one database may not list the others; it still sees its own.
        const names = await cl
          .db('admin')
          .admin()
          .listDatabases({ nameOnly: true, authorizedDatabases: true })
          .then((r) => r.databases.map((d) => d.name).filter((n) => !SYSTEM.includes(n)))
          .catch(() => [c.database])
        if (!names.includes(c.database)) names.unshift(c.database)
        return Promise.all(
          names.map(async (name) => {
            const n = await cl.db(name).listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray().then((x) => x.length).catch(() => null)
            return { name, tableCount: n ?? 0, canUse: n != null, isDefault: name === c.schema }
          }),
        )
      }),
    fresh)
  }

  async tables(c: SourceConnectionConfig, schema: string, _signal?: AbortSignal, fresh = false): Promise<TableInfo[]> {
    return this.cached(`${c.id}|tables|${schema}`, 60_000, () =>
      this.run(c, async (cl) => {
        const db = cl.db(schema)
        const list = (await db.listCollections({}, { authorizedCollections: true }).toArray()).filter((x) => !x.name.startsWith('system.'))
        return Promise.all(
          list.map(async (x): Promise<TableInfo> => {
            const view = x.type === 'view'
            return {
              schema,
              name: x.name,
              kind: view ? 'view' : 'table',
              estimatedRows: view ? null : await db.collection(x.name).estimatedDocumentCount({ maxTimeMS: this.timeoutMs }).catch(() => null),
              totalBytes: null,
              columnCount: 0,
              comment: null,
              lastAnalyzedAt: null,
              canSelect: true,
            }
          }),
        ).then((r) => r.sort((a, b) => a.name.localeCompare(b.name)))
      }),
    fresh)
  }

  async table(c: SourceConnectionConfig, schema: string, name: string, _signal?: AbortSignal, fresh = false): Promise<TableMetadata> {
    return this.cached(`${c.id}|table|${schema}.${name}`, 60_000, () =>
      this.run(c, async (cl) => {
        const t = (await this.tables(c, schema, undefined, fresh)).find((x) => x.name === name)
        if (!t) throw toSourceError({ code: '42P01' })
        const coll = cl.db(schema).collection(name)
        const docs = await coll.aggregate<Document>([{ $sample: { size: SAMPLE } }], { maxTimeMS: this.timeoutMs }).toArray()
        // Top-level fields of the sample: type(s), presence and an example.
        const fields = new Map<string, { types: Map<string, ColumnInfo['typeCategory']>; seen: number; example: unknown }>()
        for (const d of docs)
          for (const [k, v] of Object.entries(d)) {
            const f = fields.get(k) ?? { types: new Map(), seen: 0, example: v }
            const ty = typeOf(v)
            f.types.set(ty.type, ty.cat)
            f.seen++
            fields.set(k, f)
          }
        const columns: ColumnInfo[] = [...fields.entries()].map(([k, f], i) => {
          const cats = new Set(f.types.values())
          return {
            name: k,
            ordinal: i + 1,
            dataType: [...f.types.keys()].join(' | '),
            typeCategory: cats.size === 1 ? [...cats][0]! : 'other',
            nullable: f.seen < docs.length || f.types.has('null'),
            defaultValue: null,
            comment: `ada di ${f.seen} dari ${docs.length} dokumen sampel`,
            stats: { nullFraction: docs.length ? 1 - f.seen / docs.length : null, distinctEstimate: null, commonValues: [example(f.example)], min: null, max: null },
          }
        })
        const indexes = await coll.listIndexes().toArray().catch(() => [])
        return {
          ...t,
          columnCount: columns.length,
          comment: `Field disimpulkan dari ${docs.length} dokumen acak; MongoDB tidak memiliki skema tetap.`,
          columns,
          indexes: indexes.map((x) => ({
            name: String(x.name),
            columns: Object.keys(x.key ?? {}),
            unique: !!x.unique || x.name === '_id_',
            primary: x.name === '_id_',
            method: Object.values(x.key ?? {}).some((v) => typeof v === 'string') ? String(Object.values(x.key)[0]) : 'btree',
            sizeBytes: null,
            definition: JSON.stringify(x.key),
          })),
        }
      }),
    fresh)
  }

  async serverInfo(c: SourceConnectionConfig): Promise<ServerInfo> {
    return this.run(c, async (cl) => {
      const b = await cl.db(c.database).command({ buildInfo: 1 })
      const s = await cl.db(c.database).command({ connectionStatus: 1 })
      const user = (s.authInfo?.authenticatedUsers?.[0] as { user?: string } | undefined)?.user
      return { version: `MongoDB ${b.version}`, serverTime: new Date().toISOString(), database: c.database, account: user ?? (c.username || '(tanpa autentikasi)') }
    })
  }

  async privileges(c: SourceConnectionConfig): Promise<Privileges> {
    return this.run(c, async (cl) => {
      const s = await cl.db(c.database).command({ connectionStatus: 1 })
      const roles = ((s.authInfo?.authenticatedUserRoles ?? []) as { role: string }[]).map((r) => r.role)
      const readOnly = roles.length > 0 && roles.every((r) => READ_ROLES.has(r))
      return {
        account: c.username || '(tanpa autentikasi)',
        superuser: roles.includes('root'),
        canCreateDatabase: roles.some((r) => ['root', 'readWriteAnyDatabase', 'dbAdminAnyDatabase'].includes(r)),
        canCreateInSchema: !readOnly,
        writableTables: 0,
        readableTables: (await this.tables(c, c.schema).catch(() => [])).length,
        accountReadOnly: readOnly,
        sessionReadOnly: true,
      }
    })
  }
}
