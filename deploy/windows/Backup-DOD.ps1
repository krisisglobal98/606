<#
.SYNOPSIS
  Backs up the DOD Minimal application database (pg_dump, custom format) and keeps the last N days.

.DESCRIPTION
  Reads the connection from <Root>\config\dod.env (DOD_DB_*); the password goes to pg_dump through the PGPASSWORD
  variable of this process only and is never written to the log or the command line. Output:
  <Root>\backup\<database>-<yyyyMMdd-HHmm>.dump, readable by Administrators and SYSTEM only. Only the DOD Minimal
  database is dumped; other applications' databases on the same server are never read.

  -Install registers a daily Windows scheduled task (DODMIN-Backup, as SYSTEM) that runs this script.
  -VerifyRestore restores the newest dump into a temporary database, compares the row counts of the main tables with
  the live database, then drops the temporary database (it must not exist before; it is never another database).

.EXAMPLE
  .\Backup-DOD.ps1                       # one backup now
.EXAMPLE
  .\Backup-DOD.ps1 -Install -At 01:30    # daily at 01:30
.EXAMPLE
  .\Backup-DOD.ps1 -VerifyRestore        # restore test of the newest dump
#>
param(
  [string]$Root = '',
  [int]$KeepDays = 14,
  [string]$PgBin = 'D:\PostgreSQL\bin',
  [switch]$Install,
  [string]$At = '01:30',
  [switch]$VerifyRestore
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'DOD.Common.ps1')
Assert-Admin
if (-not $Root) { $Root = $script:DefaultRoot }
$e = Assert-ProductionEnv (Join-Path $Root 'config\dod.env')
foreach ($k in 'DOD_DB_HOST', 'DOD_DB_NAME', 'DOD_DB_USER', 'DOD_DB_PASSWORD') { if (-not $e[$k]) { Fail "$k kosong di dod.env." } }
$db = $e['DOD_DB_NAME']; $dbPort = if ($e['DOD_DB_PORT']) { $e['DOD_DB_PORT'] } else { '5432' }
$dir = Join-Path $Root 'backup'
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
  & icacls $dir /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' /Q | Out-Null
}
$log = Join-Path $dir 'backup.log'
function Log($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"; Add-Content -Path $log -Value $line -Encoding UTF8; Write-Host $line }
foreach ($exe in 'pg_dump.exe', 'pg_restore.exe', 'psql.exe') { if (-not (Test-Path (Join-Path $PgBin $exe))) { Fail "$exe tidak ada di $PgBin (pakai -PgBin)." } }
$common = @('-h', $e['DOD_DB_HOST'], '-p', $dbPort, '-U', $e['DOD_DB_USER'], '-w')
$env:PGPASSWORD = $e['DOD_DB_PASSWORD']

try {
  if ($Install) {
    $self = Join-Path $Root 'backup\Backup-DOD.ps1'
    # The task runs a copy outside the release folders, so a rollback or a cleanup of old releases cannot break it.
    Copy-Item (Join-Path $PSScriptRoot 'Backup-DOD.ps1') $self -Force
    Copy-Item (Join-Path $PSScriptRoot 'DOD.Common.ps1') (Join-Path $Root 'backup\DOD.Common.ps1') -Force
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -Root `"$Root`" -KeepDays $KeepDays -PgBin `"$PgBin`""
    $trigger = New-ScheduledTaskTrigger -Daily -At $At
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName 'DODMIN-Backup' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Ok "Tugas terjadwal DODMIN-Backup: setiap hari $At (SYSTEM), simpan $KeepDays hari, ke $dir."
    return
  }

  if ($VerifyRestore) {
    $dump = Get-ChildItem $dir -Filter "$db-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $dump) { Fail "Belum ada backup di $dir." }
    $tmp = "dodmin_restore_test_$(Get-Date -Format 'yyyyMMddHHmm')"
    $exists = & (Join-Path $PgBin 'psql.exe') @common -d $db -tAc "SELECT 1 FROM pg_database WHERE datname = '$tmp'"
    if ($exists) { Fail "Database $tmp sudah ada; uji restore dibatalkan." }
    & (Join-Path $PgBin 'psql.exe') @common -d $db -c "CREATE DATABASE $tmp" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Tidak bisa membuat database sementara (akun $($e['DOD_DB_USER']) perlu hak CREATEDB)." }
    try {
      & (Join-Path $PgBin 'pg_restore.exe') @common -d $tmp --no-owner --no-privileges $dump.FullName 2>&1 | Out-Null
      $tables = 'dor_user', 'dor_session', 'dor_dataset', 'dor_category', 'dor_saved_report', 'dor_user_access', 'dor_audit', 'dor_migration', 'dor_role_menu'
      $q = ($tables | ForEach-Object { "SELECT '$_', (SELECT count(*) FROM $_)" }) -join ' UNION ALL '
      $live = & (Join-Path $PgBin 'psql.exe') @common -d $db -tAc $q
      $back = & (Join-Path $PgBin 'psql.exe') @common -d $tmp -tAc $q
      Log "Uji restore $($dump.Name) ke $tmp"
      $ok = $true
      foreach ($t in $tables) {
        $l = ($live | Where-Object { $_ -like "$t|*" }) -replace '.*\|', ''
        $b = ($back | Where-Object { $_ -like "$t|*" }) -replace '.*\|', ''
        # Sessions and the audit log keep changing between the dump and now; the others must be equal.
        $same = if ($t -in 'dor_session', 'dor_audit') { [int]$b -gt 0 -and [int]$b -le [int]$l } else { $l -eq $b }
        if (-not $same) { $ok = $false }
        Log ("  {0,-18} live={1,-8} restore={2,-8} {3}" -f $t, $l, $b, $(if ($same) { 'OK' } else { 'BEDA' }))
      }
      if ($ok) { Ok "Uji restore berhasil: semua tabel utama lengkap." } else { Fail 'Uji restore: ada tabel yang tidak cocok (lihat backup.log).' }
    } finally {
      & (Join-Path $PgBin 'psql.exe') @common -d $db -c "DROP DATABASE IF EXISTS $tmp" | Out-Null
      Log "Database sementara $tmp dihapus."
    }
    return
  }

  # ---- one backup
  $file = Join-Path $dir "$db-$(Get-Date -Format 'yyyyMMdd-HHmm').dump"
  $t0 = Get-Date
  & (Join-Path $PgBin 'pg_dump.exe') @common -d $db -Fc -f $file
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $file)) { Log "GAGAL: pg_dump keluar dengan kode $LASTEXITCODE"; Fail 'Backup gagal.' }
  $list = & (Join-Path $PgBin 'pg_restore.exe') --list $file
  if ($LASTEXITCODE -ne 0 -or -not ($list -match 'TABLE DATA')) { Log "GAGAL: arsip $file tidak terbaca"; Fail 'Arsip backup tidak valid.' }
  $old = Get-ChildItem $dir -Filter "$db-*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) }
  $old | Remove-Item -Force
  Log ("OK {0} ({1:N1} MB, {2} objek data, {3:N0} s); dihapus karena > {4} hari: {5}" -f (Split-Path $file -Leaf), ((Get-Item $file).Length / 1MB), @($list -match 'TABLE DATA').Count, ((Get-Date) - $t0).TotalSeconds, $KeepDays, @($old).Count)
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
