param(
    [switch]$NoOpen,
    [string]$Url
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$ServiceDir = Join-Path $Root 'extensions\SeedAnalysis\service'
$LocalSettings = Join-Path $Root 'LocalSettings.php'
$CacheDir = Join-Path $Root 'cache'
$LocalCacheDir = Join-Path $CacheDir 'seedanalysis-local'
$SqliteDir = Join-Path $CacheDir 'sqlite'
$SqliteDb = Join-Path $SqliteDir 'my_wiki.sqlite'
$CacheToken = Get-Date -Format 'yyyyMMddHHmmss'
$DefaultUrl = "http://localhost:8080/w/index.php/Special:SeedAnalysis?seedanalysis_ui=$CacheToken"
$WikiUrl = if ($Url) { $Url } else { $DefaultUrl }

function Write-Info($Message) {
    Write-Host "[INFO] $Message"
}

function Write-Ok($Message) {
    Write-Host "[OK] $Message"
}

function Write-Warn($Message) {
    Write-Host "[WARN] $Message"
}

function Invoke-Checked($File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $File $($Arguments -join ' ')"
    }
}

function Invoke-CheckedQuiet($File, [string[]]$Arguments) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $File @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }

    if ($exitCode -ne 0) {
        $output | ForEach-Object { Write-Host $_ }
        throw "Command failed: $File $($Arguments -join ' ')"
    }
}

function Invoke-CapturedQuiet($File, [string[]]$Arguments) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $File @Arguments 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }

    if ($exitCode -ne 0) {
        return ''
    }
    return ($output | Out-String).Trim()
}

function Test-DockerReady {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker info *> $null
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = 1
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }

    return $exitCode -eq 0
}

function Wait-DockerReady($TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-DockerReady) {
            return $true
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Wait-HttpOk($Uri, $TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            # The first MediaWiki request can spend several seconds warming
            # ResourceLoader and PHP caches, especially after Docker starts.
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 20
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Backup-LocalSettings($Reason) {
    if (!(Test-Path $LocalSettings)) {
        return
    }

    New-Item -ItemType Directory -Force -Path $LocalCacheDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $target = Join-Path $LocalCacheDir "LocalSettings.$Reason.$stamp.php"
    Copy-Item -LiteralPath $LocalSettings -Destination $target -Force
    Write-Info "Backed up LocalSettings.php to $target"
}

function Ensure-EnvFile {
    $envFile = Join-Path $Root '.env'
    if (Test-Path $envFile) {
        return
    }

    @(
        'MW_DOCKER_PORT=8080',
        'MW_DOCKER_UID=1000',
        'MW_DOCKER_GID=1000',
        'MEDIAWIKI_USER=Admin',
        'MEDIAWIKI_PASSWORD=dockerpass',
        'XDEBUG_ENABLE=true',
        'XHPROF_ENABLE=true'
    ) | Set-Content -Path $envFile -Encoding ASCII
    Write-Info 'Created local .env for MediaWiki Docker defaults.'
}

function Ensure-DockerLocalSettings {
    $needsInstall = $false

    if (Test-Path $LocalSettings) {
        $content = Get-Content -Raw -Path $LocalSettings
        $isDockerSettings = $content -match '\$wgScriptPath\s*=\s*"/w"' -and
            $content -match '\$wgDBtype\s*=\s*"sqlite"'

        if (!$isDockerSettings) {
            Write-Warn 'LocalSettings.php looks like XAMPP/MySQL config. Switching to Docker/SQLite local config.'
            Backup-LocalSettings 'xampp-backup'
            Remove-Item -LiteralPath $LocalSettings -Force
            $needsInstall = $true
        }
    } else {
        $needsInstall = $true
    }

    if (!(Test-Path $SqliteDb)) {
        $needsInstall = $true
        if (Test-Path $LocalSettings) {
            Backup-LocalSettings 'before-reinstall'
            Remove-Item -LiteralPath $LocalSettings -Force
        }
    }

    return $needsInstall
}

function Ensure-SeedConfig {
    if (!(Test-Path $LocalSettings)) {
        throw 'LocalSettings.php was not generated.'
    }

    $content = Get-Content -Raw -Path $LocalSettings
    if ($content -match "wfLoadExtension\(\s*'SeedAnalysis'\s*\)") {
        return $false
    }

    @'

// SeedAnalysis local module.
wfLoadExtension( 'SeedAnalysis' );
$wgSeedAnalysisApiUrl = getenv( 'SEED_ANALYSIS_API_URL' ) ?: 'http://seed-analysis:3000/api';
$wgSeedAnalysisPlayStoreUrl = '';
'@ | Add-Content -Path $LocalSettings -Encoding UTF8

    Write-Info 'Enabled SeedAnalysis in local LocalSettings.php.'
    return $true
}

Write-Host ''
Write-Host '==============================================='
Write-Host ' WikiCrop SeedAnalysis local runner'
Write-Host '==============================================='
Write-Host "Root:    $Root"
Write-Host "Service: $ServiceDir"
Write-Host "URL:     $WikiUrl"
Write-Host ''

if (!(Test-Path (Join-Path $ServiceDir 'package.json'))) {
    throw "SeedAnalysis service not found: $ServiceDir"
}

if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI was not found. Install Docker Desktop, then run run.bat again.'
}

if (!(Test-DockerReady)) {
    $dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dockerDesktop) {
        Write-Info 'Docker is not ready. Starting Docker Desktop...'
        Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    } else {
        throw 'Docker Desktop was not found. Install Docker Desktop, then run run.bat again.'
    }

    if (!(Wait-DockerReady 240)) {
        throw 'Docker Desktop did not become ready. If Docker shows "WSL needs updating", run: wsl --update, then reopen Docker Desktop.'
    }
}

Write-Ok 'Docker is ready.'

Ensure-EnvFile
New-Item -ItemType Directory -Force -Path $SqliteDir | Out-Null
$needsInstall = Ensure-DockerLocalSettings

Push-Location $Root
try {
    $webContainerId = Invoke-CapturedQuiet docker @('compose', 'ps', '-a', '-q', 'mediawiki-web')
    if ($webContainerId) {
        $webContainerStatus = Invoke-CapturedQuiet docker @('inspect', '--format', '{{.State.Status}}', $webContainerId)
        if ($webContainerStatus -and $webContainerStatus -ne 'running') {
            Write-Warn "Removing stale MediaWiki frontend container ($webContainerStatus)..."
            Invoke-CheckedQuiet docker @('compose', 'rm', '-sf', 'mediawiki-web')
        }
    }

    Write-Info 'Starting WikiCrop MediaWiki and SeedAnalysis containers...'
    Invoke-CheckedQuiet docker @('compose', '--progress', 'quiet', 'up', '-d', '--build', 'seed-analysis', 'mediawiki', 'mediawiki-web')
    Write-Ok 'WikiCrop containers are running.'

    if ($needsInstall) {
        Write-Info 'Installing local MediaWiki SQLite database...'
        Invoke-Checked docker @(
            'compose', 'exec', '-T', 'mediawiki',
            'php', 'maintenance/install.php',
            '--server', 'http://localhost:8080',
            '--scriptpath', '/w',
            '--dbtype', 'sqlite',
            '--dbpath', '/var/www/html/w/cache/sqlite',
            '--lang', 'vi',
            '--pass', 'dockerpass',
            'WikiCrop Local',
            'Admin'
        )
    }

    $null = Ensure-SeedConfig
} finally {
    Pop-Location
}

Write-Info 'Waiting for SeedAnalysis service...'
if (!(Wait-HttpOk 'http://127.0.0.1:3001/api/grain/health' 120)) {
    throw 'SeedAnalysis service did not become ready on http://127.0.0.1:3001.'
}
Write-Ok 'SeedAnalysis service is ready.'

Write-Info 'Waiting for WikiCrop page...'
if (!(Wait-HttpOk $WikiUrl 120)) {
    throw "WikiCrop page did not become ready: $WikiUrl"
}
Write-Ok 'WikiCrop page is ready.'

Write-Host ''
Write-Ok 'WikiCrop + SeedAnalysis are ready.'
Write-Host "Open: $WikiUrl"
Write-Host 'Login: Admin / dockerpass'
Write-Host ''

if (!$NoOpen) {
    Start-Process $WikiUrl
}
