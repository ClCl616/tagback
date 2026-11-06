param(
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
    [ValidateRange(1024, 65535)][int]$ItemPort = 55440
)

$ErrorActionPreference = 'Stop'
$taskBackend = Split-Path -Parent $PSScriptRoot
$taskRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('tagback-full-test-' + [guid]::NewGuid().ToString('N'))
$taskAuthData = Join-Path $taskRoot 'auth-data'
$taskItemData = Join-Path $taskRoot 'item-data'
$taskAuthStarted = $false
$taskItemStarted = $false
$taskEnvironmentNames = @('TAGBACK_AUTH_SCHEMA_TEST', 'TAGBACK_ITEM_DB_TEST', 'TAGBACK_ITEM_DB_PORT',
    'TAGBACK_DB_PASSWORD', 'SPRING_DATASOURCE_URL', 'SPRING_DATASOURCE_USERNAME', 'SPRING_DATASOURCE_PASSWORD')
$taskPreviousEnvironment = @{}
foreach ($name in $taskEnvironmentNames) { $taskPreviousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

if ($ItemPort -eq 55439) { throw 'ItemPort must differ from the authentication test port 55439.' }
foreach ($port in @(55439, $ItemPort)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Test port $port is already in use. Authentication tests require port 55439."
    }
}
foreach ($name in @('initdb.exe', 'pg_ctl.exe', 'createdb.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $PostgresBin $name))) { throw "PostgreSQL tool missing: $name" }
}

New-Item -ItemType Directory -Path $taskRoot | Out-Null
try {
    foreach ($data in @($taskAuthData, $taskItemData)) {
        & (Join-Path $PostgresBin 'initdb.exe') -D $data -U postgres -A trust -E UTF8 --locale=C | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Test PostgreSQL initialization failed.' }
    }
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskAuthData -l (Join-Path $taskRoot 'auth.log') -o '-h 127.0.0.1 -p 55439' -w -t 30 start
    if ($LASTEXITCODE -ne 0) { throw 'Authentication test PostgreSQL startup failed.' }
    $taskAuthStarted = $true
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskItemData -l (Join-Path $taskRoot 'item.log') -o "-h 127.0.0.1 -p $ItemPort" -w -t 30 start
    if ($LASTEXITCODE -ne 0) { throw 'Item test PostgreSQL startup failed.' }
    $taskItemStarted = $true
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p 55439 -U postgres tagback_auth_test
    if ($LASTEXITCODE -ne 0) { throw 'Authentication test database creation failed.' }
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $ItemPort -U postgres tagback_items_test
    if ($LASTEXITCODE -ne 0) { throw 'Item test database creation failed.' }

    $env:TAGBACK_AUTH_SCHEMA_TEST = 'true'
    $env:TAGBACK_ITEM_DB_TEST = 'true'
    $env:TAGBACK_ITEM_DB_PORT = $ItemPort.ToString()
    # The isolated server uses trust authentication; this non-secret value enables legacy opt-in tests.
    $env:TAGBACK_DB_PASSWORD = 'isolated-test-only'
    $env:SPRING_DATASOURCE_URL = "jdbc:postgresql://127.0.0.1:$ItemPort/tagback_items_test"
    $env:SPRING_DATASOURCE_USERNAME = 'postgres'
    $env:SPRING_DATASOURCE_PASSWORD = 'isolated-test-only'
    Push-Location $taskBackend
    try {
        & .\gradlew.bat test --offline --rerun-tasks
        if ($LASTEXITCODE -ne 0) { throw 'Full PostgreSQL-backed test run failed.' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $taskEnvironmentNames) { [Environment]::SetEnvironmentVariable($name, $taskPreviousEnvironment[$name], 'Process') }
    if ($taskItemStarted) { & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskItemData -w -t 30 -m fast stop | Out-Null }
    if ($taskAuthStarted) { & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskAuthData -w -t 30 -m fast stop | Out-Null }
    Write-Host "Isolated test clusters retained for diagnostics: $taskRoot"
}
