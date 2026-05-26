$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupScript = Join-Path $ProjectRoot "backup-influx.ps1"
$BackupHour = 2
$BackupMinute = 0

function Get-Timestamp {
    Get-Date -Format "yyyy-MM-dd HH:mm:ss"
}

function Get-SecondsUntilNextBackup {
    $Now = Get-Date
    $Target = Get-Date -Hour $BackupHour -Minute $BackupMinute -Second 0

    if ($Target -le $Now) {
        $Target = $Target.AddDays(1)
    }

    return [int][Math]::Floor(($Target - $Now).TotalSeconds)
}

Write-Host "[$(Get-Timestamp)] [backup] Auto backup worker started"
Write-Host "[$(Get-Timestamp)] [backup] Schedule: daily at 02:00 AM"

while ($true) {
    $SleepSeconds = Get-SecondsUntilNextBackup
    Write-Host "[$(Get-Timestamp)] [backup] Next backup in $SleepSeconds seconds"
    Start-Sleep -Seconds $SleepSeconds

    Write-Host "[$(Get-Timestamp)] [backup] Running backup..."

    try {
        & $BackupScript
        Write-Host "[$(Get-Timestamp)] [backup] Backup completed successfully"
    } catch {
        Write-Host "[$(Get-Timestamp)] [backup] Backup failed"
    }
}
