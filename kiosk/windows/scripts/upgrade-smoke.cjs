const {_electron,expect}=require('../../../frontend/node_modules/@playwright/test');
const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const host=path.resolve(__dirname,'..'),output=path.join(host,'out/upgrade-smoke');
async function main(){
  fs.mkdirSync(output,{recursive:true});const profile=fs.mkdtempSync(path.join(output,'profile-'));
  const certFile=path.join(profile,'test-cert.crt'),keyFile=path.join(profile,'test-key.pem');
  execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',keyFile,'-out',certFile,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore',windowsHide:true});
  let writeCount=0,operationId,bodyBefore,crashNext=true,expireReplay=false;
  const server=https.createServer({key:fs.readFileSync(keyFile),cert:fs.readFileSync(certFile)},(req,res)=>{
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
      if(req.url==='/api/v1/kiosk/health'){res.writeHead(200);res.end();return;}
      if(req.url==='/api/v1/kiosk/admin/login')return JSON.parse(body).password==='test-admin-password'?json({token:'admin-secret',sessionId:randomUUID(),expiresAt:'2099-01-01T00:00:00Z'}):json({error:{code:'INVALID_PASSWORD'}},401);
      if(req.url==='/api/v1/kiosk/admin/logout'){res.writeHead(204);res.end();return;}
      if(req.url==='/api/v1/kiosk/rental-grants')return json({token:'test-grant-private',maskedPhoneNumber:'010-****-1234',expiresAt:'2099-01-01T00:00:00Z'});
      if(req.url==='/api/v1/rentals'){
        writeCount++;
        if(crashNext){operationId=req.headers['idempotency-key'];bodyBefore=body;crashNext=false;req.socket.destroy();return;}
        assert.equal(req.headers['idempotency-key'],operationId);assert.equal(body,bodyBefore);
        if(expireReplay)return json({error:{code:'RENTAL_GRANT_EXPIRED'}},401);
        return json({rentalId:'1',itemId:'2',itemTypeId:'3',rentalStatus:'RENTED',itemStatus:'RENTED',rentedAt:'2026-11-19T00:00:00Z',dueAt:'2026-11-22T00:00:00Z'});
      }
      json({error:{code:'NOT_FOUND'}},404);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`https://localhost:${server.address().port}`;
  let electron;
  const executable=path.join(host,'out/TagBackKiosk-win32-x64/TagBackKiosk.exe');
  try{
    electron=await _electron.launch({executablePath:executable,args:[`--kiosk-profile=${profile}`],timeout:45000});
    const page=await electron.firstWindow();await expect.poll(()=>electron.windows().length).toBe(2);
    let panel=electron.windows().find(p=>p!==page);await panel.waitForURL('tagback://operator/index.html');
    await panel.locator('#apiBaseUrl').fill(origin);await panel.locator('#readerName').fill('TAGBACK_NONEXISTENT_READER');
    await panel.locator('#diagnose').click();await expect(panel.locator('#diagnosis')).toContainText('인증서');
    await electron.evaluate(({dialog},certFile)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[certFile]});dialog.showMessageBox=async()=>({response:1});},certFile);
    await panel.locator('#certificate').click();await expect(panel.locator('#certificateInfo')).toContainText('localhost');
    await panel.locator('#diagnose').click();await expect(panel.locator('#diagnosis')).toContainText('서버 연결 정상');
    await panel.locator('#findReaders').click();await expect(panel.locator('#message')).toContainText('리더기');
    await panel.locator('#readerName').fill('TAGBACK_NONEXISTENT_READER');
    await panel.locator('#secret').fill('test-only-reader-secret-at-least-32-bytes');
    await panel.getByRole('button',{name:'저장하고 적용',exact:true}).click();await expect(panel.locator('#message')).toContainText('설정을 적용');
    assert.equal(fs.readFileSync(path.join(profile,'reader-secret.bin')).includes(Buffer.from('test-only-reader-secret')),false);
    assert.equal(fs.readFileSync(path.join(profile,'host-config.json'),'utf8').includes('test-only-reader-secret'),false);
    await expect(panel.locator('#apiBaseUrl')).toBeDisabled();
    const denied=await panel.evaluate(()=>window.operator.call('save',{config:{apiBaseUrl:'https://evil.invalid',bridgeId:'x',readerName:'x'},secret:'a'.repeat(32)}));assert.equal(denied.ok,false);
    await panel.locator('#password').fill('wrong-password');await panel.getByRole('button',{name:'설정 잠금 해제'}).click();await expect(panel.locator('#message')).toContainText('인증에 실패');
    await panel.locator('#password').fill('test-admin-password');await panel.getByRole('button',{name:'설정 잠금 해제'}).click();await expect(panel.locator('#apiBaseUrl')).toBeEnabled();
    await panel.screenshot({path:path.join(output,'configured-settings.png'),fullPage:true});
    await panel.close();
    await expect(page.getByRole('button',{name:'관리자 태그 등록',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'관리자 태그 등록',exact:true}).click();await expect(page.getByRole('heading',{name:'관리자 태그 등록·교체'})).toBeVisible();
    const pending=await page.evaluate(async()=>{const request=command=>window.tagbackKioskHost.request({version:2,requestId:crypto.randomUUID(),command});const reply=await request({action:'verify',code:'123456'});
      try{await request({action:'rent',grantRef:reply.data.grantHandle,itemId:'2',itemTypeId:'3',operationId:crypto.randomUUID()});}catch{return true;}return false;});
    assert.equal(pending,true);assert.equal(writeCount,1);
    const journal=fs.readFileSync(path.join(profile,'pending-operation.bin'));assert.equal(journal.includes(Buffer.from('test-grant-private')),false);
    const child=electron.process();const exited=new Promise(resolve=>child.once('exit',resolve));
    execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});await exited;electron=null;
    electron=await _electron.launch({executablePath:executable,args:[`--kiosk-profile=${profile}`],timeout:45000});
    const restarted=await electron.firstWindow();await expect.poll(()=>electron.windows().length).toBe(2);
    panel=electron.windows().find(p=>p!==restarted);await panel.waitForURL('tagback://operator/index.html');
    await expect(panel.locator('#pending')).toContainText(operationId);
    const blocked=await restarted.evaluate(()=>window.tagbackKioskHost.request({version:2,requestId:crypto.randomUUID(),command:{action:'verify',code:'654321'}}).then(()=>false,()=>true));assert.equal(blocked,true);
    await panel.locator('#password').fill('test-admin-password');await panel.getByRole('button',{name:'설정 잠금 해제'}).click();await expect(panel.locator('#retry')).toBeEnabled();
    await panel.screenshot({path:path.join(output,'restart-recovery.png'),fullPage:true});
    await panel.locator('#retry').click();await expect(panel.locator('#message')).toContainText('서버 응답을 확인');assert.equal(writeCount,2);
    await expect(panel.locator('#recovery')).toBeHidden();await panel.close();
    // A genuinely expired token must not be called successful. Require fresh
    // administrator authentication and an explicit record of manual reconciliation.
    crashNext=true;expireReplay=true;
    await restarted.evaluate(async()=>{const request=command=>window.tagbackKioskHost.request({version:2,requestId:crypto.randomUUID(),command});const g=await request({action:'verify',code:'123456'});
      await request({action:'rent',grantRef:g.data.grantHandle,itemId:'2',itemTypeId:'3',operationId:crypto.randomUUID()}).catch(()=>{});});
    const second=electron.process();const secondExit=new Promise(resolve=>second.once('exit',resolve));execFileSync('taskkill',['/PID',String(second.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});await secondExit;electron=null;
    electron=await _electron.launch({executablePath:executable,args:[`--kiosk-profile=${profile}`],timeout:45000});
    const thirdPage=await electron.firstWindow();await expect.poll(()=>electron.windows().length).toBe(2);panel=electron.windows().find(p=>p!==thirdPage);await panel.waitForURL('tagback://operator/index.html');
    await panel.locator('#password').fill('test-admin-password');await panel.getByRole('button',{name:'설정 잠금 해제'}).click();await expect(panel.locator('#retry')).toBeEnabled();
    await panel.locator('#retry').click();await expect(panel.locator('#message')).toContainText('아직 결과를 확정하지 못했습니다');
    await panel.getByText('자동 확인이 불가능한 경우',{exact:true}).click();await panel.locator('#reason').fill('시험 서버의 물품 2와 대여 1을 대조하여 수동 확인했습니다.');await panel.locator('#confirmed').check();
    await panel.locator('#recoveryPassword').fill('wrong');await panel.locator('#reconcile').click();await expect(panel.locator('#message')).toContainText('인증에 실패');await expect(panel.locator('#recovery')).toBeVisible();
    await electron.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await panel.locator('#recoveryPassword').fill('test-admin-password');await panel.locator('#reconcile').click();await expect(panel.locator('#message')).toContainText('서버 거래는 변경하지 않았습니다');
    await expect(panel.locator('#recovery')).toBeHidden();assert.equal(writeCount,4);
    const audit=fs.readFileSync(path.join(profile,'operator-reconciliation.jsonl'),'utf8');assert.ok(audit.includes(operationId));assert.ok(!audit.includes('test-admin-password'));await panel.close();
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({setup:true,tlsUntrustedRejected:true,appCertificateTrusted:true,unauthorizedSettingsRejected:true,keyEncrypted:true,sharedAdminUi:true,journalEncrypted:true,crashReplaySameKey:true,expiredTokenRemainsBlocked:true,manualReconciliationAuthenticated:true,serverDatabaseTested:false,physicalNfcTested:false},null,2));
    console.log('PASS packaged setup, TLS import, diagnostics, admin settings gate, encrypted secret, shared admin UI, crash/restart and exact recovery replay.');
  } finally{if(electron){try{execFileSync('taskkill',['/PID',String(electron.process().pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
