const path=require('node:path');
const {spawnSync}=require('node:child_process');
const prefix=Buffer.from('TBDPAPI1\n');
// DPAPI is tied directly to the Windows account. It does not require Chromium's
// asynchronously written Local State master key to survive a first-run crash.
function createWindowsStorage(legacy) {
  function transform(bytes,decrypt) {
    const method=decrypt?'Unprotect':'Protect';
    const script=`Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=[Text.Encoding]::UTF8.GetBytes('TagBackKiosk/storage/v1'); $value=[Security.Cryptography.ProtectedData]::${method}($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($value))`;
    const executable=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const result=spawnSync(executable,['-NoProfile','-NonInteractive','-Command',script],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4*1024*1024});
    if(result.error||result.status!==0||!result.stdout.trim())throw Error('WINDOWS_STORAGE_UNAVAILABLE');
    return Buffer.from(result.stdout.trim(),'base64');
  }
  return {
    isEncryptionAvailable:()=>process.platform==='win32',
    encryptString:value=>Buffer.concat([prefix,transform(Buffer.from(value,'utf8'),false)]),
    decryptString:bytes=>bytes.subarray(0,prefix.length).equals(prefix)?transform(bytes.subarray(prefix.length),true).toString('utf8'):legacy.decryptString(bytes),
  };
}
module.exports={createWindowsStorage};
