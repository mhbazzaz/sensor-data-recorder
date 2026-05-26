$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SensorAppDir = Join-Path $ProjectRoot "sensor-app"
$LogDir = Join-Path $ProjectRoot "logs"
$AutoBackupScript = Join-Path $ProjectRoot "auto-backup-influx.ps1"

$InfluxToken = "SuperToken123456"
$InfluxOrg = "MohammadOrg"
$InfluxBucket = "FactoryMetrics"

$AppProcesses = @()
$ComposeArgs = @()

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
            Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop | Out-Null
            Write-Host "       $SuccessMessage ($i)"
            return
        } catch {
            Start-Sleep -Seconds 2
        }
    }
}

function Invoke-Compose {
    param(
        [string[]]$ExtraArgs
    )

    if ($ComposeArgs.Count -eq 0) {
        throw "Docker Compose command is not initialized."
    }

    & docker @ComposeArgs @ExtraArgs
}

try {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════╗"
    Write-Host "║   Industrial IoT Monitoring System        ║"
    Write-Host "╚═══════════════════════════════════════════╝"
    Write-Host ""

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "[FAIL] 'docker' command is not recognized. Please install Docker Desktop and add it to your PATH."
        exit 1
    }

    & docker info > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Docker is not running. Start Docker Desktop first."
        exit 1
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "[FAIL] Node.js is not installed."
        exit 1
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "[FAIL] npm is not installed (should be installed with Node.js)."
        exit 1
    }

    & docker compose version > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ComposeArgs = @("compose")
    } else {
        & docker-compose version > $null 2>&1
        if ($LASTEXITCODE -eq 0) {
            $ComposeArgs = @()
        } else {
            Write-Host "[FAIL] Docker Compose not found."
            exit 1
        }
    }

    Write-Host "[OK] Docker, Compose, and Node.js are ready"
    Write-Host ""

    Write-Host "[1/5] Stopping existing containers..."
    if ($ComposeArgs.Count -gt 0) {
        Invoke-Compose -ExtraArgs @("-f", "$ProjectRoot\docker-compose.yml", "down", "--remove-orphans") 2>$null
    } else {
        & docker-compose -f "$ProjectRoot\docker-compose.yml" down --remove-orphans 2>$null
    }
    Write-Host ""

    Write-Host "[2/5] Starting services..."
    if ($ComposeArgs.Count -gt 0) {
        Invoke-Compose -ExtraArgs @("-f", "$ProjectRoot\docker-compose.yml", "up", "-d")
    } else {
        & docker-compose -f "$ProjectRoot\docker-compose.yml" up -d
    }
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

    Write-Host "[4/5] Installing Node dependencies..."
    Push-Location $SensorAppDir
    & npm install --silent > $null 2>&1
    Pop-Location
    Write-Host "       [OK] Packages installed"
    Write-Host ""

    Write-Host "[5/5] Starting background services..."
    $BackupLog = Join-Path $LogDir "backup-influx.log"
    Set-Content -Path $BackupLog -Value ""

    $AppProcesses += Start-App -FilePath "powershell" -Arguments "-ExecutionPolicy Bypass -File `"$AutoBackupScript`"" -LogPath $BackupLog

    Write-Host "       [OK] Auto backup started"
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
    Write-Host "Backup logs saved to: $BackupLog"
    Write-Host ""
    Write-Host "Starting sensor receiver (index.js) in the foreground..."
    Write-Host "Press Ctrl+C to stop. Docker containers will stay running."
    Write-Host "--------------------------------------------------------"

    Push-Location $SensorAppDir
    try {
        & node index.js
    } finally {
        Pop-Location
    }
} finally {
    Stop-AppProcesses
}
