param()
$ErrorActionPreference = 'Stop'
$localDir = Join-Path $PSScriptRoot 'local'
$tlsDir = Join-Path $localDir 'tls'
$null = New-Item -ItemType Directory -Force -Path $tlsDir
$utf8 = [Text.UTF8Encoding]::new($false)
foreach ($name in @('db-password', 'sms-hash-key', 'nfc-scan-secret')) {
    $path = Join-Path $localDir $name
    if (!(Test-Path -LiteralPath $path)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [IO.File]::WriteAllText($path, [Convert]::ToBase64String($bytes), $utf8)
    }
}
$cert = Join-Path $tlsDir 'server.crt'
$key = Join-Path $tlsDir 'server.key'
if ((Test-Path -LiteralPath $cert) -xor (Test-Path -LiteralPath $key)) {
    throw 'Incomplete TLS pair. Restore both files; existing keys are never overwritten.'
}
if (!(Test-Path -LiteralPath $cert)) {
    & docker run --rm --mount "type=bind,source=$tlsDir,target=/certs" alpine:3.23 sh -ec 'apk add --no-cache openssl >/dev/null; openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout /certs/server.key -out /certs/server.crt -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1'
    if ($LASTEXITCODE -ne 0) { throw 'Local certificate generation failed.' }
}
Write-Host 'Compose local secrets and TLS files are ready. Existing values were preserved.'
Write-Host 'The self-signed certificate was NOT installed into the OS trust store.'
Write-Host 'From the repository root: docker compose up -d --build --wait'
