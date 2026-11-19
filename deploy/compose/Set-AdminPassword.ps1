#Requires -Version 7.0
param()
$ErrorActionPreference = 'Stop'
$secure = Read-Host '공통 관리자 비밀번호 (12~128자)' -AsSecureString
$confirm = Read-Host '비밀번호 확인' -AsSecureString
$first = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$second = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($first)
    if ($password.Length -lt 12 -or $password.Length -gt 128) { throw '비밀번호는 12~128자여야 합니다.' }
    if ($password -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($second)) { throw '비밀번호가 일치하지 않습니다.' }
    $salt = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $hash = [Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($password, $salt, 600000, [Security.Cryptography.HashAlgorithmName]::SHA256, 32)
    $encoded = 'pbkdf2-sha256$600000$' + [Convert]::ToBase64String($salt) + '$' + [Convert]::ToBase64String($hash)
    $directory = Join-Path $PSScriptRoot 'local'
    $null = New-Item -ItemType Directory -Force -Path $directory
    [IO.File]::WriteAllText((Join-Path $directory 'admin-password-hash'), $encoded, [Text.UTF8Encoding]::new($false))
    Write-Host '관리자 비밀번호 해시를 저장했습니다. 비밀번호 원문은 저장하지 않았습니다.'
    Write-Host '반영: docker compose up -d --build --force-recreate --wait api'
    Write-Host '비밀번호를 바꾸고 API를 재생성하면 이전 관리자 세션은 사용할 수 없습니다.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($first)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($second)
    $password=$null; $secure.Dispose(); $confirm.Dispose()
}
