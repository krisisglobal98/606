/**
 * Menu permissions per role (/api/access/*), administrators only (and the menu Settings → Hak Akses Menu).
 *
 *   GET  /api/access/menus         the role × menu matrix with the state and the reason of every cell
 *   PUT  /api/access/menus         save the changed cells: { roles: { viewer: { report: false } } }
 *   POST /api/access/menus/reset   back to the defaults (every menu on inside its ceiling)
 *
 * The onRequest hook checks every signed-in request against the permissions (menus.ts API_RULES). It runs after
 * the session hook and before the body is parsed, so a refused upload is not read.
 */
import type { FastifyInstance } from 'fastify'
import type { Container } from '../container.ts'
import { requireRole } from '../http/server.ts'
import { MenuSaveSchema } from './accessService.ts'

export function registerAccessRoutes(app: FastifyInstance, k: Pick<Container, 'access'>) {
  app.addHook('onRequest', async (req) => {
    if (req.user) await k.access.check(req.user.role, req.method, req.url.split('?')[0] ?? '')
  })
  app.get('/api/access/menus', async (req) => (requireRole(req, 'admin'), k.access.matrix()))
  app.put('/api/access/menus', async (req) => k.access.save(MenuSaveSchema.parse(req.body), requireRole(req, 'admin').id))
  app.post('/api/access/menus/reset', async (req) => k.access.reset(requireRole(req, 'admin').id))
}
