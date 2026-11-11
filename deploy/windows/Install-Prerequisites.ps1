<#
.SYNOPSIS
  Checks (and where possible installs) what DOD needs on Windows Server: IIS roles, URL Rewrite, ARR, Node.js 24, NSSM.

.DESCRIPTION
  Installs the IIS roles with Install-WindowsFeature. URL Rewrite, ARR, Node.js and NSSM are separate downloads
  (often blocked on servers without internet): the script names what is missing and where to get it, and installs
  an .msi when -Installers points to a folder that holds it. Run again until everything is OK.

.EXAMPLE
  .\Install-Prerequisites.ps1
.EXAMPLE
  .\Install-Prerequisites.ps1 -Installers C:\Installers     # rewrite_amd64_en-US.msi, requestRouter_amd64.msi, node-v24.*-x64.msi
#>
param([string]$Installers = '')

. (Join-Path $PSScriptRoot 'DOD.Common.ps1')
Assert-Admin
$missing = 0

# ---- IIS roles (static files, default document, compression, request filtering, management tools)
$features = 'Web-Server', 'Web-Static-Content', 'Web-Default-Doc', 'Web-Http-Errors', 'Web-Http-Logging', 'Web-Stat-Compression', 'Web-Filtering', 'Web-Mgmt-Console', 'Web-Scripting-Tools'
if (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue) {
  $todo = $features | Where-Object { -not (Get-WindowsFeature $_).Installed }
  if ($todo) { Info "Memasang fitur IIS: $($todo -join ', ')"; Install-WindowsFeature -Name $todo | Out-Null }
  Ok 'Fitur IIS terpasang.'
} else { Warn 'Install-WindowsFeature tidak tersedia (bukan Windows Server?). Pasang IIS lewat Windows Features.' }

function Install-Msi([string]$Pattern, [string]$Label) {
  if (-not $Installers) { return $false }
  $f = Get-ChildItem -Path $Installers -Filter $Pattern -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $f) { return $false }
  Info "Memasang $Label dari $($f.Name) ..."
  $p = Start-Process msiexec.exe -ArgumentList '/i', "`"$($f.FullName)`"", '/qn', '/norestart' -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { Warn "$Label gagal dipasang (msiexec $($p.ExitCode))."; return $false }
  return $true
}

# ---- URL Rewrite 2.1 and ARR 3 (IIS modules)
Import-Module WebAdministration
$mods = (Get-WebGlobalModule).Name
if ($mods -notcontains 'RewriteModule') { [void](Install-Msi 'rewrite_*amd64*.msi' 'URL Rewrite 2.1'); $mods = (Get-WebGlobalModule).Name }
if ($mods -contains 'RewriteModule') { Ok 'URL Rewrite terpasang.' } else { $missing++; Warn 'URL Rewrite 2.1 belum ada: https://www.iis.net/downloads/microsoft/url-rewrite (rewrite_amd64_en-US.msi).' }
if ($mods -notcontains 'ApplicationRequestRouting') { [void](Install-Msi 'requestRouter*.msi' 'ARR 3'); $mods = (Get-WebGlobalModule).Name }
if ($mods -contains 'ApplicationRequestRouting') { Ok 'Application Request Routing terpasang.' } else { $missing++; Warn 'ARR 3 belum ada: https://www.iis.net/downloads/microsoft/application-request-routing (requestRouter_amd64.msi; butuh URL Rewrite lebih dulu).' }

# ---- Node.js 24
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { if (Install-Msi 'node-v24*-x64.msi' 'Node.js 24') { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $nodeCmd = Get-Command node -ErrorAction SilentlyContinue } }
if ($nodeCmd) {
  $v = [version]((& $nodeCmd.Source -p 'process.versions.node').Trim())
  if ($v -ge $script:RequiredNode) { Ok "Node.js $v" } else { $missing++; Warn "Node.js $v terlalu lama; pasang 24 LTS (https://nodejs.org/)." }
} else { $missing++; Warn 'Node.js 24 LTS belum ada: https://nodejs.org/ (node-v24.x.x-x64.msi).' }

# ---- NSSM (runs the API as a Windows service)
if (Get-Command nssm -ErrorAction SilentlyContinue) { Ok 'NSSM ada di PATH.' }
elseif (Test-Path 'C:\Tools\nssm\nssm.exe') { Ok 'NSSM di C:\Tools\nssm\nssm.exe (pakai -Nssm saat Deploy-DOD.ps1).' }
else { $missing++; Warn 'NSSM belum ada: https://nssm.cc/download, salin win64\nssm.exe ke C:\Tools\nssm\.' }

# ---- Reachability of the database server named in dod.env, if it is already filled
$cfg = Join-Path $script:DefaultRoot 'config\dod.env'
if (Test-Path $cfg) {
  $e = Read-EnvFile $cfg
  if ($e['DOD_DB_HOST']) {
    $dbPort = 5432
    if ($e['DOD_DB_PORT']) { $dbPort = [int]$e['DOD_DB_PORT'] }
    if ((Test-NetConnection -ComputerName $e['DOD_DB_HOST'] -Port $dbPort -WarningAction SilentlyContinue).TcpTestSucceeded) { Ok "Server database $($e['DOD_DB_HOST']):$dbPort terjangkau." }
    else { $missing++; Warn "Server database $($e['DOD_DB_HOST']):$dbPort tidak terjangkau dari server ini (firewall/VPN)." }
  }
}

if ($missing) { Warn "$missing prasyarat belum lengkap."; exit 1 } else { Ok 'Semua prasyarat lengkap. Lanjut: .\Deploy-DOD.ps1 -Zip <zip> -ConfigureIis ...' }
