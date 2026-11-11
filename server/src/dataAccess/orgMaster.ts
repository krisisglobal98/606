/**
 * Read-only organization reference (dor_apims_master) for data access scope.
 *
 * - Connects with its own role (DOD_ORG_DB_*; docs/DATA_ACCESS.md), never the application
 *   account. Every session is READ ONLY; only the granted columns are selected.
 * - Before the first snapshot of a process the role itself is checked: not a superuser, no write privilege on any
 *   table, and no read access to ms_tenant / ms_user_*. An unsafe role is refused (fail-closed), not used.
 * - The snapshot has a FIXED lifetime (DOD_ORG_CACHE_SECONDS, at most 300 s): it is never extended, an expired
 *   snapshot is never served, and a failed reload is a 503 for that request (no stale data, no global fallback).
 */
import pg from 'pg'
import type { Config } from '../config/config.ts'
import { rollback } from '../db/connection.ts'
import { AppError } from '../http/errors.ts'
import type { Logger } from '../log/logger.ts'
import type { OrgSnapshot } from './scope.ts'

const LIVE = (t: string) => `${t}.is_active AND NOT ${t}.is_deleted AND (${t}.valid_from IS NULL OR ${t}.valid_from <= current_date) AND (${t}.valid_to IS NULL OR ${t}.valid_to >= current_date)`

/** Only the columns granted to the role (plan §2.3). */
const SQL = {
  groups: `SELECT g.id::text AS id, g.code, g.name FROM public.ms_group g WHERE ${LIVE('g')}`,
  regions: `SELECT r.id::text AS id, r.code, r.name, r.group_id::text AS group_id FROM public.ms_region r WHERE ${LIVE('r')}`,
  companies: `SELECT c.id::text AS id, c.code, c.name, c."companyAlias" AS alias, c."oracleCode" AS oracle, c.group_id::text AS group_id, c.region_id::text AS region_id FROM public.ms_company c WHERE ${LIVE('c')}`,
  units: `SELECT b.id::text AS id, b.code, b.name, b.company_id::text AS company_id FROM public.ms_businessunit b WHERE ${LIVE('b')}`,
  gmks: `SELECT h.id::text AS id, h.name, h.group_id::text AS group_id FROM public.ms_gmk_header h WHERE ${LIVE('h')}`,
  gmkUnits: `SELECT d.gmkheader_id::text AS gmk_id, d.businessunit_id::text AS unit_id FROM public.ms_gmk_detail d WHERE ${LIVE('d')} AND d.businessunit_id IS NOT NULL`,
  rayons: `SELECT x.id::text AS id, x.code, x.name FROM public.ms_rayon x WHERE ${LIVE('x')}`,
  divisions: `SELECT x.id::text AS id, x.code, x.name FROM public.ms_division x WHERE ${LIVE('x')}`,
  unitDivisions: `SELECT x.businessunit_id::text AS unit_id, x.division_id::text AS division_id FROM public.ms_businessunitdivision x WHERE ${LIVE('x')}`,
  structures: `SELECT s.id::text AS id, s.code, s.name, s."level" AS level FROM public.ms_so_structure s WHERE ${LIVE('s')}`,
  nodes: `SELECT n.id::text AS id, n.structure_id::text AS structure_id, n.parent_id::text AS parent_id, n.code, n.name, COALESCE(n.is_virtual, false) AS is_virtual FROM public.ms_so_node n WHERE ${LIVE('n')}`,
  nodeUnits: `SELECT x.so_node_id::text AS node_id, x.businessunit_id::text AS unit_id FROM public.ms_so_node_businessunit x WHERE ${LIVE('x')}`,
  ownerships: `SELECT o.id::text AS id, o.name FROM public.ms_blockownership o WHERE ${LIVE('o')}`,
} as const

/** Role safety (plan §2.4 V1–V3, checked by the app too). */
const ROLE_CHECK = `
  SELECT r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
         current_setting('transaction_read_only') AS read_only,
         (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
            AND has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))::int AS writable,
         (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
            AND (c.relname = 'ms_tenant' OR c.relname LIKE 'ms\\_user\\_%') AND has_any_column_privilege(c.oid, 'SELECT'))::int AS forbidden_readable,
         has_schema_privilege('public', 'CREATE') AS can_create
  FROM pg_roles r WHERE r.rolname = current_user`

export type SnapshotLoader = () => Promise<OrgSnapshot>

export function unavailable(code: 'ORG_MASTER_NOT_CONFIGURED' | 'ORG_MASTER_NOT_GRANTED' | 'ORG_MASTER_UNAVAILABLE' | 'ORG_MASTER_ROLE_UNSAFE'): AppError {
  const msg = {
    ORG_MASTER_NOT_CONFIGURED: 'Master organisasi untuk pembatasan akses data belum dikonfigurasi di server; data tidak ditampilkan.',
    ORG_MASTER_NOT_GRANTED: 'Akun DOD belum diberi hak baca (SELECT) pada tabel organisasi di dor_apims_master. Jalankan docs/sql/dor_apims_master/02_grant.sql sebagai pemilik database.',
    ORG_MASTER_UNAVAILABLE: 'Master organisasi tidak dapat dihubungi; data tidak ditampilkan.',
    ORG_MASTER_ROLE_UNSAFE: 'Akun master organisasi di server tidak read-only atau terlalu luas haknya; data tidak ditampilkan. Hubungi administrator.',
  }[code]
  return new AppError(503, code, msg)
}

export class OrgMasterReader {
  private readonly config: Config
  private readonly log: Logger
  private pool: pg.Pool | null = null
  private roleChecked = false

  constructor(config: Config, log: Logger) {
    this.config = config
    this.log = log
  }

  get configured() {
    return !!this.config.orgDb
  }

  /** Loads a fresh snapshot (one READ ONLY, REPEATABLE READ transaction). Throws a 503 AppError on any failure. */
  readonly load: SnapshotLoader = async () => {
    const db = this.config.orgDb
    if (!db) throw unavailable('ORG_MASTER_NOT_CONFIGURED')
    let client: pg.PoolClient | null = null
    let broken: Error | undefined
    try {
      client = await this.connect().connect()
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      if (!this.roleChecked) {
        const r = (await client.query<{ superuser: boolean; bypassrls: boolean; read_only: string; writable: number; forbidden_readable: number; can_create: boolean }>(ROLE_CHECK)).rows[0]
        if (!r || r.superuser || r.bypassrls || r.read_only !== 'on' || r.writable > 0 || r.forbidden_readable > 0 || r.can_create) {
          this.log.error({ superuser: r?.superuser, writable: r?.writable, forbiddenReadable: r?.forbidden_readable, canCreate: r?.can_create }, 'organization master role is not read-only / least privilege: refused')
          throw unavailable('ORG_MASTER_ROLE_UNSAFE')
        }
        this.roleChecked = true
      }
      const q = async <R extends pg.QueryResultRow>(sql: string) => (await client!.query<R>(sql)).rows
      const [groups, regions, companies, units, gmks, gmkUnits, rayons, divisions, unitDivisions, structures, nodes, nodeUnits, ownerships] = [
        await q<{ id: string; code: string; name: string }>(SQL.groups),
        await q<{ id: string; code: string; name: string; group_id: string | null }>(SQL.regions),
        await q<{ id: string; code: string; name: string; alias: string | null; oracle: string | null; group_id: string | null; region_id: string | null }>(SQL.companies),
        await q<{ id: string; code: string; name: string; company_id: string | null }>(SQL.units),
        await q<{ id: string; name: string; group_id: string | null }>(SQL.gmks),
        await q<{ gmk_id: string; unit_id: string }>(SQL.gmkUnits),
        await q<{ id: string; code: string; name: string }>(SQL.rayons),
        await q<{ id: string; code: string; name: string }>(SQL.divisions),
        await q<{ unit_id: string; division_id: string }>(SQL.unitDivisions),
        await q<{ id: string; code: string; name: string; level: number | null }>(SQL.structures),
        await q<{ id: string; structure_id: string | null; parent_id: string | null; code: string; name: string; is_virtual: boolean }>(SQL.nodes),
        await q<{ node_id: string; unit_id: string }>(SQL.nodeUnits),
        await q<{ id: string; name: string }>(SQL.ownerships),
      ]
      await client.query('COMMIT')
      return buildSnapshot({ groups, regions, companies, units, gmks, gmkUnits, rayons, divisions, unitDivisions, structures, nodes, nodeUnits, ownerships }, Date.now())
    } catch (e) {
      if (client) broken = await rollback(client, e)
      if (e instanceof AppError) throw e
      // Never the driver message (it may echo host or role names).
      const code = (e as { code?: string }).code
      this.log.warn({ code }, 'organization master read failed')
      throw unavailable(code === '42501' ? 'ORG_MASTER_NOT_GRANTED' : 'ORG_MASTER_UNAVAILABLE')
    } finally {
      client?.release(broken)
    }
  }

  async close() {
    const p = this.pool
    this.pool = null
    await p?.end().catch(() => undefined)
  }

  private connect(): pg.Pool {
    if (this.pool) return this.pool
    const db = this.config.orgDb!
    this.pool = new pg.Pool({
      host: db.host,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      ssl: db.ssl ? { rejectUnauthorized: false } : false,
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      application_name: 'dod-org-scope',
      // Read-only by session default as well as by the explicit READ ONLY transaction.
      options: '-c default_transaction_read_only=on -c statement_timeout=30000',
    })
    // Once per pool (not per load): an idle client that drops is logged by code only and removed by the pool.
    this.pool.on('error', (e) => this.log.warn({ code: (e as { code?: string }).code }, 'organization master idle client error'))
    return this.pool
  }
}

/** Raw rows → snapshot. Relations keep only rows whose both ends are active. Exported for tests. */
export function buildSnapshot(
  r: {
    groups: { id: string; code: string; name: string }[]
    regions: { id: string; code: string; name: string; group_id: string | null }[]
    companies: { id: string; code: string; name: string; alias: string | null; oracle: string | null; group_id: string | null; region_id: string | null }[]
    units: { id: string; code: string; name: string; company_id: string | null }[]
    gmks: { id: string; name: string; group_id: string | null }[]
    gmkUnits: { gmk_id: string; unit_id: string }[]
    rayons: { id: string; code: string; name: string }[]
    divisions: { id: string; code: string; name: string }[]
    unitDivisions: { unit_id: string; division_id: string }[]
    structures: { id: string; code: string; name: string; level: number | null }[]
    nodes: { id: string; structure_id: string | null; parent_id: string | null; code: string; name: string; is_virtual: boolean }[]
    nodeUnits: { node_id: string; unit_id: string }[]
    ownerships: { id: string; name: string }[]
  },
  loadedAt: number,
): OrgSnapshot {
  const t = (v: string | null | undefined) => (v ?? '').trim()
  const units = new Map(r.units.filter((u) => t(u.code)).map((u) => [u.id, { id: u.id, code: t(u.code), name: t(u.name) || t(u.code), companyId: u.company_id }]))
  const companies = new Map(r.companies.map((c) => [c.id, { id: c.id, code: t(c.code), name: t(c.name) || t(c.code), alias: t(c.alias) || null, oracle: t(c.oracle) || null, groupId: c.group_id, regionId: c.region_id }]))
  // A BU whose company is not active is not part of any company/group/region scope.
  for (const u of units.values()) if (u.companyId && !companies.has(u.companyId)) u.companyId = null
  const gmks = new Map(r.gmks.map((g) => [g.id, { id: g.id, name: t(g.name), groupId: g.group_id, unitIds: new Set<string>() }]))
  for (const x of r.gmkUnits) if (units.has(x.unit_id)) gmks.get(x.gmk_id)?.unitIds.add(x.unit_id)
  const nodes = new Map(r.nodes.map((n) => [n.id, { id: n.id, structureId: n.structure_id, parentId: n.parent_id, code: t(n.code), name: t(n.name), isVirtual: !!n.is_virtual, unitIds: new Set<string>() }]))
  for (const x of r.nodeUnits) if (units.has(x.unit_id)) nodes.get(x.node_id)?.unitIds.add(x.unit_id)
  return {
    loadedAt,
    groups: new Map(r.groups.map((g) => [g.id, { id: g.id, code: t(g.code), name: t(g.name) || t(g.code) }])),
    regions: new Map(r.regions.map((g) => [g.id, { id: g.id, code: t(g.code), name: t(g.name) || t(g.code), groupId: g.group_id }])),
    companies,
    units,
    gmks,
    rayons: new Map(r.rayons.map((x) => [x.id, { id: x.id, code: t(x.code), name: t(x.name) || t(x.code) }])),
    divisions: new Map(r.divisions.map((x) => [x.id, { id: x.id, code: t(x.code), name: t(x.name) || t(x.code) }])),
    unitDivisions: new Set(r.unitDivisions.filter((x) => units.has(x.unit_id)).map((x) => `${x.unit_id}|${x.division_id}`)),
    structures: new Map(r.structures.map((x) => [x.id, { id: x.id, code: t(x.code), name: t(x.name), level: x.level }])),
    nodes,
    ownerships: new Map(r.ownerships.filter((x) => t(x.name)).map((x) => [t(x.name).toUpperCase(), { id: x.id, name: t(x.name) }])),
  }
}

/**
 * Fixed-lifetime snapshot cache: no sliding expiry, no stale serving, one load at a time.
 *
 * Refresh ahead: a request in the last part of the lifetime (`aheadMs`, at most 1 minute) still gets the valid
 * snapshot and starts ONE reload in the background, so active users do not wait for the master at expiry. A failed
 * background reload changes nothing (reported to `onBackgroundError`): the valid snapshot is served until its own
 * expiry and never after it; from then on the usual rule applies (reload in the request, failure = 503).
 */
export class SnapshotCache {
  private current: OrgSnapshot | null = null
  private loading: Promise<OrgSnapshot> | null = null
  /** Incremented by `invalidate`: a load started before it never becomes the current snapshot. */
  private generation = 0
  private readonly load: SnapshotLoader
  private readonly ttlMs: number
  private readonly aheadMs: number
  private readonly now: () => number
  private readonly onBackgroundError: (e: unknown) => void

  constructor(load: SnapshotLoader, ttlMs: number, now: () => number = Date.now, onBackgroundError: (e: unknown) => void = () => {}) {
    this.load = load
    this.ttlMs = ttlMs
    this.aheadMs = Math.min(60_000, Math.floor(ttlMs / 5))
    this.now = now
    this.onBackgroundError = onBackgroundError
  }

  /** The snapshot when it is younger than the lifetime; otherwise a reload (its failure is thrown, never hidden). */
  async get(): Promise<OrgSnapshot> {
    const c = this.current
    const age = c ? this.now() - c.loadedAt : Infinity
    if (c && age < this.ttlMs) {
      if (age >= this.ttlMs - this.aheadMs && !this.loading) this.reload().catch(this.onBackgroundError)
      return c
    }
    // Expired: never served again, whatever happens to the reload.
    this.current = null
    return this.loading ?? this.reload()
  }

  private reload(): Promise<OrgSnapshot> {
    const gen = this.generation
    const p: Promise<OrgSnapshot> = this.load()
      .then((s) => {
        // Lifetime counts from the moment the data was read, not from first use.
        const snap = { ...s, loadedAt: this.now() }
        if (gen === this.generation) this.current = snap
        return snap
      })
      .finally(() => {
        if (this.loading === p) this.loading = null
      })
    this.loading = p
    return p
  }

  /** Drops the snapshot (admin "Muat ulang master"): the next request reads the master again. */
  invalidate() {
    this.generation++
    this.current = null
    this.loading = null
  }

  get loadedAt(): number | null {
    return this.current?.loadedAt ?? null
  }
}
