/**
 * Kartu Kendaraan: company mapping and ETL (docs/VEHICLE_PROFILE_ETL.md). Run from server/.
 *
 *   node --env-file=../.env scripts/profile/vehicle-etl.ts map                         show the mapping (changes nothing)
 *   node --env-file=../.env scripts/profile/vehicle-etl.ts map --sync                  store it in dor_company_db
 *   node --env-file=../.env scripts/profile/vehicle-etl.ts run --company PSA --dry-run what would change (changes nothing)
 *   node --env-file=../.env scripts/profile/vehicle-etl.ts run --company PSA [--period 2026-10]
 *
 * Only `map --sync` and `run` without --dry-run write, in DOD's application database. Source databases are only read.
 */
import { loadConfig, requireAppDb } from '../../src/config/config.ts'
import { createContainer } from '../../src/container.ts'
import { createLogger } from '../../src/log/logger.ts'

const [command, ...args] = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

const config = loadConfig()
requireAppDb(config)
const k = createContainer(config, createLogger('warn', false))
let code = 0
try {
  if (command === 'map') {
    if (flag('--sync')) {
      await k.db.migrate()
      console.log(await k.companyDb.sync())
    } else {
      const rows = await k.companyDb.compute()
      console.table(rows.map((r) => ({ kode: r.code, alias: r.alias, database: r.database, ada: r.exists })))
      console.log(`${rows.length} perusahaan, ${rows.filter((r) => r.exists).length} punya database.`)
    }
  } else if (command === 'run') {
    const alias = value('--company')
    if (!alias) throw new Error('Isi --company <alias>, mis. --company PSA.')
    const dryRun = flag('--dry-run')
    if (!dryRun) {
      await k.db.migrate()
      await k.companyDb.sync()
    }
    console.log(await k.vehicleEtl.run({ alias, period: value('--period'), dryRun }))
  } else {
    console.error('Perintah: map [--sync] | run --company <alias> [--period YYYY-MM] [--dry-run]')
    code = 1
  }
} catch (e) {
  console.error((e as Error).message)
  code = 1
}
process.exit(code)
