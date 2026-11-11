/**
 * Report → Laporan Operasional (/api/saved-reports): Analysis layouts saved under a name and a category.
 * Every signed-in user may list and save; removing needs the owner or an administrator.
 * (Laporan PDF — reports, templates, Blast, history, recipients, SMTP — was removed from DOD Minimal.)
 */
import type { FastifyInstance } from 'fastify'
import type { Container } from '../container.ts'
import { requireRole } from '../http/server.ts'
import { CreateSavedReportSchema } from './savedReportService.ts'

type P = { Params: { id: string } }

export function registerReportRoutes(app: FastifyInstance, k: Container) {
  app.get('/api/saved-reports', async (req) => (requireRole(req), k.savedReports.list()))
  app.post('/api/saved-reports', async (req, reply) => reply.code(201).send(await k.savedReports.create(CreateSavedReportSchema.parse(req.body), requireRole(req).id)))
  app.delete<P>('/api/saved-reports/:id', async (req, reply) => (await k.savedReports.remove(req.params.id, requireRole(req)), reply.code(204).send()))
}
