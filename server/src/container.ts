/**
 * Composition root (dependency injection by constructor). Every service receives its collaborators
 * here; nothing reaches for globals, so a different QueryEngine can be swapped in later.
 * Source metadata is routed per connection type (PostgreSQL, ClickHouse, MySQL, MongoDB, Redis).
 */
import { readFileSync } from 'node:fs'
import { AnalyticsService } from './analytics/analyticsService.ts'
import { ResultCache } from './analytics/resultCache.ts'
import { AuthService } from './auth/authService.ts'
import { LoginLimiter } from './auth/loginLimiter.ts'
import { CategoryService } from './categories/categoryService.ts'
import type { Config } from './config/config.ts'
import { DatasetService } from './datasets/datasetService.ts'
import { MetadataDb } from './db/metadataDb.ts'
import { ClickHouseMetadataService } from './dw/clickhouseMetadataService.ts'
import { DataWarehouseService } from './dw/dataWarehouseService.ts'
import { MetadataService } from './dw/metadata.ts'
import { MongoMetadataService } from './dw/mongoMetadataService.ts'
import { MysqlMetadataService } from './dw/mysqlMetadataService.ts'
import { PostgresMetadataService } from './dw/postgresMetadataService.ts'
import { RedisMetadataService } from './dw/redisMetadataService.ts'
import { SourceQueryService } from './dw/sourceQueryService.ts'
import { SourceRegistry } from './dw/sourceRegistry.ts'
import { DataAccessService } from './dataAccess/dataAccessService.ts'
import { OrgMasterReader } from './dataAccess/orgMaster.ts'
import type { Logger } from './log/logger.ts'
import { SavedReportService } from './reports/savedReportService.ts'
import { AccessService } from './access/accessService.ts'
import { BlockBudget } from './profile/blockBudget.ts'
import { CompanyDbMap } from './profile/companyDb.ts'
import { ProfileOps } from './profile/ops.ts'
import { VehicleEtl } from './profile/vehicleEtl.ts'
import { ProfileService } from './profile/profileService.ts'
import { UnitSources } from './profile/unitSource.ts'
import { QueryLog } from './log/queryLog.ts'
import { UserService } from './users/userService.ts'

/** API version reported by /api/health: the one in server/package.json. */
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

export function createContainer(config: Config, log: Logger) {
  const db = new MetadataDb(config, log)
  const queryLog = new QueryLog(db, log)
  const sources = new SourceRegistry(config, log, queryLog)
  const meta = new MetadataService(
    new PostgresMetadataService(sources, config),
    new ClickHouseMetadataService(sources, config),
    { mysql: new MysqlMetadataService(sources, config), mongodb: new MongoMetadataService(sources, config), redis: new RedisMetadataService(sources) },
  )
  const query = new SourceQueryService(sources, config)
  const dw = new DataWarehouseService(db, sources, meta, log)
  const datasets = new DatasetService(db, dw, sources, meta, config)
  // Data access scope: organization reference (read-only role) + assignments; every data path uses it.
  const orgMaster = new OrgMasterReader(config, log)
  const dataAccess = new DataAccessService(db, config, log, orgMaster.load)
  // One bounded result cache for Analisis and grid (key: dataset version + access scope + request).
  const resultCache = new ResultCache(config.limits.resultCacheMs)
  const analytics = new AnalyticsService(datasets, query, config, dataAccess, resultCache)
  const auth = new AuthService(db, config, log)
  const loginLimiter = new LoginLimiter(config.auth.loginLimit)
  const categories = new CategoryService(db)
  const savedReports = new SavedReportService(db, categories)
  const access = new AccessService(db, log)
  const blockBudget = new BlockBudget(config)
  const users = new UserService(db)
  const profile = new ProfileService(config, log)
  const profileUnits = new UnitSources(config, log, async () => (await profile.read<{ datname: string }>('SELECT datname FROM pg_database WHERE NOT datistemplate')).map((r) => r.datname))
  const companyDb = new CompanyDbMap(profile, db)
  const profileOps = new ProfileOps(profile, profileUnits, db, companyDb, blockBudget)
  const vehicleEtl = new VehicleEtl(profile, profileUnits, companyDb, db)
  return { version: VERSION, config, log, db, queryLog, sources, meta, query, dw, datasets, orgMaster, dataAccess, resultCache, analytics, auth, access, loginLimiter, categories, savedReports, blockBudget, users, profile, profileUnits, profileOps, companyDb, vehicleEtl }
}

export type Container = ReturnType<typeof createContainer>
