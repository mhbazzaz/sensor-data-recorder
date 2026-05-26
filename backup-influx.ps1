$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupRoot = Join-Path $ProjectRoot "backups\influxdb"
$BackupDir = Join-Path $BackupRoot "latest"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ContainerName = "influxdb"
$ContainerBackupDir = "/tmp/influxdb-backup-$Timestamp"

$InfluxToken = "SuperToken123456"
$InfluxOrg = "MohammadOrg"
$InfluxBucket = "FactoryMetrics"

function Invoke-DockerCapture {
    param(
        [string[]]$Arguments
    )

    $Output = & docker @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed" }
    return ($Output -join "`n").Trim()
}

function Invoke-DockerQuiet {
    param(
        [string[]]$Arguments
    )

    & docker @Arguments > $null 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed" }
}

Write-Host ""
Write-Host "╔═══════════════════════════════════════════╗"
Write-Host "║          InfluxDB Backup Utility          ║"
Write-Host "╚═══════════════════════════════════════════╝"
Write-Host ""

try {
    Invoke-DockerQuiet -Arguments @("info")
} catch {
    Write-Host "[FAIL] Docker is not running. Start Docker Desktop first."
    exit 1
}

try {
    $ContainerStatus = Invoke-DockerCapture -Arguments @("inspect", "-f", "{{.State.Status}}", $ContainerName)
} catch {
    Write-Host "[FAIL] InfluxDB container '$ContainerName' was not found."
    exit 1
}

if ($ContainerStatus -ne "running") {
    Write-Host "[FAIL] InfluxDB container '$ContainerName' is not running."
    exit 1
}

if (Test-Path $BackupDir) {
    Remove-Item $BackupDir -Recurse -Force
}
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

Write-Host "[1/4] Checking InfluxDB health..."
try {
    Invoke-WebRequest -Uri "http://localhost:8086/health" -UseBasicParsing -ErrorAction Stop | Out-Null
    Write-Host "       [OK] InfluxDB is reachable"
} catch {
    Write-Host "       [WARN] InfluxDB health endpoint did not respond, continuing with container backup"
}
Write-Host ""

Write-Host "[2/4] Creating backup inside container..."
Invoke-DockerQuiet -Arguments @("exec", $ContainerName, "rm", "-rf", $ContainerBackupDir)
& docker exec $ContainerName influx backup $ContainerBackupDir --token $InfluxToken
Write-Host "       [OK] Backup created in container"
Write-Host ""

Write-Host "[3/4] Copying backup to host..."
& docker cp "${ContainerName}:${ContainerBackupDir}/." "$BackupDir/"
Write-Host "       [OK] Backup copied to $BackupDir"
Write-Host ""

Write-Host "[4/4] Writing restore notes..."
$RestoreInfo = @"
InfluxDB Backup Information
===========================

Created at: $Timestamp
Backup folder mode: overwrite latest backup
Source container: $ContainerName
Organization: $InfluxOrg
Bucket: $InfluxBucket

This backup was created with:
  influx backup $ContainerBackupDir --token $InfluxToken

Typical restore flow on another Docker-based InfluxDB 2.x instance:

1. Copy this backup folder to the target machine.
2. Copy the backup into the target InfluxDB container:
   docker cp .\latest\. <target_container>:/tmp/influxdb-restore/

3. Run the restore:
   docker exec <target_container> influx restore /tmp/influxdb-restore --full --token <TARGET_ADMIN_TOKEN>

Notes:
- Prefer restoring into a fresh InfluxDB 2.x instance.
- Source and target should be compatible InfluxDB 2.x versions.
- The --full restore includes metadata and bucket data.
"@

Set-Content -Path (Join-Path $BackupDir "RESTORE-INFO.txt") -Value $RestoreInfo
Write-Host "       [OK] Restore instructions saved"
Write-Host ""

Invoke-DockerQuiet -Arguments @("exec", $ContainerName, "rm", "-rf", $ContainerBackupDir)
Set-Content -Path (Join-Path $BackupDir "LAST-BACKUP.txt") -Value $Timestamp

Write-Host "╔═══════════════════════════════════════════╗"
Write-Host "║            Backup Complete!               ║"
Write-Host "╠═══════════════════════════════════════════╣"
Write-Host "║                                           ║"
Write-Host "║  Backup folder:                           ║"
Write-Host "║  $BackupDir"
Write-Host "║                                           ║"
Write-Host "║  Keep this folder safe for restore later. ║"
Write-Host "║                                           ║"
Write-Host "╚═══════════════════════════════════════════╝"
Write-Host ""
