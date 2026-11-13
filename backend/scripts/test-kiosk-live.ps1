param([int]$DbPort=55442,[int]$BackendPort=18082,[int]$FrontendPort=5182,[switch]$SkipBackendTests,[switch]$FullJourney,[switch]$AllBackendTests)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskBackend=Join-Path $taskRoot 'backend'
$taskFrontend=Join-Path $taskRoot 'frontend'
$taskContainer='tagback-kiosk-test-'+[guid]::NewGuid().ToString('N')
$taskLogs=Join-Path ([IO.Path]::GetTempPath()) $taskContainer
$taskProcesses=@()
$taskCreated=$false
$taskPorts=@($DbPort,$BackendPort,$FrontendPort)
if($AllBackendTests) { $taskPorts+=55439 }
foreach($port in $taskPorts) {
  if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Test port $port is in use." }
}
$taskOpenSsl='C:/Program Files/Git/usr/bin/openssl.exe'
if(!(Test-Path -LiteralPath $taskOpenSsl)) { throw 'OpenSSL missing.' }
New-Item -ItemType Directory -Path $taskLogs | Out-Null
try {
  $taskExtraPorts=@()
  if($AllBackendTests) { $taskExtraPorts=@('--publish','127.0.0.1:55439:5432') }
  & docker run --detach --name $taskContainer --label tagback.test=kiosk --publish "127.0.0.1:${DbPort}:5432" @taskExtraPorts --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=tagback_live_test postgres:17
  if($LASTEXITCODE -ne 0) { throw 'Test database startup failed.' }
  $taskCreated=$true
  $ready=$false
  for($i=0;$i -lt 40;$i++) {
    # The image's temporary bootstrap server accepts Unix sockets before restarting.
    # TCP readiness identifies the final server, avoiding a createdb shutdown race.
    & docker exec $taskContainer pg_isready -h 127.0.0.1 -U postgres 2>$null | Out-Null
    if($LASTEXITCODE -eq 0) {$ready=$true;break}
    Start-Sleep -Milliseconds 500
  }
  if(!$ready) {throw 'Database readiness failed.'}
  & docker exec $taskContainer createdb -U postgres tagback_items_test
  if($LASTEXITCODE -ne 0) {throw 'Integration database creation failed.'}
  $env:TAGBACK_ITEM_DB_TEST='true'
  $env:TAGBACK_ITEM_DB_PORT=$DbPort.ToString()
  if($AllBackendTests) {
    & docker exec $taskContainer createdb -U postgres tagback_auth_test
    if($LASTEXITCODE -ne 0) {throw 'Authentication test database creation failed.'}
    $env:TAGBACK_AUTH_SCHEMA_TEST='true'
    $env:TAGBACK_DB_PASSWORD='isolated-test-only'
    $env:SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:$DbPort/tagback_items_test"
    $env:SPRING_DATASOURCE_USERNAME='postgres'
    $env:SPRING_DATASOURCE_PASSWORD='isolated-test-only'
  }
  Push-Location $taskBackend
  try {
    if (!$SkipBackendTests) {
    if($AllBackendTests) { & .\gradlew.bat test --offline --rerun-tasks }
    else { & .\gradlew.bat test --tests 'com.tagback.Rental*Test' --tests 'com.tagback.NfcTagRepositoryIntegrationTest' --offline --rerun-tasks }
    if($LASTEXITCODE -ne 0) {throw 'PostgreSQL integration tests failed.'}
    }
    & .\gradlew.bat bootJar --offline
    if($LASTEXITCODE -ne 0) {throw 'Backend build failed.'}
  } finally {Pop-Location}
  $env:SPRING_PROFILES_ACTIVE='sms-mock'
  $env:SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:$DbPort/tagback_live_test"
  $env:SPRING_DATASOURCE_USERNAME='postgres'
  $env:SPRING_DATASOURCE_PASSWORD=''
  $env:TAGBACK_DB_PASSWORD=''
  $env:NFC_SCAN_SECRET='test-only-nfc-scan-secret-32-bytes-long'
  $env:NFC_BRIDGE_ID='kiosk-1'
  $env:SERVER_PORT=$BackendPort.ToString()
  $env:TAGBACK_AUTH_ALLOWED_ORIGINS="https://localhost:$FrontendPort"
  $taskProcesses+=Start-Process -FilePath (Get-Command java).Source -ArgumentList @('-jar',(Join-Path $taskBackend 'build/libs/tagback-0.0.1-SNAPSHOT.jar')) -WorkingDirectory $taskBackend -RedirectStandardOutput (Join-Path $taskLogs 'backend.out.log') -RedirectStandardError (Join-Path $taskLogs 'backend.err.log') -WindowStyle Hidden -PassThru
  $ready=$false
  for($i=0;$i -lt 80;$i++) {
    try {$null=Invoke-WebRequest "http://127.0.0.1:$BackendPort/api/v1/kiosk/health" -TimeoutSec 2;$ready=$true;break} catch {Start-Sleep -Milliseconds 500}
  }
  if(!$ready) {throw 'Backend readiness failed; see retained logs.'}
  $seed="insert into item_types(name) values ('Live calculator'); insert into items(item_type_id,item_name,status) select item_type_id,'Live calculator','TAG_PENDING' from item_types where name='Live calculator'; insert into nfc_tags(item_id,tag_uid) select item_id,'04A23B1C5D6E80' from items where item_name='Live calculator'; update items set status='RENTED' where item_name='Live calculator';"
  & docker exec $taskContainer psql -U postgres -d tagback_live_test -v ON_ERROR_STOP=1 -q -c $seed
  if($LASTEXITCODE -ne 0) {throw 'Test seed failed.'}
  $env:TAGBACK_HTTPS_KEY=Join-Path $taskLogs 'localhost-key.pem'
  $env:TAGBACK_HTTPS_CERT=Join-Path $taskLogs 'localhost-cert.pem'
  & $taskOpenSsl req -x509 -newkey rsa:2048 -nodes -keyout $env:TAGBACK_HTTPS_KEY -out $env:TAGBACK_HTTPS_CERT -days 1 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>$null
  if($LASTEXITCODE -ne 0) {throw 'Local certificate generation failed.'}
  $env:TAGBACK_API_TARGET="http://127.0.0.1:$BackendPort"
  $env:TAGBACK_TEST_CONTAINER=$taskContainer
  $env:TAGBACK_LIVE_BASE_URL="https://localhost:$FrontendPort"
  # Trust only this generated test certificate in the child Node/Electron processes.
  # The packaged host keeps HTTPS verification enabled; no system trust changes.
  if($FullJourney) { $env:NODE_EXTRA_CA_CERTS=$env:TAGBACK_HTTPS_CERT }
  $taskProcesses+=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('node_modules/vite/bin/vite.js','--host','localhost','--port',$FrontendPort,'--strictPort') -WorkingDirectory $taskFrontend -RedirectStandardOutput (Join-Path $taskLogs 'frontend.out.log') -RedirectStandardError (Join-Path $taskLogs 'frontend.err.log') -WindowStyle Hidden -PassThru
  $ready=$false
  for($i=0;$i -lt 40;$i++) {
    try {$null=Invoke-WebRequest "$env:TAGBACK_LIVE_BASE_URL/kiosk" -SkipCertificateCheck -TimeoutSec 2;$ready=$true;break} catch {Start-Sleep -Milliseconds 500}
  }
  if(!$ready) {throw 'Frontend readiness failed.'}
  Push-Location $taskFrontend
  try {
    if($FullJourney) { & pnpm exec playwright test -c playwright.live-journey.config.ts }
    else { & pnpm exec playwright test -c playwright.live-return.config.ts }
    if($LASTEXITCODE -ne 0) {throw 'Live kiosk browser tests failed.'}
  } finally {Pop-Location}
} finally {
  foreach($taskProcess in $taskProcesses) {Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue}
  if($taskCreated) {
    & docker logs $taskContainer 2>&1 | Set-Content (Join-Path $taskLogs 'postgres.log')
    & docker stop $taskContainer | Out-Null
  }
  Write-Host "Stopped test container retained: $taskContainer"
  Write-Host "Kiosk integration logs: $taskLogs"
}
