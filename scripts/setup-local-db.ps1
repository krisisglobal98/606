<#
.SYNOPSIS
  Creates DOD Minimal's own PostgreSQL role and database (from DOD_DB_* in .env) on a local PostgreSQL server.

.DESCRIPTION
  Reads DOD_DB_HOST, DOD_DB_PORT, DOD_DB_NAME, DOD_DB_USER and DOD_DB_PASSWORD from .env, asks for the password of a
  PostgreSQL superuser (never stored, never printed), and creates, only when missing:
    - the login role DOD_DB_USER (no superuser; -AllowProvisioning also grants CREATEDB and CREATEROLE, which no
      script of DOD Minimal needs any more), and
    - the database DOD_DB_NAME owned by that role.
  An existing role only gets its password set to DOD_DB_PASSWORD. Nothing is ever dropped. The tables are created
  later by the DOD API itself (migrations at start).

  Databases and roles of the full DOD installation on the same server are refused (dor_application, dor_upload,
  dod_dashboard_generator, dor_apims_master, dor_webpwadh2, webpwadh1_src, DO_PIMS_REPORT, postgres).

.EXAMPLE
  .\scripts\setup-local-db.ps1
.EXAMPLE
  .\scripts\setup-local-db.ps1 -SuperUser postgres -AllowProvisioning
.EXAMPLE
  .\scripts\setup-local-db.ps1 -RenameFrom dodmin_application
  Renames an existing database of DOD Minimal to DOD_DB_NAME (data kept), only when DOD_DB_NAME does not exist
  yet. Stop the DOD API first: PostgreSQL cannot rename a database that has open connections.
#>
param(
  [string]$SuperUser = 'postgres',
  [switch]$AllowProvisioning,
  [string]$RenameFrom = '',
  [string]$Psql = ''
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Ok($m)   { Write-Host "OK  $m" -ForegroundColor Green }
function Info($m) { Write-Host ">>  $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "ERR $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path .env)) { Fail '.env belum ada. Salin dulu: Copy-Item .env.example .env, lalu isi DOD_DB_PASSWORD.' }
$envMap = @{}
foreach ($line in Get-Content .env -Encoding UTF8) {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=(.*)$') { $envMap[$Matches[1]] = $Matches[2].Trim() }
}
$dbHost = $envMap['DOD_DB_HOST']; $dbPort = $envMap['DOD_DB_PORT']; $dbName = $envMap['DOD_DB_NAME']; $dbUser = $envMap['DOD_DB_USER']; $dbPass = $envMap['DOD_DB_PASSWORD']
if (-not $dbPort) { $dbPort = '5432' }
foreach ($k in 'DOD_DB_HOST', 'DOD_DB_NAME', 'DOD_DB_USER', 'DOD_DB_PASSWORD') { if (-not $envMap[$k]) { Fail "$k belum diisi di .env." } }
if ($dbName -notmatch '^[a-z][a-z0-9_]{0,62}$' -or $dbUser -notmatch '^[a-z][a-z0-9_]{0,62}$') { Fail 'DOD_DB_NAME dan DOD_DB_USER: huruf kecil, angka, _ (mis. dod_application_sit / dodmin).' }
$protected = 'dor_application', 'dor_upload', 'dod_dashboard_generator', 'dor_gis_geometry', 'dor_apims_master', 'dor_webpwadh2', 'webpwadh1_src', 'do_pims_report', 'postgres', 'template0', 'template1'
if ($protected -contains $dbName.ToLower()) { Fail "DOD_DB_NAME=$dbName milik instalasi DOD lengkap atau PostgreSQL; DOD Minimal memakai database sendiri (mis. dod_application_sit)." }
if ($dbUser -in 'postgres', 'dor', 'dod', 'appuser_dev') { Fail "DOD_DB_USER=${dbUser}: pakai role khusus DOD Minimal (mis. dodmin)." }
if ($dbPass.Length -lt 12) { Fail 'DOD_DB_PASSWORD minimal 12 karakter.' }
if ($RenameFrom) {
  if ($RenameFrom -notmatch '^[a-z][a-z0-9_]{0,62}$') { Fail '-RenameFrom: nama database huruf kecil, angka, _.' }
  if ($protected -contains $RenameFrom.ToLower()) { Fail "-RenameFrom $RenameFrom milik instalasi DOD lengkap atau PostgreSQL; tidak boleh di-rename." }
  if ($RenameFrom -eq $dbName) { Fail '-RenameFrom sama dengan DOD_DB_NAME.' }
  $apiPort = $envMap['DOD_API_PORT']; if (-not $apiPort) { $apiPort = '8181' }
  if (Get-NetTCPConnection -State Listen -LocalPort ([int]$apiPort) -ErrorAction SilentlyContinue) { Fail "DOD API masih berjalan di port $apiPort. Hentikan dulu (koneksi terbuka mencegah rename)." }
}

# psql: -Psql, PATH, or the PostgreSQL service's own bin folder.
if (-not $Psql) {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { $Psql = $cmd.Source }
  else {
    $svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'postgresql*' } | Select-Object -First 1
    if ($svc -and $svc.PathName -match '^"?([^"]+\\bin)\\pg_ctl\.exe') { $Psql = Join-Path $Matches[1] 'psql.exe' }
  }
}
if (-not $Psql -or -not (Test-Path $Psql)) { Fail 'psql.exe tidak ditemukan. Pakai -Psql <path>\psql.exe.' }
Ok "psql: $Psql"

$secure = Read-Host "Password superuser PostgreSQL '$SuperUser' di ${dbHost}:$dbPort (tidak disimpan)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  $env:PGCONNECT_TIMEOUT = '10'
  # Values reach SQL only as psql variables (:'name' quotes literals, :"name" quotes identifiers).
  $attrs = if ($AllowProvisioning) { 'NOSUPERUSER CREATEDB CREATEROLE' } else { 'NOSUPERUSER NOCREATEDB NOCREATEROLE' }
  $sql = @"
SELECT format('CREATE ROLE %I LOGIN $attrs PASSWORD %L', :'u', :'p') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'u') \gexec
SELECT format('ALTER ROLE %I LOGIN $attrs PASSWORD %L', :'u', :'p') WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'u') \gexec
SELECT format('ALTER DATABASE %I RENAME TO %I', :'r', :'d') WHERE :'r' <> '' AND EXISTS (SELECT 1 FROM pg_database WHERE datname = :'r') AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'d') \gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', :'d', :'u') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'d') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'d') \gexec
SELECT format('GRANT ALL ON DATABASE %I TO %I', :'d', :'u') \gexec
"@
  $tmp = Join-Path $env:TEMP "dodmin-db-$([guid]::NewGuid()).sql"
  Set-Content -LiteralPath $tmp -Value $sql -Encoding ASCII
  try {
    if ($RenameFrom) { Info "Rename database $RenameFrom menjadi $dbName (bila $dbName belum ada)..." }
    Info "Membuat role $dbUser dan database $dbName (bila belum ada)..."
    & $Psql -h $dbHost -p $dbPort -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -q -v "u=$dbUser" -v "p=$dbPass" -v "d=$dbName" -v "r=$RenameFrom" -f $tmp
    if ($LASTEXITCODE -ne 0) { Fail 'psql gagal (pesan di atas). Periksa password superuser dan bahwa PostgreSQL menerima koneksi TCP.' }
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  # PostgreSQL 15+: the public schema belongs to pg_database_owner, so the owner role can create its tables.
  $env:PGPASSWORD = $dbPass
  & $Psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -At -c 'SELECT current_user, current_database()' | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Login sebagai $dbUser ke $dbName gagal. Periksa pg_hba.conf (host ... scram-sha-256) untuk $dbHost." }
  Ok "Database $dbName siap untuk role $dbUser. Tabel dibuat otomatis saat DOD API start (.\scripts\run.ps1)."
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
