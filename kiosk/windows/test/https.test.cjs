const {test}=require('node:test');
const assert=require('node:assert/strict');
const https=require('node:https');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createHttpsClient,certificateInfo,connectionMessage}=require('../src/https-client.cjs');
const {validateConfig,createJournal,legacyCertificate}=require('../src/profile.cjs');
test('settings reject HTTP, malformed reader IDs, private keys and unsupported flags',()=>{
  const input={apiBaseUrl:'https://example.com',bridgeId:'kiosk-1',readerName:' ACR1552U '};
  assert.equal(validateConfig(input).readerName,'ACR1552U');
  for(const extra of [{apiBaseUrl:'http://example.com'},{bridgeId:'bad id'},{readerName:''},{autoStart:'yes'},{certificate:'-----BEGIN PRIVATE KEY-----'}])assert.throws(()=>validateConfig({...input,...extra}));
  assert.match(connectionMessage({code:'DEPTH_ZERO_SELF_SIGNED_CERT'}),/인증서/);
});
test('custom trust stays bound to origin and still verifies TLS hostname',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tagback-tls-test-'));
  const openssl=process.env.OPENSSL_PATH||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
  let server,client,normal;
  try {
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(dir,'key'),' -out'.trim(),path.join(dir,'cert'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore',windowsHide:true});
    const cert=fs.readFileSync(path.join(dir,'cert'),'utf8');assert.match(certificateInfo(cert).fingerprint,/^[A-F0-9:]+$/);
    fs.writeFileSync(path.join(dir,'server.crt'),cert);
    assert.equal(legacyCertificate({apiBaseUrl:'https://localhost:8443'},dir).certificate,cert);
    assert.equal(legacyCertificate({apiBaseUrl:'https://example.com'},dir).certificate,undefined);
    assert.equal(legacyCertificate({apiBaseUrl:'https://127.0.0.1:8443'},dir).certificate,undefined);
    server=https.createServer({key:fs.readFileSync(path.join(dir,'key')),cert},(req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:'https://example.com'});res.end();}else{res.writeHead(200);res.end('ok');}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
    client=createHttpsClient(`https://localhost:${port}`,cert);normal=createHttpsClient(`https://localhost:${port}`);
    await assert.rejects(normal(`https://localhost:${port}`));
    assert.equal(await (await client(`https://localhost:${port}`)).text(),'ok');
    await assert.rejects(client('https://example.com'),/ORIGIN_MISMATCH/);
    await assert.rejects(client(`https://localhost:${port}/redirect`),/REDIRECT_BLOCKED/);
    const wrong=createHttpsClient(`https://127.0.0.1:${port}`,cert);
    try{await assert.rejects(wrong(`https://127.0.0.1:${port}`));}finally{wrong.close();}
  } finally {
    client?.close();normal?.close();if(server)await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tagback-tls-test-'));fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('journal storage requires encryption and preserves unreadable records',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tagback-journal-test-'));
  try {
    const unavailable=createJournal(dir,{isEncryptionAvailable:()=>false});assert.throws(()=>unavailable.save({secret:'test'}),/JOURNAL_LOCKED/);
    const cipher={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
    const journal=createJournal(dir,cipher);journal.save({secret:'test-private-value'});
    assert.equal(fs.readFileSync(path.join(dir,'pending-operation.bin')).includes(Buffer.from('test-private-value')),false);
    assert.deepEqual(journal.load(),{secret:'test-private-value'});journal.save(null);assert.equal(journal.load(),null);
    fs.writeFileSync(path.join(dir,'pending-operation.bin'),'corrupt');assert.throws(()=>journal.load());assert.equal(fs.existsSync(path.join(dir,'pending-operation.bin')),true);
  } finally {assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tagback-journal-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});
