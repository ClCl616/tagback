param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$ProfileDirectory
)
$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path -LiteralPath $Executable).Path
$profilePath = [System.IO.Path]::GetFullPath($ProfileDirectory)
if ($profilePath.Contains('"')) { throw 'Invalid profile directory' }
$secret = Read-Host '서버와 일치하는 NFC 서명 키 (32 bytes 이상)' -AsSecureString
$pointer = [IntPtr]::Zero
$pipe = $null
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $exePath
  $pipeName = 'tagback-provision-' + [Guid]::NewGuid().ToString()
  $pipeOptions = [IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::CurrentUserOnly
  $pipe = [IO.Pipes.NamedPipeServerStream]::new($pipeName, [IO.Pipes.PipeDirection]::Out, 1, [IO.Pipes.PipeTransmissionMode]::Byte, $pipeOptions)
  $startInfo.Arguments = '--provision-secret-pipe=' + $pipeName + ' --kiosk-profile="' + $profilePath + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $pipe.WaitForConnectionAsync().Wait(15000)) { throw 'Key pipe connection timed out. Close the kiosk before provisioning.' }
  $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false))
  $writer.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
  $writer.Dispose()
  if (-not $process.WaitForExit(30000)) { throw 'Key provisioning did not finish; inspect the host before retrying.' }
  if ($process.ExitCode -ne 0) { throw 'Key provisioning failed. Close the kiosk before provisioning.' }
  Write-Host 'Windows 계정으로 암호화된 서명 키를 저장했습니다.'
} finally {
  if ($null -ne $pipe) { $pipe.Dispose() }
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $secret.Dispose()
}
