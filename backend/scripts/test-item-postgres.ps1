param(
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
    [ValidateRange(1024, 65535)][int]$Port = 55440
)

$ErrorActionPreference = 'Stop'
$taskBackend = Split-Path -Parent $PSScriptRoot
$taskCluster = Join-Path ([System.IO.Path]::GetTempPath()) ('tagback-item-test-' + [guid]::NewGuid().ToString('N'))
$taskData = Join-Path $taskCluster 'data'
$taskLog = Join-Path $taskCluster 'postgres.log'
$taskStarted = $false
$taskPreviousEnabled = $env:TAGBACK_ITEM_DB_TEST
$taskPreviousPort = $env:TAGBACK_ITEM_DB_PORT

foreach ($tool in @('initdb.exe', 'pg_ctl.exe', 'createdb.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $PostgresBin $tool))) { throw "PostgreSQL tool missing: $tool" }
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Choose a different test port."
}

New-Item -ItemType Directory -Path $taskCluster | Out-Null
try {
    & (Join-Path $PostgresBin 'initdb.exe') -D $taskData -U postgres -A trust -E UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'Test PostgreSQL initialization failed.' }
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -l $taskLog -o "-h 127.0.0.1 -p $Port" -w -t 30 start
    if ($LASTEXITCODE -ne 0) { throw "Test PostgreSQL startup failed. See $taskLog" }
    $taskStarted = $true
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $Port -U postgres tagback_items_test
    if ($LASTEXITCODE -ne 0) { throw 'Test database creation failed.' }
    $env:TAGBACK_ITEM_DB_TEST = 'true'
    $env:TAGBACK_ITEM_DB_PORT = $Port.ToString()
    Push-Location $taskBackend
    try {
        & .\gradlew.bat test --tests 'com.tagback.Item*Test' --tests 'com.tagback.Rental*Test' --tests 'com.tagback.SessionAuthenticationTest' --tests 'com.tagback.NfcTagRepositoryIntegrationTest' --tests 'com.tagback.TagRegistrationIntegrationTest' --tests 'com.tagback.TagRegistrationControllerTest' --tests 'com.tagback.TagRegistrationServiceTest' --tests 'com.tagback.TagUidNormalizerTest' --offline --rerun-tasks
        if ($LASTEXITCODE -ne 0) { throw 'Item PostgreSQL integration tests failed.' }
    } finally { Pop-Location }
} finally {
    $env:TAGBACK_ITEM_DB_TEST = $taskPreviousEnabled
    $env:TAGBACK_ITEM_DB_PORT = $taskPreviousPort
    if ($taskStarted) {
        & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -w -t 30 -m fast stop
        if ($LASTEXITCODE -ne 0) { Write-Warning "Test PostgreSQL shutdown failed: $taskData" }
    }
    Write-Host "Test cluster retained for diagnostics: $taskCluster"
}
