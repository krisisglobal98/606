/**
 * HTTP controllers. Thin: parse/validate input, check the role, call a service.
 *
 *   /api/auth/*                      AuthController
 *   /api/health, /health/*           HealthController
 *   /api/dw/connections/*            Connections of .env (names only) and their schemas/tables/columns, read
 *                                    to build datasets. No add/change/delete/test: connections are set in .env.
 *   /api/categories/*                CategoryController (master Kategori → Sub-kategori)
 *   /api/dw/datasets/*               DatasetController
 *   /api/dw/catalog, /dw/analytics/* AnalyticsController
 *   /api/users/*, /api/org/*         User management and organization master (see users/routes.ts)
 *   /api/access/*                    Menu permissions per role; its hook checks every request (see access/routes.ts)
 *   /api/report/*, /api/saved-reports, /api/profile/*  see their modules' routes.ts
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AnalyticsQuerySchema } from '../analytics/analyticsService.ts'
import { GridRequestSchema, GridService } from '../analytics/gridService.ts'
import { CategoryInputSchema, CategoryPatchSchema } from '../categories/categoryService.ts'
import { CreateDatasetSchema, UpdateDatasetSchema } from '../datasets/datasetService.ts'
import { registerReportRoutes } from '../reports/routes.ts'
import { registerUserRoutes } from '../users/routes.ts'
import { registerProfileRoutes } from '../profile/routes.ts'
import { registerAccessRoutes } from '../access/routes.ts'
import type { User } from '../auth/authService.ts'
import type { Container } from '../container.ts'
import { AppError } from './errors.ts'
import { datasetOrgProfile, datasetOrgStatus } from '../dataAccess/datasetOrg.ts'
import { forDataset, type AccessScope } from '../dataAccess/guard.ts'
import { autoValidateDatasetOrg, validateDatasetOrg } from '../dataAccess/orgValidation.ts'
import { clientIp } from './clientIp.ts'
import { bearer, requireRole } from './server.ts'

// takeOver: sign the other user of this device out first (one device, one user; see AuthService.login).
const Login = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200), takeOver: z.boolean().optional() })
const ChangePassword = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'Password baru minimal 8 karakter').max(200),
})
const Ident = z.string().min(1).max(128)
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Tanggal tidak valid')
const QueryLogQuery = z.object({
  from: IsoDate,
  to: IsoDate,
  status: z.enum(['ok', 'error', 'cancelled']).optional(),
  kind: z.string().max(64).regex(/^[a-z0-9._-]+$/).optional(),
  userId: z.string().max(64).optional(),
  datasetId: z.string().max(64).optional(),
  minDurationMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})

/**
 * Sign-in, session and sign-out. Separate so the real handlers (with the login throttle) can be tested
 * without a database, against any object with AuthService's login/logout.
 */
export function registerAuthRoutes(app: FastifyInstance, k: Pick<Container, 'auth' | 'loginLimiter' | 'log'> & Partial<Pick<Container, 'access' | 'dataAccess'>>) {
  // The menus the user's role may open (Settings → Hak Akses Menu); the browser builds its navigation from them.
  // dataAccess: the user's own data access privileges (flags only; the scope itself is decided per request).
  const withMenus = async (u: User) => ({
    ...u,
    ...(k.access ? { menus: await k.access.menusFor(u.role) } : {}),
    ...(k.dataAccess ? { dataAccess: { unrestricted: k.dataAccess.isUnrestricted(u), manager: k.dataAccess.isManager(u) } } : {}),
  })
  app.post('/api/auth/login', async (req, reply) => {
    const b = Login.parse(req.body)
    const ip = clientIp(req)
    const a = k.loginLimiter.attempt(ip, b.username)
    if (!a.ok) {
      k.log.warn({ username: b.username.slice(0, 64), retryAfterSec: a.retryAfterSec, reason: a.reason }, 'login throttled')
      reply.header('Retry-After', String(a.retryAfterSec))
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Terlalu banyak percobaan masuk. Coba lagi dalam ${Math.ceil(a.retryAfterSec / 60)} menit.`)
    }
    try {
      const session = await k.auth.login(b.username, b.password, { ip, takeOver: b.takeOver === true })
      k.loginLimiter.settle(a.ticket, 'success')
      return { ...session, user: await withMenus(session.user) }
    } catch (e) {
      k.loginLimiter.settle(a.ticket, e instanceof AppError && e.code === 'INVALID_CREDENTIALS' ? 'invalid' : 'error')
      throw e
    }
  })
  app.get('/api/auth/me', async (req) => withMenus(requireRole(req)))
  // Every signed-in user may change their own password; wrong current passwords count as failed logins.
  app.post('/api/auth/password', async (req) => {
    const u = requireRole(req)
    const b = ChangePassword.parse(req.body)
    const a = k.loginLimiter.attempt(clientIp(req), u.username)
    if (!a.ok) throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(a.retryAfterSec / 60)} menit.`)
    try {
      const r = await k.auth.changePassword(u.id, bearer(req), b.currentPassword, b.newPassword)
      k.loginLimiter.settle(a.ticket, 'success')
      return r
    } catch (e) {
      k.loginLimiter.settle(a.ticket, e instanceof AppError && e.code === 'INVALID_CURRENT_PASSWORD' ? 'invalid' : 'error')
      throw e
    }
  })
  app.post('/api/auth/logout', async (req, reply) => {
    await k.auth.logout(bearer(req))
    return reply.code(204).send()
  })
}

export function registerRoutes(app: FastifyInstance, k: Container) {
  registerAccessRoutes(app, k)
  registerReportRoutes(app, k)
  registerUserRoutes(app, k)
  registerProfileRoutes(app, k)
  const grid = new GridService(k.datasets, k.query, k.config, k.dataAccess, k.resultCache)
  /** Catalog fields plus each measure's calculation, read by the frontend measure engine. */
  const withCalc = (d: Awaited<ReturnType<typeof k.datasets.get>>) =>
    k.datasets.fields(d).map((f) => {
      const m = f.kind === 'measure' ? d.semantic.measures.find((x) => x.id === f.id) : undefined
      if (!m) return f
      return { ...f, calc: m.type === 'ratio' ? { kind: 'ratio' as const, num: m.numerator, den: m.denominator, scale: m.scale } : { kind: 'base' as const } }
    })
  registerAuthRoutes(app, k)

  /* ---------------- Health ---------------- */
  app.get('/api/health', async () => ({ status: 'up', service: 'dod-api', version: k.version, time: new Date().toISOString(), uptimeSec: Math.round(process.uptime()) }))
  app.get('/api/health/database', async (_req, reply) => {
    try {
      return { status: 'up', database: 'dod-metadata', responseTimeMs: await k.db.ping() }
    } catch (e) {
      k.log.warn({ code: (e as { code?: string }).code }, 'metadata db health failed')
      return reply.code(503).send({ status: 'down', database: 'dod-metadata', error: 'METADATA_DB_UNAVAILABLE' })
    }
  })
  // Public: overall status only. Signed-in users also get the per-source list (names, status, error code).
  app.get('/api/health/datawarehouse', async (req, reply) => {
    const sources = await k.dw.health()
    const down = sources.some((s) => s.status !== 'up')
    const status = !sources.length ? 'not_configured' : down ? 'degraded' : 'up'
    return reply.code(down ? 503 : 200).send(req.user ? { status, sources } : { status })
  })

  /* ---------------- Data warehouse: connections (from .env) & metadata for building datasets ---------------- */
  // Connections are configured only in .env; the browser gets their names and types, never host, account
  // or password, and cannot add, change, delete or test one. Schemas, tables and columns are read to build
  // and edit datasets (Data → Set Data); table data itself (preview, profile, row count) is not offered.
  const conn = (id: string) => k.dw.config(id)
  app.get('/api/dw/connections', async (req) => {
    requireRole(req, 'admin', 'analyst')
    return k.dw.list()
  })
  app.get<{ Params: { id: string }; Querystring: { fresh?: string } }>('/api/dw/connections/:id/schemas', async (req) => {
    requireRole(req, 'admin', 'analyst')
    return k.meta.schemas(conn(req.params.id), req.abort, req.query.fresh === '1')
  })
  app.get<{ Params: { id: string; schema: string }; Querystring: { fresh?: string } }>('/api/dw/connections/:id/schemas/:schema/tables', async (req) => {
    requireRole(req, 'admin', 'analyst')
    return k.meta.tables(conn(req.params.id), Ident.parse(req.params.schema), req.abort, req.query.fresh === '1')
  })
  const tableRoute = '/api/dw/connections/:id/schemas/:schema/tables/:table'
  type TP = { Params: { id: string; schema: string; table: string }; Querystring: { fresh?: string } }
  app.get<TP>(`${tableRoute}/columns`, async (req) => {
    const u = requireRole(req, 'admin', 'analyst')
    const cols = (await k.meta.table(conn(req.params.id), Ident.parse(req.params.schema), Ident.parse(req.params.table), req.abort)).columns
    // Sample values of the planner statistics are table data: only for unrestricted_data holders (K-10).
    return k.dataAccess.isUnrestricted(u) ? cols : cols.map((c) => (c.stats ? { ...c, stats: { ...c.stats, commonValues: [], min: null, max: null } } : c))
  })

  /* ---------------- Categories ---------------- */
  app.get('/api/categories', async (req) => {
    requireRole(req)
    return k.categories.list()
  })
  app.post('/api/categories', async (req, reply) => {
    const u = requireRole(req, 'admin', 'analyst')
    return reply.code(201).send(await k.categories.create(CategoryInputSchema.parse(req.body), u.id))
  })
  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (req) => {
    const u = requireRole(req, 'admin', 'analyst')
    return k.categories.update(req.params.id, CategoryPatchSchema.parse(req.body), u.id)
  })
  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (req, reply) => {
    const u = requireRole(req, 'admin', 'analyst')
    await k.categories.remove(req.params.id, u.id)
    return reply.code(204).send()
  })

  /* ---------------- Datasets ---------------- */
  app.get('/api/dw/datasets', async (req) => {
    requireRole(req)
    return k.datasets.list({ includeArchived: (req.query as { archived?: string }).archived === '1' })
  })
  app.get<{ Params: { id: string } }>('/api/dw/datasets/:id', async (req) => {
    requireRole(req)
    const d = await k.datasets.get(req.params.id)
    return { ...d, fields: k.datasets.fields(d) }
  })
  app.post('/api/dw/datasets/suggest', async (req) => {
    requireRole(req, 'admin', 'analyst')
    const b = z.object({ connectionId: Ident, schema: Ident, tables: z.array(Ident).min(1).max(4) }).parse(req.body)
    return k.datasets.suggest(b.connectionId, b.schema, b.tables, req.abort)
  })
  // Every save of a dataset is a new version: its organization validation runs again at once (orgValidation in the
  // answer), so scoped users can use it without a separate step.
  app.post('/api/dw/datasets', async (req, reply) => {
    const u = requireRole(req, 'admin', 'analyst')
    const d = await k.datasets.create(CreateDatasetSchema.parse(req.body), u.id)
    const orgValidation = await autoValidateDatasetOrg(k, d, u.id, req.abort)
    return reply.code(201).send({ ...d, fields: k.datasets.fields(d), orgValidation })
  })
  app.patch<{ Params: { id: string } }>('/api/dw/datasets/:id', async (req) => {
    const u = requireRole(req, 'admin', 'analyst')
    const d = await k.datasets.update(req.params.id, UpdateDatasetSchema.parse(req.body), u.id)
    const orgValidation = await autoValidateDatasetOrg(k, d, u.id, req.abort)
    return { ...d, fields: k.datasets.fields(d), orgValidation }
  })
  app.delete<{ Params: { id: string } }>('/api/dw/datasets/:id', async (req, reply) => {
    const u = requireRole(req, 'admin', 'analyst')
    await k.datasets.remove(req.params.id, u.id)
    return reply.code(204).send()
  })
  app.get<{ Params: { id: string }; Querystring: { field?: string; q?: string } }>('/api/dw/datasets/:id/values', async (req) => {
    const u = requireRole(req)
    if (!req.query.field) throw new AppError(400, 'FIELD_REQUIRED', 'Parameter field wajib diisi.')
    return k.analytics.values(req.params.id, req.query.field, req.query.q?.trim().slice(0, 50) || null, req.abort, u)
  })

  /* ---------------- Organization parameters of a dataset (data access) ---------------- */
  // Status: profile (which column is the BU, Group, …) and the stored validation of this dataset version.
  app.get<{ Params: { id: string } }>('/api/dw/datasets/:id/org', async (req) => {
    requireRole(req, 'admin', 'analyst')
    const d = await k.datasets.get(req.params.id)
    const v = await k.dataAccess.validationOf(d.id)
    const profile = datasetOrgProfile(d.semantic)
    return { profile, status: datasetOrgStatus(profile, v, d.updatedAt), validation: v }
  })
  // Validates the BU values of every source against the PIMS master (counts only; K-13). Admin/analyst.
  app.post<{ Params: { id: string } }>('/api/dw/datasets/:id/org-validation', async (req) => {
    const u = requireRole(req, 'admin', 'analyst')
    return validateDatasetOrg(k, await k.datasets.get(req.params.id), u.id, req.abort)
  })

  /* ---------------- Analytics ---------------- */
  /** Datasets in the shape the Analysis page uses; a source that cannot be reached is flagged, not hidden. */
  app.get('/api/dw/catalog', async (req) => {
    const u = requireRole(req)
    // Datasets and their organization validations in two queries, whatever the number of datasets: the catalog is
    // asked for by every Analisis page, and one metadata query per dataset queued behind the small metadata pool.
    const list = await k.datasets.activeRecords()
    const validations = await k.dataAccess.validationsOf(list.map((d) => d.id))
    // One scope for the whole catalog; a refused dataset is listed with its reason and without any data.
    let scope: AccessScope | null = null
    let scopeError: AppError | null = null
    try {
      scope = await k.dataAccess.scopeFor(u)
    } catch (e) {
      if (!(e instanceof AppError)) throw e
      scopeError = e
    }
    const datasets = await Promise.all(
      list.map(async (d) => {
        const validation = validations.get(d.id) ?? null
        let coverage: { from: string; to: string } | null = null
        let error: { code: string; message: string } | null = null
        let access: { status: 'ok' | 'partial' | 'denied'; code: string | null; message: string | null; notify: boolean; unmappedShare: number | null } = { status: 'ok', code: null, message: null, notify: false, unmappedShare: null }
        try {
          if (scopeError) throw scopeError
          // Listing is not an access attempt: decided here without a denial audit (data endpoints audit their refusals).
          const rows = forDataset(scope!, d, validation)
          if (rows.kind === 'rows' && rows.status === 'PARTIAL') access = { ...access, status: 'partial', unmappedShare: validation?.detail.unmappedShare ?? null }
          try {
            coverage = await k.datasets.coverage(d, rows, req.abort)
          } catch (e) {
            error = e instanceof AppError ? { code: e.code, message: e.message } : { code: 'SOURCE_QUERY_FAILED', message: 'Sumber data tidak tersedia.' }
          }
        } catch (e) {
          if (!(e instanceof AppError)) throw e
          access = { status: 'denied', code: e.code, message: e.message, notify: !!(e.details as { notify?: boolean } | undefined)?.notify, unmappedShare: null }
        }
        const m = d.semantic
        return {
          id: d.id,
          label: d.name,
          description: d.description || `${d.sourceTables.join(' + ')} · ${d.connectionName}`,
          fields: withCalc(d),
          kpi: { actual: m.kpi.actual, target: m.kpi.target, achievement: m.measures.some((x) => x.id === 'achievement') ? 'achievement' : null },
          defaultLayout: m.defaultLayout,
          coverage: coverage ?? { from: '2000-01-01', to: new Date().toISOString().slice(0, 10) },
          category: d.category ? (d.category.parentName ? { name: d.category.parentName, sub: d.category.name } : { name: d.category.name, sub: null }) : null,
          source: { kind: 'warehouse', connectionId: d.connectionId, connectionName: d.connectionName, environment: d.environment, tables: d.sourceTables, available: !error, error },
          access,
          scopeFields: m.scopeFields,
          filterFields: m.filterFields,
        }
      }),
    )
    return { datasets }
  })
  app.post('/api/dw/analytics/grid', async (req) => {
    const u = requireRole(req)
    return grid.grid(GridRequestSchema.parse(req.body), req.abort, u)
  })
  app.post('/api/dw/analytics/query', async (req) => {
    const u = requireRole(req)
    return k.analytics.query(AnalyticsQuerySchema.parse(req.body), req.abort, u)
  })
  // Settings › Log Query (administrators; menu settings.querylog). SQL text and parameter values are never stored.
  app.get('/api/dw/query-log', async (req) => {
    requireRole(req, 'admin')
    const q = QueryLogQuery.parse(req.query)
    if (q.from > q.to) throw new AppError(400, 'INVALID_PERIOD', 'Tanggal mulai harus sebelum tanggal akhir.')
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000
    if (days > 366) throw new AppError(400, 'PERIOD_TOO_LONG', 'Periode log paling panjang 1 tahun.')
    const connections = new Map(k.sources.list().map((c) => [c.id, c.name]))
    const r = await k.queryLog.search(q)
    return { ...r, items: r.items.map((x) => ({ ...x, connectionName: connections.get(x.connectionId) ?? x.connectionId })) }
  })
}
