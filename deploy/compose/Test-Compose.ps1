# Requires PowerShell 7. Checks an already running stack without creating users/items.
param(
    [string]$BaseUrl = 'https://localhost:8443',
    [switch]$SkipCertificateCheck
)
$ErrorActionPreference = 'Stop'
$options = @{ SkipHttpErrorCheck = $true; TimeoutSec = 15 }
if ($SkipCertificateCheck) { $options.SkipCertificateCheck = $true }
$base = $BaseUrl.TrimEnd('/')
foreach ($path in @('/mobile', '/mobile/items', '/admin/login', '/kiosk')) {
    $response = Invoke-WebRequest "$base$path" @options
    if ($response.StatusCode -ne 200 -or $response.Content -notmatch 'id="root"') {
        throw "SPA route failed: $path"
    }
}
$health = Invoke-WebRequest "$base/api/v1/kiosk/health" @options
if ($health.StatusCode -ne 200) { throw 'API health proxy failed' }
$catalog = Invoke-WebRequest "$base/api/v1/catalog/item-types" @options
if ($catalog.StatusCode -ne 200 -or $catalog.Headers['Content-Type'] -notmatch 'application/json') {
    throw 'Public catalog proxy failed'
}
$null = $catalog.Content | ConvertFrom-Json
foreach ($path in @('/api/v1/auth/session', '/api/v1/admin/users')) {
    $response = Invoke-WebRequest "$base$path" @options
    if ($response.StatusCode -ne 401) { throw "Unauthenticated request not rejected: $path" }
}
$logout = Invoke-WebRequest "$base/api/v1/auth/logout" -Method Post -Headers @{ Origin = $base } @options
if ($logout.StatusCode -ne 204 -or "$($logout.Headers['Set-Cookie'])" -notmatch 'Secure') {
    throw 'Same-origin authentication or Secure cookie handling failed'
}
$blocked = Invoke-WebRequest "$base/api/v1/auth/logout" -Method Post -Headers @{ Origin = 'https://untrusted.invalid' } @options
if ($blocked.StatusCode -ne 403) { throw 'Unexpected Origin was not rejected' }
$assetPath = [regex]::Match((Invoke-WebRequest "$base/mobile" @options).Content, 'src="(/assets/[^"]+\.js)"').Groups[1].Value
if (!$assetPath) { throw 'Built JavaScript asset missing from HTML' }
$asset = Invoke-WebRequest "$base$assetPath" @options
if ($asset.StatusCode -ne 200 -or $asset.Headers['Content-Type'] -notmatch 'javascript') {
    throw 'Built JavaScript asset request failed'
}
Write-Host 'PASS: SPA routes, built asset, API health/catalog, authentication boundary, Secure cookie, Origin rejection.'
