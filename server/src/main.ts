/** DOD API entry point. */
import { ConfigError, loadConfig, requireAppDb } from './config/config.ts'
import { createContainer } from './container.ts'
import { createServer } from './http/server.ts'
import { registerRoutes } from './http/routes.ts'
import { createLogger } from './log/logger.ts'

/** Longest a shutdown may take before the process exits anyway. */
const SHUTDOWN_LIMIT_MS = 15_000

async function main() {
  let config
  try {
    config = loadConfig()
    requireAppDb(config)
  } catch (e) {
    // Config messages name variables, never their values.
    console.error(e instanceof ConfigError ? e.message : 'Konfigurasi gagal dibaca.')
    process.exit(1)
  }
  const log = createLogger(config.logLevel, config.env === 'development')
  const k = createContainer(config, log)
  log.info({ database: config.metadataDb.database }, 'DOD application database (DOD_DB_*)')
  if (config.skippedConnections.length)
    log.warn({ prefixes: config.skippedConnections }, 'DOD_DW_CONNECTIONS lists prefixes without any DOD_DW_<PREFIX>_* variable; they are ignored')

  await k.db.migrate()
  await k.auth.ensureAdmin()
  await k.dw.syncFromConfig()
  // Grants / revocations of unrestricted_data since the last start go to the audit log.
  await k.dataAccess.syncUnrestrictedAudit()
  const da = config.dataAccess
  log.info(
    { orgMasterConfigured: !!config.orgDb, regionSource: da.regionSource, wilayahNodes: da.wilayahNodeIds.length, gmkHeaders: da.gmkHeaderIds.length, unrestricted: da.unrestrictedUsers.length, managers: da.managers.length, cacheSeconds: da.cacheMs / 1000 },
    'data access configuration',
  )
  if (!config.orgDb) log.warn('DOD_ORG_DB_* not set: users without unrestricted_data get no report data (fail-closed)')

  const app = createServer(config, log, k.auth)
  registerRoutes(app, k)
  await app.listen({ host: config.api.host, port: config.api.port })

  // Shutdown: once (a second signal is ignored), every step on its own (one failing step never skips the others), the
  // application database last (the query log is written to it), and a hard limit so a hung pool cannot keep the
  // service from stopping.
  let stopping = false
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      log.warn({ step: name, code: (e as { code?: string }).code }, 'shutdown step failed')
    }
  }
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info({ signal }, 'shutting down')
    const limit = setTimeout(() => {
      log.error({ signal }, 'shutdown did not finish in time; exiting')
      process.exit(1)
    }, SHUTDOWN_LIMIT_MS)
    limit.unref()
    await step('http', () => app.close())
    await step('queryLog', () => k.queryLog.flush())
    await step('sources', () => k.sources.closeAll())
    await step('blockBudget', () => k.blockBudget.close())
    await step('profile', () => k.profile.close())
    await step('profileUnits', () => k.profileUnits.close())
    await step('orgMaster', () => k.orgMaster.close())
    await step('db', () => k.db.close())
    process.exit(0)
  }
  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
}

main().catch((e: unknown) => {
  console.error('DOD API gagal start:', (e as { code?: string; message?: string }).code ?? (e as Error).message)
  process.exit(1)
})
