const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createWindowsStorage}=require('../src/windows-storage.cjs');
test('DPAPI ciphertext decrypts in a fresh process without Chromium Local State',{skip:process.platform!=='win32'},()=>{
  const storage=createWindowsStorage({decryptString(){throw Error('unexpected legacy');}});
  const cipher=storage.encryptString('synthetic-test-secret');
  assert.equal(cipher.includes(Buffer.from('synthetic-test-secret')),false);
  const code="const fs=require('node:fs');const storage=require('./src/windows-storage.cjs').createWindowsStorage({});process.stdout.write(storage.decryptString(Buffer.from(fs.readFileSync(0,'utf8'),'base64')));";
  const result=spawnSync(process.execPath,['-e',code],{input:cipher.toString('base64'),encoding:'utf8',windowsHide:true,cwd:require('node:path').resolve(__dirname,'..')});
  assert.equal(result.status,0);assert.equal(result.stdout,'synthetic-test-secret');
  cipher[cipher.length-1]^=1;assert.throws(()=>storage.decryptString(cipher),/WINDOWS_STORAGE_UNAVAILABLE/);
});
