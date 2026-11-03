param(
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
    [int]$DbPort = 55442,
    [int]$BackendPort = 18082,
    [int]$FrontendPort = 5182
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskBackend = Join-Path $taskRoot 'backend'
$taskFrontend = Join-Path $taskRoot 'frontend'
$taskCluster = Join-Path ([System.IO.Path]::GetTempPath()) ('tagback-live-return-' + [guid]::NewGuid().ToString('N'))
$taskData = Join-Path $taskCluster 'data'
$taskBackendProcess = $null
$taskFrontendProcess = $null
$taskPostgresStarted = $false
Write-Host 'Checking live return test ports and tools...'

foreach ($port in @($DbPort, $BackendPort, $FrontendPort)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Test port $port is already in use."
    }
}
foreach ($name in @('initdb.exe', 'pg_ctl.exe', 'createdb.exe', 'psql.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $PostgresBin $name))) { throw "PostgreSQL tool missing: $name" }
}

New-Item -ItemType Directory -Path $taskCluster | Out-Null
Write-Host 'Preparing temporary PostgreSQL...'
try {
    & (Join-Path $PostgresBin 'initdb.exe') -D $taskData -U postgres -A trust -E UTF8 --locale=C | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Test PostgreSQL initialization failed.' }
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -l (Join-Path $taskCluster 'postgres.log') -o "-h 127.0.0.1 -p $DbPort" -w -t 30 start
    if ($LASTEXITCODE -ne 0) { throw 'Test PostgreSQL startup failed.' }
    $taskPostgresStarted = $true
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $DbPort -U postgres tagback_live_test
    if ($LASTEXITCODE -ne 0) { throw 'Test database creation failed.' }
    Write-Host 'Building backend...'

    Push-Location $taskBackend
    try {
        & .\gradlew.bat bootJar --offline
        if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    } finally { Pop-Location }

    $env:SPRING_PROFILES_ACTIVE = 'sms-mock'
    $env:SPRING_DATASOURCE_URL = "jdbc:postgresql://127.0.0.1:$DbPort/tagback_live_test"
    $env:SPRING_DATASOURCE_USERNAME = 'postgres'
    $env:SPRING_DATASOURCE_PASSWORD = ''
    $env:TAGBACK_DB_PASSWORD = ''
    $env:NFC_SCAN_SECRET = 'test-only-nfc-scan-secret-32-bytes-long'
    $env:NFC_BRIDGE_ID = 'kiosk-1'
    $env:SERVER_PORT = $BackendPort.ToString()
    $env:TAGBACK_AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:$FrontendPort"
    $jar = Join-Path $taskBackend 'build/libs/tagback-0.0.1-SNAPSHOT.jar'
    $taskBackendProcess = Start-Process -FilePath (Get-Command java).Source -ArgumentList @('-jar', $jar) `
        -WorkingDirectory $taskBackend -RedirectStandardOutput (Join-Path $taskCluster 'backend.out.log') `
        -RedirectStandardError (Join-Path $taskCluster 'backend.err.log') -WindowStyle Hidden -PassThru
    Write-Host 'Waiting for backend readiness...'

    $backendReady = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/api/v1/kiosk/health" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $backendReady = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$backendReady) {
        Get-Content (Join-Path $taskCluster 'backend.err.log') -Tail 35
        Get-Content (Join-Path $taskCluster 'backend.out.log') -Tail 35
        throw 'Backend did not become ready.'
    }

    $seed = "insert into item_types(name) values ('Live calculator'); " +
        "insert into items(item_type_id,item_name,status) select item_type_id,'Live calculator','TAG_PENDING' from item_types where name='Live calculator'; " +
        "insert into nfc_tags(item_id,tag_uid) select item_id,'04A23B1C5D6E80' from items where item_name='Live calculator'; " +
        "update items set status='RENTED' where item_name='Live calculator';"
    & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p $DbPort -U postgres -d tagback_live_test -v ON_ERROR_STOP=1 -q -c $seed
    if ($LASTEXITCODE -ne 0) { throw 'Test fixture setup failed.' }
    Write-Host 'Starting frontend...'

    $env:VITE_AUTH_MODE = 'http'
    $env:VITE_KIOSK_MODE = 'bridge'
    $env:TAGBACK_API_TARGET = "http://127.0.0.1:$BackendPort"
    $env:TAGBACK_LIVE_PSQL = Join-Path $PostgresBin 'psql.exe'
    $env:TAGBACK_LIVE_DB_PORT = $DbPort.ToString()
    $taskFrontendProcess = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', $FrontendPort, '--strictPort') `
        -WorkingDirectory $taskFrontend -RedirectStandardOutput (Join-Path $taskCluster 'frontend.out.log') `
        -RedirectStandardError (Join-Path $taskCluster 'frontend.err.log') -WindowStyle Hidden -PassThru
    $frontendReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$FrontendPort/mobile" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $frontendReady = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$frontendReady) { throw 'Frontend did not become ready.' }
    Write-Host 'Running live browser test...'

    Push-Location $taskFrontend
    try {
        & pnpm exec playwright test -c playwright.live-return.config.ts
        if ($LASTEXITCODE -ne 0) { throw 'Live return browser test failed.' }
    } finally { Pop-Location }
} finally {
    if ($taskFrontendProcess) { Stop-Process -Id $taskFrontendProcess.Id -ErrorAction SilentlyContinue }
    if ($taskBackendProcess) { Stop-Process -Id $taskBackendProcess.Id -ErrorAction SilentlyContinue }
    if ($taskPostgresStarted) {
        & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -w -t 30 -m fast stop | Out-Null
    }
    Write-Host "Live return test logs: $taskCluster"
}
