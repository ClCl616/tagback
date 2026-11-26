param()
$ErrorActionPreference = 'Stop'
$testDir = Join-Path $PSScriptRoot 'local/kakao-auth-test'
$null = New-Item -ItemType Directory -Force -Path $testDir
$utf8 = [Text.UTF8Encoding]::new($false)
foreach ($name in @('db-password', 'common-key', 'hmac-key', 'skill-secret', 'nfc-secret')) {
    $path = Join-Path $testDir $name
    if (!(Test-Path -LiteralPath $path)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [IO.File]::WriteAllText($path, [Convert]::ToBase64String($bytes), $utf8)
    }
}
Write-Host 'Isolated test secrets are ready. Existing values were preserved.'
