$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SensorAppDir = Join-Path $ProjectRoot "sensor-app"
$LogDir = Join-Path $ProjectRoot "logs"
$AutoBackupScript = Join-Path $ProjectRoot "auto-backup-influx.ps1"

$InfluxToken = "SuperToken123456"
$InfluxOrg = "MohammadOrg"
$InfluxBucket = "FactoryMetrics"

$AppProcesses = @()

function Stop-AppProcesses {
    Write-Host ""
    Write-Host "[STOP] Shutting down Node apps..."

    foreach ($Process in $AppProcesses) {
        try {
            if (-not $Process.HasExited) {
                Stop-Process -Id $Process.Id -Force
            }
        } catch {
        }
    }

    Write-Host "[STOP] Node apps stopped. Docker containers are still running."
}

function Start-App {
    param(
        [string]$FilePath,
        [string]$Arguments,
        [string]$LogPath
    )

    return Start-Process -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $LogPath `
        -RedirectStandardError $LogPath `
        -PassThru
}

function Wait-ForHttp {
    param(
        [string]$Url,
        [string]$SuccessMessage
    )

    for ($i = 1; $i -le 30; $i++) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing | Out-Null
            Write-Host "       $SuccessMessage ($i)"
            return
        } catch {
            Start-Sleep -Seconds 2
        }
    }
}

try {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════╗"
    Write-Host "║   Industrial IoT Monitoring System        ║"
    Write-Host "╚═══════════════════════════════════════════╝"
    Write-Host ""

    try {
        docker info *> $null
    } catch {
        Write-Host "[FAIL] Docker is not running. Start Docker Desktop first."
        exit 1
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "[FAIL] Node.js is not installed."
        exit 1
    }

    try {
        docker compose version *> $null
        $Compose = "docker compose"
    } catch {
        if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
            $Compose = "docker-compose"
        } else {
            Write-Host "[FAIL] Docker Compose not found."
            exit 1
        }
    }

    Write-Host "[OK] Docker, Compose, and Node.js are ready"
    Write-Host ""

    Write-Host "[1/5] Stopping existing containers..."
    & powershell -NoProfile -Command "$Compose -f `"$ProjectRoot\docker-compose.yml`" down --remove-orphans 2>`$null"
    Write-Host ""

    Write-Host "[2/5] Starting services..."
    & powershell -NoProfile -Command "$Compose -f `"$ProjectRoot\docker-compose.yml`" up -d"
    Write-Host ""

    Write-Host "[3/5] Waiting for services..."
    Wait-ForHttp -Url "http://localhost:8086/health" -SuccessMessage "InfluxDB is healthy"
    Write-Host "       Waiting for Node-RED..."
    Wait-ForHttp -Url "http://localhost:1880/" -SuccessMessage "Node-RED is up"

    Write-Host "       Waiting for Mosquitto..."
    for ($i = 1; $i -le 30; $i++) {
        try {
            $MosquittoStatus = (docker inspect -f "{{.State.Status}}" mosquitto 2>$null).Trim()
            if ($MosquittoStatus -eq "running") {
                Write-Host "       Mosquitto is running ($i)"
                break
            }
        } catch {
        }
        Start-Sleep -Seconds 2
    }
    Write-Host ""

    Write-Host "[4/5] Starting Node apps..."
    $ReceiverLog = Join-Path $LogDir "receiver.log"
    $MockLog = Join-Path $LogDir "mock-sensor.log"
    $BackupLog = Join-Path $LogDir "backup-influx.log"

    Set-Content -Path $ReceiverLog -Value ""
    Set-Content -Path $MockLog -Value ""
    Set-Content -Path $BackupLog -Value ""

    $AppProcesses += Start-App -FilePath "node" -Arguments "`"$SensorAppDir\index.js`"" -LogPath $ReceiverLog
    Start-Sleep -Seconds 2
    $AppProcesses += Start-App -FilePath "node" -Arguments "`"$SensorAppDir\mock-sensor.js`"" -LogPath $MockLog
    $AppProcesses += Start-App -FilePath "powershell" -Arguments "-ExecutionPolicy Bypass -File `"$AutoBackupScript`"" -LogPath $BackupLog
    Start-Sleep -Seconds 5

    Write-Host "       [OK] Receiver, mock sensors, and auto backup started"
    Write-Host ""

    Write-Host "[5/5] Verifying data flow..."
    $DataOk = $false
    for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
        try {
            $Headers = @{
                Authorization = "Token $InfluxToken"
                Accept = "application/csv"
                "Content-Type" = "application/vnd.flux"
            }
            $Body = "from(bucket: `"$InfluxBucket`") |> range(start: -2m) |> limit(n: 1)"
            $Result = Invoke-RestMethod -Uri "http://localhost:8086/api/v2/query?org=$InfluxOrg" -Method Post -Headers $Headers -Body $Body

            if ($Result -match "_measurement") {
                $DataOk = $true
                break
            }
        } catch {
        }

        if ($Attempt -lt 3) {
            Write-Host "       No data yet, waiting 5s... (attempt $Attempt/3)"
            Start-Sleep -Seconds 5
        }
    }

    if ($DataOk) {
        Write-Host "       [OK] Data is flowing to InfluxDB"
    } else {
        Write-Host "       [WARN] No data detected in InfluxDB yet"
    }
    Write-Host ""

    Write-Host "╔═══════════════════════════════════════════╗"
    Write-Host "║            System Ready!                  ║"
    Write-Host "╠═══════════════════════════════════════════╣"
    Write-Host "║                                           ║"
    Write-Host "║  Node-RED   http://localhost:1880         ║"
    Write-Host "║                                           ║"
    Write-Host "║  InfluxDB   http://localhost:8086         ║"
    Write-Host "║             admin / admin123              ║"
    Write-Host "║                                           ║"
    Write-Host "║  MQTT       mqtt://localhost:1883         ║"
    Write-Host "║                                           ║"
    Write-Host "╚═══════════════════════════════════════════╝"
    Write-Host ""
    Write-Host "App logs saved to:"
    Write-Host "  $ReceiverLog"
    Write-Host "  $MockLog"
    Write-Host "  $BackupLog"
    Write-Host ""
    Write-Host "Press Ctrl+C to stop the Node apps. Docker containers will stay running."
    Write-Host ""

    while ($true) {
        Start-Sleep -Seconds 3600
    }
} finally {
    Stop-AppProcesses
}
