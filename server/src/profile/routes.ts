/**
 * Data Profil (/api/profile/*), the "Data Profil" card of Analisis: read-only profiles from the master database.
 * Every signed-in role may call them (menus analisis.profil-blok, analisis.kartu-kendaraan decide per role), and
 * every response is limited to the caller's data access scope (dataAccess/guard.ts):
 *
 *   - lists (units, blocks, vehicles) contain only what the scope covers;
 *   - every endpoint with a block/vehicle id first reads that record's BU (and rayon, division, ownership for a
 *     block) and answers 404 when the scope does not cover it — the same answer as an unknown id (no IDOR);
 *   - the two PUT endpoints need the admin role AND the record inside the scope (a role alone gives no data).
 *
 *   GET /api/profile/status                         { configured }
 *   GET /api/profile/units                          kebun / business units with their block and vehicle counts
 *   GET /api/profile/blocks?unit=&q=                the blocks of a unit (at most 50 without one)
 *   GET /api/profile/blocks/:id                     Profil Blok
 *   GET /api/profile/vehicles/groups                vehicle groups (master list, no unit data)
 *   GET /api/profile/vehicles?unit=&group=&q=       the vehicles of a unit (at most 50 without one)
 *   GET /api/profile/vehicles/:id                   Kartu Kendaraan
 *   GET /api/profile/blocks/:id/ops/:tab?period=    tab Produksi | Perawatan | Pemupukan | Biaya of a month
 *   GET /api/profile/vehicles/:id/ops?period=       tabs KPI, Biaya, Kegiatan, Work Order, Keputusan of a month
 *   PUT /api/profile/vehicles/:id/card              admin + scope: budget tariff, standards, asset values
 *   PUT /api/profile/vehicles/:id/costs/:period     admin + scope: costs of the month per category
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { User } from '../auth/authService.ts'
import type { Container } from '../container.ts'
import { coversRecord, profileFilter } from '../dataAccess/guard.ts'
import { AppError } from '../http/errors.ts'
import { requireRole } from '../http/server.ts'

type Q = { Querystring: { unit?: string; group?: string; q?: string } }
type P = { Params: { id: string } }
type Per = { Querystring: { period?: string } }

const NOT_FOUND = { block: 'Blok tidak ditemukan di data master.', vehicle: 'Kendaraan tidak ditemukan di data master.' }

export function registerProfileRoutes(app: FastifyInstance, k: Pick<Container, 'profile' | 'dataAccess'> & Partial<Pick<Container, 'profileOps'>>) {
  const scopeOf = (u: User) => k.dataAccess.scopeFor(u)
  /** The record must be inside the caller's scope; otherwise exactly the answer of an unknown id. */
  const authorize = async (req: FastifyRequest, u: User, kind: 'block' | 'vehicle', id: string) => {
    const scope = await scopeOf(u)
    const ref = await k.profile.ref(kind, id)
    const ok = coversRecord(scope, kind === 'block' ? { kind, unitId: ref.unitId, rayonId: ref.rayonId, divisionId: ref.divisionId, ownership: ref.ownership } : { kind, unitId: ref.unitId })
    if (!ok) {
      k.dataAccess.denied(u, scope.kind === 'none' ? 'SCOPE_UNRESOLVED' : 'OUT_OF_SCOPE', `${kind}:${ref.id}`)
      req.log.info({ kind, outOfScope: true }, 'profile record outside data access scope')
      throw new AppError(404, 'PROFILE_NOT_FOUND', NOT_FOUND[kind])
    }
    return ref
  }

  /** List filter of the caller (null = unrestricted); no scope = 403 SCOPE_UNRESOLVED, audited. */
  const listFilter = async (u: User, target: string) => {
    try {
      return profileFilter(await scopeOf(u))
    } catch (e) {
      if (e instanceof AppError) k.dataAccess.denied(u, e.code, target)
      throw e
    }
  }

  app.get('/api/profile/status', async (req) => (requireRole(req), { configured: k.profile.configured }))
  app.get('/api/profile/units', async (req) => {
    const u = requireRole(req)
    return k.profile.units(await listFilter(u, 'profile:units'))
  })
  app.get<Q>('/api/profile/blocks', async (req) => {
    const u = requireRole(req)
    return k.profile.blocks(req.query, await listFilter(u, 'profile:blocks'))
  })
  app.get<P>('/api/profile/blocks/:id', async (req) => {
    const u = requireRole(req)
    await authorize(req, u, 'block', req.params.id)
    return k.profile.block(req.params.id)
  })
  app.get('/api/profile/vehicles/groups', async (req) => (requireRole(req), k.profile.vehicleGroups()))
  app.get<Q>('/api/profile/vehicles', async (req) => {
    const u = requireRole(req)
    return k.profile.vehicles(req.query, await listFilter(u, 'profile:vehicles'))
  })
  app.get<P>('/api/profile/vehicles/:id', async (req) => {
    const u = requireRole(req)
    await authorize(req, u, 'vehicle', req.params.id)
    return k.profile.vehicle(req.params.id)
  })
  const ops = k.profileOps
  if (!ops) return
  app.get<{ Params: { id: string; tab: string } } & Per>('/api/profile/blocks/:id/ops/:tab', async (req) => {
    const u = requireRole(req)
    await authorize(req, u, 'block', req.params.id)
    return ops.block(req.params.id, req.params.tab, req.query.period)
  })
  app.get<P & Per>('/api/profile/vehicles/:id/ops', async (req) => {
    const u = requireRole(req)
    await authorize(req, u, 'vehicle', req.params.id)
    return ops.vehicle(req.params.id, req.query.period)
  })
  app.put<P>('/api/profile/vehicles/:id/card', async (req) => {
    const u = requireRole(req, 'admin')
    await authorize(req, u, 'vehicle', req.params.id)
    return ops.setVehicleCard(req.params.id, req.body, u.id)
  })
  app.put<{ Params: { id: string; period: string } }>('/api/profile/vehicles/:id/costs/:period', async (req) => {
    const u = requireRole(req, 'admin')
    await authorize(req, u, 'vehicle', req.params.id)
    return ops.setVehicleCosts(req.params.id, req.params.period, req.body, u.id)
  })
}
