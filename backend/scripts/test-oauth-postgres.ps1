param()
$ErrorActionPreference = 'Stop'
$taskBackend = Split-Path -Parent $PSScriptRoot
$taskSuffix = [guid]::NewGuid().ToString('N').Substring(0,12)
$taskAuth = "tagback-oauth-auth-$taskSuffix"
$taskItems = "tagback-oauth-items-$taskSuffix"
$taskAdmin = "tagback-oauth-admin-$taskSuffix"
$taskStarted = @()
$taskVars = @('TAGBACK_ADMIN_TEST','TAGBACK_AUTH_SCHEMA_TEST','TAGBACK_ITEM_DB_TEST','TAGBACK_ITEM_DB_PORT','TAGBACK_DB_PASSWORD','SPRING_DATASOURCE_URL','SPRING_DATASOURCE_USERNAME','SPRING_DATASOURCE_PASSWORD')
$taskPrevious = @{}
foreach ($name in $taskVars) { $taskPrevious[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
foreach ($port in @(55439,55440,55461)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Test port $port is already in use. No existing database will be modified." }
}
try {
    foreach ($entry in @(@($taskAuth,'55439','tagback_auth_test'),@($taskItems,'55440','tagback_items_test'),@($taskAdmin,'55461','tagback_admin_test'))) {
        & docker run --detach --rm --name $entry[0] -p "127.0.0.1:$($entry[1]):5432" -e POSTGRES_HOST_AUTH_METHOD=trust -e "POSTGRES_DB=$($entry[2])" postgres:17-bookworm | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL startup failed.' }
        $taskStarted += $entry[0]
        $ready = $false
        for ($attempt=0;$attempt -lt 30;$attempt++) {
            & docker exec $entry[0] pg_isready -U postgres 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready=$true; break }
            Start-Sleep -Seconds 1
        }
        if (!$ready) { throw 'PostgreSQL did not become ready.' }
    }
    $env:TAGBACK_ADMIN_TEST='true'
    $env:TAGBACK_AUTH_SCHEMA_TEST='true'
    $env:TAGBACK_ITEM_DB_TEST='true'
    $env:TAGBACK_ITEM_DB_PORT='55440'
    $env:TAGBACK_DB_PASSWORD='isolated-test-only'
    $env:SPRING_DATASOURCE_URL='jdbc:postgresql://127.0.0.1:55440/tagback_items_test'
    $env:SPRING_DATASOURCE_USERNAME='postgres'
    $env:SPRING_DATASOURCE_PASSWORD=''
    Push-Location $taskBackend
    try {
        & .\gradlew.bat test --offline --rerun-tasks
        if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL tests failed.' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $taskVars) { [Environment]::SetEnvironmentVariable($name,$taskPrevious[$name],'Process') }
    foreach ($name in $taskStarted) { & docker stop $name | Out-Null }
}
