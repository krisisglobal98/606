/**
 * User management (/api/users/*) and data access assignments (/api/users/:id/access, /api/org/*).
 *
 *   GET  /api/users, /api/users/:id    admin: list / detail (never password_hash)
 *   POST /api/users                    admin: create (identity, role, initial password)
 *   PUT  /api/users/:id                admin: edit, deactivate/reactivate, optional password reset
 *   GET  /api/users/:id/access         admin or access manager: the user's assignments and their validity
 *   PUT  /api/users/:id/access         access manager only, never on their own account: replace the assignments
 *   GET  /api/org/options?level=&parent=   admin or access manager: organizations to assign (read from PIMS)
 *   GET  /api/org/status               admin or access manager: master reachability and configured levels
 *   POST /api/org/reload               admin or access manager: drop the organization snapshot (audited)
 *
 * Separation of duties (K-10): the admin role manages the application; an access manager
 * (DOD_DATA_ACCESS_MANAGERS) changes assignments; unrestricted_data (DOD_DATA_UNRESTRICTED_USERS) gives
 * unrestricted data access. None of them implies another.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Container } from '../container.ts'
import { PutAssignmentsSchema } from '../dataAccess/dataAccessService.ts'
import { ORG_LEVELS } from '../dataAccess/scope.ts'
import { forbidden } from '../http/errors.ts'
import { requireRole } from '../http/server.ts'
import { UserCreateSchema, UserUpdateSchema } from './model.ts'

const OptionsQuery = z.object({ level: z.enum([...ORG_LEVELS, 'RAYON', 'DIVISION', 'OWNERSHIP']), parent: z.string().regex(/^\d{1,20}$/).optional() })

export function registerUserRoutes(app: FastifyInstance, k: Container) {
  /** Admin or access manager (reading assignments and organization options). */
  const adminOrManager = (req: FastifyRequest) => {
    const u = requireRole(req)
    if (u.role !== 'admin' && !k.dataAccess.isManager(u)) throw forbidden()
    return u
  }

  app.get('/api/users', async (req) => (requireRole(req, 'admin'), k.users.list()))
  app.get<{ Params: { id: string } }>('/api/users/:id', async (req) => (requireRole(req, 'admin'), k.users.get(req.params.id)))
  app.post('/api/users', async (req, reply) => {
    const u = requireRole(req, 'admin')
    return reply.code(201).send(await k.users.create(UserCreateSchema.parse(req.body), u.id))
  })
  app.put<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const u = requireRole(req, 'admin')
    return k.users.update(req.params.id, UserUpdateSchema.parse(req.body), u.id)
  })

  app.get<{ Params: { id: string } }>('/api/users/:id/access', async (req) => {
    const u = adminOrManager(req)
    return { ...(await k.dataAccess.listAssignments(req.params.id)), canEdit: k.dataAccess.isManager(u) && u.id !== req.params.id }
  })
  app.put<{ Params: { id: string } }>('/api/users/:id/access', async (req) => {
    const u = requireRole(req)
    const body = PutAssignmentsSchema.parse(req.body)
    return { ...(await k.dataAccess.putAssignments(u, req.params.id, body.assignments)), canEdit: true }
  })

  app.get('/api/org/options', async (req) => {
    adminOrManager(req)
    const q = OptionsQuery.parse(req.query)
    return k.dataAccess.options(q.level, q.parent ?? null)
  })
  app.get('/api/org/status', async (req) => (adminOrManager(req), k.dataAccess.status()))
  app.post('/api/org/reload', async (req) => {
    const u = adminOrManager(req)
    k.dataAccess.snapshots.invalidate()
    await k.db.query('INSERT INTO dor_audit (user_id, action, target) VALUES ($1, $2, $3)', [u.id, 'org.reload', 'dor_apims_master'])
    return k.dataAccess.status()
  })
}
