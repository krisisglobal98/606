# Menjalankan DOD Minimal (Windows PowerShell): DOD API (server\) dan frontend. Backend selalu wajib: tidak ada mode mock.
#
#   .\scripts\run.ps1                 # mode dev (default): backend :8181 + frontend http://localhost:5180
#   .\scripts\run.ps1 backend         # hanya backend (DOD API)
#   .\scripts\run.ps1 preview         # build produksi, backend + sajikan hasilnya, http://localhost:8100
#   .\scripts\run.ps1 build           # hanya build produksi ke folder dist\
#   .\scripts\run.ps1 check           # typecheck + lint + test + build
#   .\scripts\run.ps1 install         # hanya pasang dependency
#   .\scripts\run.ps1 dev -Port 5190 -LanHost -Fresh
#
# Port 8080/8090 sengaja tidak dipakai: itu milik instalasi DOD lengkap (service DOD-API) di server yang sama.
#
# Bila muncul error "running scripts is disabled", jalankan sekali:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

param(
  [ValidateSet('dev', 'backend', 'preview', 'build', 'check', 'install')]
  [string]$Mode = 'dev',
  [int]$Port = 0,
  [switch]$LanHost,
  [switch]$Fresh
)

$ErrorActionPreference = 'Stop'
$RequiredNode = [version]'24.0.0'
Set-Location (Join-Path $PSScriptRoot '..')

function Ok($m)   { Write-Host "OK  $m" -ForegroundColor Green }
function Info($m) { Write-Host ">>  $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "ERR $m" -ForegroundColor Red; exit 1 }
function Run($cmd) { & cmd /c $cmd; if ($LASTEXITCODE -ne 0) { Fail "Perintah gagal: $cmd" } }

# 1. Node.js dan npm
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js belum terpasang. Lihat docs\SETUP.md bagian 'Prasyarat'." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue))  { Fail "npm belum terpasang (biasanya ikut terpasang bersama Node.js)." }
$NodeVersion = [version]((node -p "process.versions.node").Trim())
if ($NodeVersion -lt $RequiredNode) { Fail "Node.js $NodeVersion terlalu lama. Butuh >= $RequiredNode (disarankan versi di .nvmrc: $(Get-Content .nvmrc))." }
Ok "Node.js $NodeVersion, npm $((npm -v).Trim())"

# 2. File konfigurasi .env
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Ok ".env dibuat dari .env.example" }

# 3. Dependency
if ($Fresh -and (Test-Path node_modules)) { Info "Menghapus node_modules (-Fresh)..."; Remove-Item -Recurse -Force node_modules }
$lock = 'node_modules\.package-lock.json'
if (-not (Test-Path $lock) -or (Get-Item package-lock.json).LastWriteTime -gt (Get-Item $lock).LastWriteTime) {
  Info "Memasang dependency (npm ci)..."
  Run "npm ci --no-audit --no-fund"
  Ok "Dependency terpasang"
} else { Ok "Dependency sudah terpasang" }

# 3b. Backend (server\): selalu dipakai
if ($Mode -ne 'build') {
  if ($Fresh -and (Test-Path server\node_modules)) { Remove-Item -Recurse -Force server\node_modules }
  $block = 'server\node_modules\.package-lock.json'
  if (-not (Test-Path $block) -or (Get-Item server\package-lock.json).LastWriteTime -gt (Get-Item $block).LastWriteTime) { Info "Memasang dependency backend..."; Push-Location server; Run "npm ci --no-audit --no-fund"; Pop-Location }
  Ok "Backend siap (butuh PostgreSQL DOD: lihat docs\SETUP.md dan docs\DATABASE_OPERATIONS.md)"
}
$Backend = $null
function Start-Backend {
  $port = (Select-String -Path .env -Pattern '^DOD_API_PORT=(.*)$' -ErrorAction SilentlyContinue | Select-Object -Last 1).Matches.Groups[1].Value
  if (-not $port) { $port = '8181' }
  # Another DOD API on this port would answer the health check while this one fails to start; refuse instead.
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; Fail "Port $port sudah dipakai DOD API lain (mis. run.ps1 di jendela lain). Hentikan proses itu dulu (Get-NetTCPConnection -LocalPort $port), lalu jalankan ulang." } catch { }
  Info "Menjalankan DOD API..."
  $script:Backend = Start-Process -FilePath node -ArgumentList '--env-file-if-exists=../.env', 'src/main.ts' -WorkingDirectory (Join-Path (Get-Location) 'server') -NoNewWindow -PassThru
  # The API listens only after it reached its database (connect + migrations), which can take longer than a few
  # seconds or time out. Wait until /api/health answers, so the frontend never starts against a dead API.
  for ($i = 0; $i -lt 60; $i++) {
    if ($script:Backend.HasExited) { Fail "DOD API gagal start (lihat pesan di atas). Bila pesannya 'connection timeout': database DOD tidak terjangkau - periksa VPN/jaringan kantor, atau DOD_DB_* di .env (docs\DATABASE_CONNECTION.md)." }
    try { Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; Ok "DOD API siap di port $port"; Watch-Backend; return } catch { Start-Sleep -Seconds 1 }
  }
  Fail "DOD API belum siap setelah 60 detik. Periksa pesan di atas (database metadata, .env)."
}

# While the frontend runs, say so loudly when the API stops: every page then fails to load data.
function Watch-Backend {
  $script:Backend.EnableRaisingEvents = $true
  Register-ObjectEvent -InputObject $script:Backend -EventName Exited -Action { Write-Host "`nERR DOD API berhenti. Semua halaman tidak dapat memuat data sampai API berjalan lagi. Lihat pesan error di atas, lalu hentikan (Ctrl+C) dan jalankan ulang .\scripts\run.ps1." -ForegroundColor Red } | Out-Null
}

# 4. Jalankan
$extra = @()
if ($Port -gt 0) { $extra += "--port $Port" }
if ($LanHost) { $extra += '--host' }
$extra = $extra -join ' '

switch ($Mode) {
  'install' { Ok "Selesai." }
  'dev'     {
    Start-Backend
    try { Info "Frontend dev. Login dengan akun DOD (DOD_ADMIN_* di .env). Hentikan dengan Ctrl+C."; Run "npx vite $extra" } finally { if ($Backend -and -not $Backend.HasExited) { Stop-Process -Id $Backend.Id } }
  }
  'backend' { Push-Location server; try { Run "node --env-file-if-exists=../.env src/main.ts" } finally { Pop-Location } }
  'build'   { Info "Build produksi..."; Run "npm run build"; Ok "Hasil build ada di folder dist\" }
  'preview' {
    Info "Build produksi..."; Run "npm run build"; Start-Backend
    try { Info "Menyajikan hasil build. Login dengan akun DOD. Hentikan dengan Ctrl+C."; Run "npx vite preview $extra" } finally { if ($Backend -and -not $Backend.HasExited) { Stop-Process -Id $Backend.Id } }
  }
  'check'   { Info "Typecheck..."; Run "npm run typecheck"; Push-Location server; Run "npm run typecheck"; Pop-Location; Info "Lint..."; Run "npm run lint"; Info "Test..."; Run "npm test"; Push-Location server; Run "npm test"; Pop-Location; Info "Build..."; Run "npm run build"; Ok "Semua pemeriksaan lolos" }
}
