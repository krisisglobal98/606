# Shared helpers of the DOD Windows / IIS scripts (dot-sourced). Windows PowerShell 5.1 compatible.

$ErrorActionPreference = 'Stop'
# DOD Minimal runs next to the full DOD installation (service DOD-API, D:\DOD, IIS sites DOD / DOD-Publish,
# ports 8080/8090, 8088/8089). Every name and port below is its own, so installing or updating one never touches the other.
$script:ServiceName = 'DODMIN-API'
$script:DefaultRoot = 'D:\DODMinimal'
$script:SiteName = 'DODMIN'
$script:AppPoolName = 'DODMIN'
$script:DefaultApiPort = 8181
# Ports opened to the public on this server. The public site (DODMIN 8100) must be inside it; the API listens on
# 127.0.0.1 only.
$script:PublicPortMin = 8088
$script:PublicPortMax = 8188
# Release zips from scripts/package-release.mjs: dodmin-<version>-<commit>.zip
$script:ReleasePrefix = 'dodmin'
$script:RequiredNode = [version]'24.0.0'
# Keys the API needs in production (values are never printed).
$script:RequiredKeys = @('NODE_ENV', 'DOD_DB_HOST', 'DOD_DB_NAME', 'DOD_DB_USER', 'DOD_DB_PASSWORD', 'DOD_TRUSTED_PROXIES')

function Ok($m)   { Write-Host "OK   $m" -ForegroundColor Green }
function Info($m) { Write-Host ">>   $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "WARN $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "ERR  $m" -ForegroundColor Red; throw $m }

function Assert-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'Jalankan PowerShell sebagai Administrator.' }
}

function Get-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { Fail 'Node.js belum terpasang (butuh 24 LTS): https://nodejs.org/' }
  $v = [version]((& $cmd.Source -p 'process.versions.node').Trim())
  if ($v -lt $script:RequiredNode) { Fail "Node.js $v terlalu lama; butuh >= $($script:RequiredNode)." }
  return $cmd.Source
}

function Get-NssmExe([string]$Hint) {
  if ($Hint -and (Test-Path $Hint)) { return (Resolve-Path $Hint).Path }
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  Fail 'NSSM tidak ditemukan. Unduh dari https://nssm.cc/download, salin nssm.exe (win64) ke C:\Tools\nssm\, lalu pakai -Nssm C:\Tools\nssm\nssm.exe atau tambahkan ke PATH.'
}

# KEY=VALUE lines (comments and blanks ignored; surrounding quotes removed). Values stay in memory only.
function Read-EnvFile([string]$Path) {
  $h = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Z0-9_]+)\s*=(.*)$') { continue }
    $v = $Matches[2].Trim()
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
    $h[$Matches[1]] = $v
  }
  # An env file from before the DOD rename keeps working: DOR_x is read as DOD_x unless DOD_x is set.
  foreach ($k in @($h.Keys)) { if ($k -like 'DOR_*' -and -not $h.ContainsKey("DOD_$($k.Substring(4))")) { $h["DOD_$($k.Substring(4))"] = $h[$k] } }
  return $h
}

function Assert-ProductionEnv([string]$Path) {
  if (-not (Test-Path $Path)) { Fail "File konfigurasi $Path tidak ada." }
  $e = Read-EnvFile $Path
  $missing = @($script:RequiredKeys | Where-Object { -not $e.ContainsKey($_) -or -not $e[$_] })
  if ($missing.Count) { Fail "Isi dulu di ${Path}: $($missing -join ', ')" }
  if ($e['NODE_ENV'] -ne 'production') { Fail 'NODE_ENV harus production.' }
  Assert-OwnPorts $e
  if ($e.ContainsKey('DOD_DB_TARGET') -and $e['DOD_DB_TARGET']) { Fail 'DOD_DB_TARGET tidak dipakai lagi: isi satu set DOD_DB_* saja.' }
  if ($e.ContainsKey('DOD_API_HOST') -and $e['DOD_API_HOST'] -and $e['DOD_API_HOST'] -ne '127.0.0.1') { Warn "DOD_API_HOST=$($e['DOD_API_HOST']): API sebaiknya hanya listen di 127.0.0.1 (IIS yang meneruskan)." }
  return $e
}

function Get-ApiPort($envMap) { if ($envMap.ContainsKey('DOD_API_PORT') -and $envMap['DOD_API_PORT']) { return [int]$envMap['DOD_API_PORT'] } else { return $script:DefaultApiPort } }

# Refuses the ports of the full DOD installation: two APIs on one port would answer each other's health checks.
function Assert-OwnPorts($envMap) {
  $api = Get-ApiPort $envMap
  if ($api -in 8080, 8090) { Fail "DOD_API_PORT=${api}: port 8080/8090 milik instalasi DOD lengkap (DOD-API). Pakai $($script:DefaultApiPort)." }
}

# Waits until the API answers /api/health with status "up".
function Wait-Health([int]$Port, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$Port/api/health"
      if ($r.StatusCode -eq 200 -and $r.Content -match '"status"\s*:\s*"up"') { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

# Root\current is a directory junction to the active release, so IIS and the service never change their paths.
function Get-CurrentRelease([string]$Root) {
  $cur = Join-Path $Root 'current'
  if (-not (Test-Path $cur)) { return $null }
  $item = Get-Item -LiteralPath $cur -Force
  if ($item.LinkType -ne 'Junction') { Fail "$cur ada tetapi bukan junction; pindahkan dulu." }
  return [string]($item.Target | Select-Object -First 1)
}

function Set-CurrentRelease([string]$Root, [string]$Target) {
  $cur = Join-Path $Root 'current'
  if (Test-Path $cur) { (Get-Item -LiteralPath $cur -Force).Delete() }
  New-Item -ItemType Junction -Path $cur -Target $Target | Out-Null
}

function Restart-DodService([int]$Port) {
  $s = Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
  if (-not $s) { Fail "Service $($script:ServiceName) belum terpasang (jalankan Deploy-DOD.ps1)." }
  if ($s.Status -ne 'Stopped') { Stop-Service -Name $script:ServiceName -Force; (Get-Service $script:ServiceName).WaitForStatus('Stopped', '00:00:30') }
  Start-Service -Name $script:ServiceName
  return (Wait-Health -Port $Port)
}

# Grants an account rights on a folder (inherited by its contents).
function Grant-Folder([string]$Path, [string]$Account, [string]$Rights) {
  & icacls $Path /grant "${Account}:(OI)(CI)$Rights" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { Warn "icacls gagal untuk $Path ($Account $Rights)." }
}
