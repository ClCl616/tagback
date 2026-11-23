param()
$ErrorActionPreference = 'Stop'
$probeDir = Join-Path $PSScriptRoot 'local/kakao-probe'
$null = New-Item -ItemType Directory -Force -Path $probeDir
$utf8 = [Text.UTF8Encoding]::new($false)
foreach ($name in @('db-password', 'skill-secret')) {
    $path = Join-Path $probeDir $name
    if (!(Test-Path -LiteralPath $path)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [IO.File]::WriteAllText($path, [Convert]::ToBase64String($bytes), $utf8)
    }
}
Write-Host 'Test-only secrets prepared. Existing files were not changed.'
Write-Host 'Keep the local/kakao-probe directory private and out of source control.'
