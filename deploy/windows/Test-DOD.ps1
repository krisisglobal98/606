<#
.SYNOPSIS
  Verifies a DOD installation on Windows Server / IIS (the automatable part of docs/DEPLOYMENT_WINDOWS.md bagian 5).

.DESCRIPTION
  Read-only: sends GET requests and reads IIS and service settings; it signs in nowhere and changes nothing.
  Checks that need a browser or a second PC (CSP console, login throttle from two PCs, the API port from outside)
  stay manual and are listed at the end.

.EXAMPLE
  .\Test-DOD.ps1 -BaseUrl https://dodmin.perusahaan.co.id:8100
.EXAMPLE
  .\Test-DOD.ps1 -BaseUrl http://localhost:8100      # IIS site without certificate while testing
#>
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  # Default: D:\DODMinimal (DOD.Common.ps1).
  [string]$Root = '',
  [switch]$Insecure
)

. (Join-Path $PSScriptRoot 'DOD.Common.ps1')
if (-not $Root) { $Root = $script:DefaultRoot }
$ErrorActionPreference = 'Continue'
$BaseUrl = $BaseUrl.TrimEnd('/')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
if ($Insecure) { [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }
$results = New-Object System.Collections.ArrayList

function Check([string]$Name, [bool]$Pass, [string]$Detail = '') {
  [void]$results.Add([pscustomobject]@{ Hasil = $(if ($Pass) { 'PASS' } else { 'FAIL' }); Pemeriksaan = $Name; Detail = $Detail })
}
# GET without throwing on 4xx/5xx; returns status, content type, cache header and body.
function Get-Url([string]$Url) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 20 -MaximumRedirection 0
    return @{ Status = [int]$r.StatusCode; Type = [string]$r.Headers['Content-Type']; Cache = [string]$r.Headers['Cache-Control']; Body = [string]$r.Content; Csp = [string]$r.Headers['Content-Security-Policy'] }
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { return @{ Status = 0; Type = ''; Cache = ''; Body = $_.Exception.Message; Csp = '' } }
    $body = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    return @{ Status = [int]$resp.StatusCode; Type = [string]$resp.ContentType; Cache = [string]$resp.Headers['Cache-Control']; Body = $body; Csp = [string]$resp.Headers['Content-Security-Policy'] }
  }
}

# 1-2. IIS modules and ARR proxy
Import-Module WebAdministration -ErrorAction SilentlyContinue
$mods = @((Get-WebGlobalModule -ErrorAction SilentlyContinue).Name)
Check 'Modul URL Rewrite dan ARR' (($mods -contains 'RewriteModule') -and ($mods -contains 'ApplicationRequestRouting'))
$proxy = Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -ErrorAction SilentlyContinue
Check 'ARR proxy aktif' ([bool]($proxy -and $proxy.enabled)) "timeout $($proxy.timeout)"

# 3. Login page
$landing = Get-Url "$BaseUrl/"
Check 'Halaman awal (bukan 500.19)' ($landing.Status -eq 200 -and $landing.Body -match '<div id="root"') "HTTP $($landing.Status)"
Check 'Content-Security-Policy terkirim' ($landing.Csp -match "default-src 'self'")
# 4-5. API through IIS, errors stay JSON
$health = Get-Url "$BaseUrl/api/health"
Check '/api/health lewat IIS' ($health.Status -eq 200 -and $health.Type -match 'json' -and $health.Body -match '"up"') "HTTP $($health.Status) $($health.Type)"
$nope = Get-Url "$BaseUrl/api/tidak-ada"
Check '/api error tetap JSON (bukan index.html)' ($nope.Type -match 'json' -and $nope.Body -notmatch '<html') "HTTP $($nope.Status) $($nope.Type)"
# 6. Deep links
foreach ($p in '/beranda', '/analisis', '/report/operasional', '/data/dataset') {
  $r = Get-Url "$BaseUrl$p"
  Check "Deep link $p" ($r.Status -eq 200 -and $r.Body -match '<div id="root"') "HTTP $($r.Status)"
}
# 7. A missing chunk is 404, not HTML
$chunk = Get-Url "$BaseUrl/assets/tidak-ada.js"
Check 'Chunk yang hilang -> 404' ($chunk.Status -eq 404) "HTTP $($chunk.Status)"
# 8. Caching
$deep = Get-Url "$BaseUrl/analisis"
Check 'index.html tanpa cache (deep link)' ($deep.Cache -match 'no-cache') "Cache-Control: $($deep.Cache)"
$asset = [regex]::Match($landing.Body, '/assets/[^"'']+\.js').Value
if ($asset) { $a = Get-Url "$BaseUrl$asset"; Check 'Aset di-cache 1 tahun' ($a.Cache -match 'max-age=31536000') "Cache-Control: $($a.Cache)" }
# 12. Health of the data warehouse without a session shows only the status
$dw = Get-Url "$BaseUrl/api/health/datawarehouse"
Check 'health/datawarehouse ringkas tanpa login' ($dw.Body -match '"status"' -and $dw.Body -notmatch '"sources"') "HTTP $($dw.Status)"
# 14. Sensitive files
foreach ($p in '/.env', '/web.config') { $r = Get-Url "$BaseUrl$p"; Check "File sensitif $p tidak tersaji" ($r.Status -eq 404) "HTTP $($r.Status)" }
# 10d / 13. API only on loopback, service starts automatically
$cfgPath = Join-Path $Root 'config\dod.env'
$apiPort = $script:DefaultApiPort
if (Test-Path $cfgPath) { $apiPort = Get-ApiPort (Read-EnvFile $cfgPath) }
$listen = @(Get-NetTCPConnection -State Listen -LocalPort $apiPort -ErrorAction SilentlyContinue)
Check "DOD API hanya listen di 127.0.0.1:$apiPort" ($listen.Count -gt 0 -and -not ($listen | Where-Object { $_.LocalAddress -notin '127.0.0.1', '::1' })) (($listen | ForEach-Object { $_.LocalAddress }) -join ', ')
$svc = Get-CimInstance Win32_Service -Filter "Name='$($script:ServiceName)'" -ErrorAction SilentlyContinue
Check "Service $($script:ServiceName) otomatis dan berjalan" ([bool]($svc -and $svc.StartMode -eq 'Auto' -and $svc.State -eq 'Running')) "$($svc.StartMode) / $($svc.State) / $($svc.StartName)"

$results | Format-Table -AutoSize -Wrap
$failed = @($results | Where-Object { $_.Hasil -eq 'FAIL' }).Count
Write-Host ''
Write-Host 'Masih manual (docs\DEPLOYMENT_WINDOWS.md bagian 5): CSP di DevTools saat login/Analisis/Report (#9),'
Write-Host ('throttle login dari dua PC dan X-Forwarded-For palsu (#10a-10c), port ' + $apiPort + ' dari PC lain (#10d), restart server (#13), backup (#15).')
if ($failed) { Warn "$failed pemeriksaan gagal."; exit 1 } else { Ok 'Semua pemeriksaan otomatis lolos.' }
