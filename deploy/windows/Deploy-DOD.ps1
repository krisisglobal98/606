<#
.SYNOPSIS
  Installs or updates DOD Minimal on Windows Server / IIS from a release zip (node scripts/package-release.mjs).
  Everything it creates is its own (service DODMIN-API, D:\DODMinimal, IIS site DODMIN, app pool DODMIN, port 8181
  for the API and 8100 for the site), so a full DOD installation on the same server (DOD-API, D:\DOD) is never touched.

.DESCRIPTION
  First run: creates <Root>\{releases,config,logs}, copies the configuration template to
  <Root>\config\dod.env and stops so it can be filled. Next runs:
    1. unpack the release to <Root>\releases\<name> and install the API dependencies (npm ci --omit=dev);
    2. check the configuration with the release's own code (no database write);
    3. stop the service, point <Root>\current to the new release, start the service, wait for /api/health
       (database migrations run here); when the API does not come up, <Root>\current goes back to the previous
       release and that one is started again;
    4. create the IIS sites / app pool once (-ConfigureIis), enable the ARR proxy, keep the last 3 releases.
  Run from an elevated PowerShell. Values of dod.env are never printed.

.EXAMPLE
  .\Deploy-DOD.ps1 -Zip C:\Temp\dodmin-0.1.5-abc1234.zip -ConfigureIis -HostName dodmin.perusahaan.co.id -CertThumbprint 3F...A1 -Nssm C:\Tools\nssm\nssm.exe
.EXAMPLE
  .\Deploy-DOD.ps1 -Zip C:\Temp\dodmin-0.1.5-def5678.zip          # later updates
#>
param(
  [Parameter(Mandatory = $true)][string]$Zip,
  # Default: D:\DODMinimal (DOD.Common.ps1). Never the full DOD installation's D:\DOD.
  [string]$Root = '',
  [string]$Nssm,
  [switch]$ConfigureIis,
  [string]$HostName = '',
  [string]$CertThumbprint = '',
  # Own IIS ports, inside the range opened to the public on this server (8088-8188). Taken there:
  # 8088/8089 (IIS, full DOD installation), 8090 (DOD-API), 8188 (another process), 8181 (DODMIN-API, loopback).
  # The site DODMIN uses HttpPort without -CertThumbprint and HttpsPort with it.
  [int]$HttpPort = 8100,
  [int]$HttpsPort = 8100,
  [string]$ServiceAccount = 'NT AUTHORITY\LocalService',
  # Only for a domain/local user account; built-in accounts (LocalService, NetworkService) have no password.
  [securestring]$ServicePassword,
  [int]$KeepReleases = 3,
  [switch]$SkipNpm
)

. (Join-Path $PSScriptRoot 'DOD.Common.ps1')
Assert-Admin
if (-not $Root) { $Root = $script:DefaultRoot }
if ((Resolve-Path -LiteralPath $Root -ErrorAction SilentlyContinue).Path -eq 'D:\DOD') { Fail '-Root D:\DOD adalah folder instalasi DOD lengkap; DOD Minimal memakai folder sendiri (default D:\DODMinimal).' }
$node = Get-NodeExe
$nssmExe = Get-NssmExe $Nssm
# The service command line carries <Root> unquoted (Windows PowerShell 5.1 mangles quotes passed to native programs).
if ($Root -match '[\s"]') { Fail "-Root tanpa spasi atau tanda kutip, mis. $($script:DefaultRoot) (sekarang: $Root)." }
if (-not (Test-Path $Zip)) { Fail "Zip $Zip tidak ditemukan." }
$Zip = (Resolve-Path $Zip).Path
$name = [IO.Path]::GetFileNameWithoutExtension($Zip)
if ($name -notmatch "^$($script:ReleasePrefix)-[\w.\-]+$") { Fail "Nama zip tidak dikenal ($name); pakai hasil scripts/package-release.mjs ($($script:ReleasePrefix)-<versi>-<commit>.zip)." }

# ---- 1. Folders and configuration
foreach ($d in 'releases', 'config', 'logs') { New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null }
$cfg = Join-Path $Root 'config\dod.env'
if (-not (Test-Path $cfg)) {
  $tmp = Join-Path $env:TEMP "dod-env-$([guid]::NewGuid())"
  Expand-Archive -LiteralPath $Zip -DestinationPath $tmp
  (Get-Content -Raw (Join-Path $tmp 'deploy\windows\dod.env.example')).Replace($script:DefaultRoot, $Root) | Set-Content -Encoding UTF8 -LiteralPath $cfg
  Remove-Item -Recurse -Force $tmp
  & icacls (Join-Path $Root 'config') /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' "${ServiceAccount}:(OI)(CI)R" /Q | Out-Null
  Warn "Konfigurasi baru dibuat: $cfg (hanya Administrators, SYSTEM, $ServiceAccount yang bisa membaca)."
  Warn 'Isi nilainya (database sendiri untuk DOD Minimal, koneksi sumber DOD_DW_*), lalu jalankan skrip ini lagi.'
  return
}
$envMap = Assert-ProductionEnv $cfg
$port = Get-ApiPort $envMap
Ok 'Konfigurasi lengkap (nilai tidak ditampilkan).'

# ---- 2. Unpack and install dependencies
$rel = Join-Path $Root "releases\$name"
if (Test-Path $rel) {
  $active = Get-CurrentRelease $Root
  if ($active -and ((Resolve-Path $active).Path -eq (Resolve-Path $rel).Path)) { Fail "$name sedang aktif. Buat paket rilis baru untuk update." }
  Remove-Item -Recurse -Force $rel
}
Info "Membuka $name ..."
Expand-Archive -LiteralPath $Zip -DestinationPath $rel
if (-not (Test-Path (Join-Path $rel 'server\src\main.ts')) -or -not (Test-Path (Join-Path $rel 'dist\index.html'))) { Fail 'Isi zip tidak lengkap (server\src\main.ts / dist\index.html).' }
if (-not $SkipNpm) {
  Info 'npm ci --omit=dev (butuh akses ke registry npm atau cache npm di server)...'
  Push-Location (Join-Path $rel 'server')
  try { & cmd /c 'npm ci --omit=dev --no-audit --no-fund'; if ($LASTEXITCODE -ne 0) { Fail 'npm ci gagal.' } } finally { Pop-Location }
}
Ok 'Dependency API terpasang.'

# ---- 3. Configuration check with the new release's code (parses dod.env exactly as the API will; nothing is written)
Push-Location (Join-Path $rel 'server')
try {
  $check = "const c = await import('./src/config/config.ts'); const x = c.loadConfig(process.env); c.requireAppDb(x); console.log('config ok: ' + x.metadataDb.database)"
  & $node "--env-file=$cfg" --input-type=module -e $check
  if ($LASTEXITCODE -ne 0) { Fail 'Konfigurasi ditolak oleh rilis baru (pesan di atas). Rilis lama tetap berjalan.' }
} finally { Pop-Location }

# ---- 4. Service (NSSM): node.exe --env-file=<cfg> src\main.ts in <Root>\current\server
$svc = Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
  Info "Memasang service $($script:ServiceName) ..."
  & $nssmExe install $script:ServiceName $node | Out-Null
}
$logs = Join-Path $Root 'logs'
$settings = @(
  @('AppParameters', "--env-file=$cfg src\main.ts"),
  @('AppDirectory', (Join-Path $Root 'current\server')),
  @('DisplayName', 'DOD Minimal API (Daily Operation Discovery)'),
  @('Description', 'DOD Minimal API. Dikelola oleh deploy\windows\Deploy-DOD.ps1.'),
  @('Start', 'SERVICE_AUTO_START'),
  @('AppStdout', (Join-Path $logs 'dodmin-api.log')),
  @('AppStderr', (Join-Path $logs 'dodmin-api.err.log')),
  @('AppRotateFiles', '1'), @('AppRotateOnline', '1'), @('AppRotateBytes', '10485760'),
  @('AppStopMethodConsole', '15000'),
  @('AppExit', 'Default', 'Restart'), @('AppRestartDelay', '5000')
)
foreach ($s in $settings) { & $nssmExe set $script:ServiceName @s | Out-Null; if ($LASTEXITCODE -ne 0) { Fail "nssm set $($s[0]) gagal." } }
# Run as a low-privilege account (set through WMI: PowerShell 5.1 drops empty arguments to native programs).
$pw = ''
if ($ServicePassword) { $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ServicePassword)) }
$change = Get-CimInstance Win32_Service -Filter "Name='$($script:ServiceName)'" | Invoke-CimMethod -MethodName Change -Arguments @{ StartName = $ServiceAccount; StartPassword = $pw }
if ($change.ReturnValue -ne 0) { Fail "Akun service $ServiceAccount tidak bisa dipasang (Win32_Service.Change = $($change.ReturnValue))." }
$pw = $null
# The service account reads the releases and writes logs; nothing else.
Grant-Folder (Join-Path $Root 'releases') $ServiceAccount 'RX'
Grant-Folder $logs $ServiceAccount 'M'

# ---- 5. Switch and start, with automatic rollback
$previous = Get-CurrentRelease $Root
$s = Get-Service -Name $script:ServiceName
if ($s.Status -ne 'Stopped') { Info 'Menghentikan DOD API...'; Stop-Service -Name $script:ServiceName -Force; (Get-Service $script:ServiceName).WaitForStatus('Stopped', '00:00:30') }
Set-CurrentRelease $Root $rel
Info "Menjalankan $name (migrasi database berjalan saat start)..."
Start-Service -Name $script:ServiceName
if (-not (Wait-Health -Port $port -Seconds 120)) {
  Warn "DOD API tidak sehat dalam 120 detik. Lihat $logs\dodmin-api.err.log."
  if ($previous) {
    Stop-Service -Name $script:ServiceName -Force -ErrorAction SilentlyContinue
    Set-CurrentRelease $Root $previous
    Start-Service -Name $script:ServiceName
    if (Wait-Health -Port $port) { Fail "Update dibatalkan: kembali ke $(Split-Path $previous -Leaf) dan berjalan normal." } else { Fail "Update dibatalkan dan rilis sebelumnya juga tidak sehat; periksa log." }
  }
  Fail 'Instalasi pertama gagal start; periksa log dan dod.env.'
}
Ok "DOD API sehat di 127.0.0.1:$port ($name)."

# ---- 6. IIS (once with -ConfigureIis; later runs leave the sites as the administrator keeps them)
Import-Module WebAdministration
$modules = (Get-WebGlobalModule).Name
foreach ($m in 'RewriteModule', 'ApplicationRequestRouting') { if ($modules -notcontains $m) { Warn "Modul IIS $m belum terpasang (URL Rewrite 2.1 / ARR 3). Situs tidak akan berfungsi sampai dipasang." } }
if ($ConfigureIis) {
  # ARR as a reverse proxy: on, host header kept, no response rewriting, long enough for slow analyses and uploads.
  $ps = 'MACHINE/WEBROOT/APPHOST'
  Set-WebConfigurationProperty -PSPath $ps -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true
  Set-WebConfigurationProperty -PSPath $ps -Filter 'system.webServer/proxy' -Name 'preserveHostHeader' -Value $true
  Set-WebConfigurationProperty -PSPath $ps -Filter 'system.webServer/proxy' -Name 'reverseRewriteHostInResponseHeaders' -Value $false
  Set-WebConfigurationProperty -PSPath $ps -Filter 'system.webServer/proxy' -Name 'timeout' -Value '00:03:00'
  Ok 'ARR proxy aktif (timeout 3 menit).'
  # SNI (several certificates on one IP) only with a host name.
  $sni = 0
  if ($HostName) { $sni = 1 }
  if (-not $HostName) { Warn "Tanpa -HostName situs memakai semua alamat pada port $HttpPort / $HttpsPort." }
  $pool = $script:AppPoolName
  if (-not (Test-Path "IIS:\AppPools\$pool")) { New-WebAppPool -Name $pool | Out-Null }
  Set-ItemProperty "IIS:\AppPools\$pool" -Name managedRuntimeVersion -Value ''
  $sites = @(
    @{ Name = $script:SiteName; Path = (Join-Path $Root 'current\dist'); Https = $HttpsPort; Http = $HttpPort }
  )
  # Ports already bound by another IIS site (e.g. the full DOD installation) are refused, not shared.
  $bound = @(Get-WebBinding | ForEach-Object { [int](($_.bindingInformation -split ':')[1]) })
  foreach ($site in $sites) {
    if (-not (Test-Path "IIS:\Sites\$($site.Name)")) {
      $p = if ($CertThumbprint -or -not $site.Http) { $site.Https } else { $site.Http }
      if ($bound -contains $p) { Fail "Port IIS $p sudah dipakai situs lain. Pilih port lain (-HttpPort / -HttpsPort)." }
      if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { Fail "Port $p sudah dipakai proses lain (Get-NetTCPConnection -LocalPort $p). Pilih port lain." }
      if ($p -lt $script:PublicPortMin -or $p -gt $script:PublicPortMax) { Warn "Port $p di luar rentang port publik server ini ($($script:PublicPortMin)-$($script:PublicPortMax)); situs tidak terjangkau dari luar." }
      if ($CertThumbprint) { New-Website -Name $site.Name -PhysicalPath $site.Path -ApplicationPool $pool -Port $site.Https -Ssl -HostHeader $HostName -SslFlags $sni | Out-Null }
      elseif ($site.Http) { New-Website -Name $site.Name -PhysicalPath $site.Path -ApplicationPool $pool -Port $site.Http -HostHeader $HostName | Out-Null }
      else { New-Website -Name $site.Name -PhysicalPath $site.Path -ApplicationPool $pool -Port $site.Https -HostHeader $HostName | Out-Null }
      Ok "Situs IIS $($site.Name) dibuat."
    } else { Set-ItemProperty "IIS:\Sites\$($site.Name)" -Name physicalPath -Value $site.Path }
    if ($CertThumbprint) {
      $b = Get-WebBinding -Name $site.Name -Protocol https -Port $site.Https -ErrorAction SilentlyContinue
      if (-not $b) { New-WebBinding -Name $site.Name -Protocol https -Port $site.Https -HostHeader $HostName -SslFlags $sni; $b = Get-WebBinding -Name $site.Name -Protocol https -Port $site.Https }
      $b.AddSslCertificate($CertThumbprint, 'My')
    }
  }
  if (-not $CertThumbprint) { Warn 'Tanpa -CertThumbprint situs dibuat tanpa HTTPS. Pasang sertifikat lalu jalankan lagi dengan -ConfigureIis -CertThumbprint <thumbprint>.' }
}
Grant-Folder (Join-Path $Root 'releases') 'IIS_IUSRS' 'RX'

# ---- 7. Keep the last releases (the active one and the previous one always stay)
$keep = @((Get-CurrentRelease $Root), $previous) | Where-Object { $_ } | ForEach-Object { (Resolve-Path $_).Path }
Get-ChildItem (Join-Path $Root 'releases') -Directory | Sort-Object LastWriteTime -Descending | Select-Object -Skip $KeepReleases |
  Where-Object { $keep -notcontains $_.FullName } | ForEach-Object { Remove-Item -Recurse -Force $_.FullName; Info "Rilis lama dihapus: $($_.Name)" }

$verify = if ($CertThumbprint) { "https://$(if ($HostName) { $HostName } else { 'localhost' }):$HttpsPort" } else { "http://$(if ($HostName) { $HostName } else { 'localhost' }):$HttpPort" }
Ok "Selesai: $name aktif. Verifikasi: .\Test-DOD.ps1 -BaseUrl $verify"
