<#
.SYNOPSIS
  Puts the previous DOD release (or a named one) back in place and restarts the API.

.DESCRIPTION
  Only the code goes back: database migrations are additive (new tables and columns), so an older release keeps
  working on the newer schema. dod.env and the data folders are not touched.

.EXAMPLE
  .\Rollback-DOD.ps1                              # the release deployed before the active one
.EXAMPLE
  .\Rollback-DOD.ps1 -Release dodmin-0.1.5-abc1234   # a specific one from <Root>\releases
#>
param(
  # Default: D:\DODMinimal (DOD.Common.ps1).
  [string]$Root = '',
  [string]$Release
)

. (Join-Path $PSScriptRoot 'DOD.Common.ps1')
Assert-Admin
if (-not $Root) { $Root = $script:DefaultRoot }
$envMap = Assert-ProductionEnv (Join-Path $Root 'config\dod.env')
$port = Get-ApiPort $envMap
$active = Get-CurrentRelease $Root
$all = Get-ChildItem (Join-Path $Root 'releases') -Directory | Sort-Object LastWriteTime -Descending
if ($Release) { $target = $all | Where-Object { $_.Name -eq $Release } | Select-Object -First 1 }
else { $target = $all | Where-Object { -not $active -or $_.FullName -ne (Resolve-Path $active).Path } | Select-Object -First 1 }
if (-not $target) { Fail 'Tidak ada rilis lain untuk dipulihkan.' }
Info "Rilis aktif: $(if ($active) { Split-Path $active -Leaf } else { '-' }); kembali ke: $($target.Name)"

Stop-Service -Name $script:ServiceName -Force -ErrorAction SilentlyContinue
Set-CurrentRelease $Root $target.FullName
Start-Service -Name $script:ServiceName
if (Wait-Health -Port $port) { Ok "$($target.Name) aktif dan sehat." }
else {
  Warn "$($target.Name) tidak sehat; mengembalikan $(Split-Path $active -Leaf)."
  if ($active) { Stop-Service -Name $script:ServiceName -Force -ErrorAction SilentlyContinue; Set-CurrentRelease $Root $active; Start-Service -Name $script:ServiceName }
  Fail "Rollback gagal; periksa $Root\logs\dodmin-api.err.log."
}
