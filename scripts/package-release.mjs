// Builds a DOD Minimal release for Windows Server / IIS (docs/DEPLOYMENT_WINDOWS.md) into
// release/dodmin-<version>-<commit>.zip (the prefix keeps it apart from the full DOD installation's dod-*.zip).
//
//   node scripts/package-release.mjs            # checks, build, package (refuses a dirty working tree)
//   node scripts/package-release.mjs --allow-dirty --skip-checks
//
// Without a Git repository the commit is "nogit" (allowed only with --allow-dirty).
// The zip holds what the server runs, never secrets or dependencies:
//   dist/             frontend build (with web.config)        server/      DOD API source, package*.json, migrations, scripts
//   deploy/windows/   install / update / rollback / verify scripts            RELEASE.json   version, commit, build time
// node_modules is installed on the server (`npm ci --omit=dev`), never shipped in the zip.
import { execFileSync, execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = new Set(process.argv.slice(2))
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })
const out = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
const fail = (m) => {
  console.error(`ERR ${m}`)
  process.exit(1)
}

let git = true
try { out('git rev-parse --is-inside-work-tree') } catch { git = false }
if (!git && !args.has('--allow-dirty')) fail('Belum ada repository Git: rilis harus bisa ditelusuri ke satu commit (atau --allow-dirty untuk paket uji).')
const dirty = git ? out('git status --porcelain') : 'nogit'
if (dirty && !args.has('--allow-dirty')) fail('Working tree belum bersih: commit dulu (atau --allow-dirty untuk paket uji). Rilis harus bisa ditelusuri ke satu commit.')
const commit = git ? out('git rev-parse --short HEAD') + (dirty ? '-dirty' : '') : 'nogit'
const version = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8')).version
const name = `dodmin-${version}-${commit}`

if (!args.has('--skip-checks')) {
  console.log('>> typecheck, lint, tests')
  sh('npm run lint')
  sh('npx tsc --noEmit -p server')
  sh('npm test')
  sh('npm test --prefix server')
}
console.log('>> build frontend')
sh('npm run build')
if (!existsSync(join(root, 'dist/web.config'))) fail('dist/web.config tidak ada (seharusnya tersalin dari public/web.config).')

const stage = join(root, 'release', name)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const copy = (from, to = from, filter = () => true) => cpSync(join(root, from), join(stage, to), { recursive: true, filter: (src) => filter(src.slice(root.length + 1).split(/[\\/]/).join('/')) })
const SKIP = /(^|\/)(node_modules|\.DS_Store|\.env(\..*)?|data|coverage)(\/|$)/
copy('dist')
copy('server', 'server', (p) => !SKIP.test(p.replace(/^server\//, '')) && !/^server\/test(\/|$)/.test(p))
copy('deploy/windows', 'deploy/windows')
copy('.env.example', 'deploy/windows/.env.example')
writeFileSync(join(stage, 'RELEASE.json'), JSON.stringify({ name, version, commit, builtAt: new Date().toISOString(), node: '>=24' }, null, 2))

const zip = join(root, 'release', `${name}.zip`)
rmSync(zip, { force: true })
if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}'`], { stdio: 'inherit' })
else execFileSync('zip', ['-qr', zip, '.'], { cwd: stage, stdio: 'inherit' })
rmSync(stage, { recursive: true, force: true })
console.log(`OK  ${zip} (${(statSync(zip).size / 1048576).toFixed(1)} MB)`)
console.log('    Salin ke server, lalu (PowerShell sebagai Administrator): .\\deploy\\windows\\Deploy-DOD.ps1 -Zip <zip>')
