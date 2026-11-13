const { _electron, expect }=require('../../../frontend/node_modules/@playwright/test');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const net=require('node:net');
const {randomUUID}=require('node:crypto');
const host=path.resolve(__dirname,'..');
async function main() {
  const executable=path.join(host,'out/TagBackKiosk-win32-x64/TagBackKiosk.exe');
  const asar=require('@electron/asar');
  const archive=path.join(host,'out/TagBackKiosk-win32-x64/resources/app.asar');
  for(const name of fs.readdirSync(path.join(host,'src'))) assert.ok(asar.extractFile(archive,'src/'+name).equals(fs.readFileSync(path.join(host,'src',name))),`Package source mismatch: ${name}`);
  const output=path.join(host,'out/smoke');fs.mkdirSync(output,{recursive:true});
  const profile=fs.mkdtempSync(path.join(output,'profile-'));
  const testSecret='test-only-provisioning-secret-at-least-32-bytes';
  await new Promise((resolve,reject)=>{
    const name='tagback-provision-'+randomUUID();
    const server=net.createServer(socket=>socket.end(testSecret));
    server.on('error',reject);
    server.listen('\\\\.\\pipe\\'+name,()=>{
      const child=spawn(executable,[`--provision-secret-pipe=${name}`,`--kiosk-profile=${profile}`],{windowsHide:true,stdio:'ignore'});
      const timer=setTimeout(()=>{child.kill();server.close();reject(Error('Provisioning timeout'));},20000);
      child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);server.close();code===0?resolve():reject(Error(`Provisioning exit ${code}`));});
    });
  });
  const encrypted=fs.readFileSync(path.join(profile,'reader-secret.bin'));
  assert.equal(encrypted.includes(Buffer.from(testSecret)),false);
  console.log('PASS private-pipe key provisioning to Windows encrypted storage (test key in isolated profile).');
  const electron=await _electron.launch({executablePath:executable,args:[`--kiosk-profile=${profile}`],timeout:45000});
  try {
    const page=await electron.firstWindow();await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(()=>document.querySelector('#root')?.textContent?.includes('대여'));
    assert.equal(page.url(),'tagback://app/kiosk-app.html');
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
    const press=async(keyCode,modifiers=[])=>electron.evaluate(({BrowserWindow},{keyCode,modifiers})=>{
      const w=BrowserWindow.getAllWindows()[0];w.focus();w.webContents.focus();
      w.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
      w.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
    },{keyCode,modifiers});
    await press('F11');
    await expect.poll(()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
    await press('F11');
    await expect.poll(()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
    await electron.evaluate(({dialog})=>{
      global.shortcutMessages=[];
      dialog.showMessageBox=async(_window,options)=>{global.shortcutMessages.push(options.message);return {response:0,checkboxChecked:false};};
    });
    await press('F1');
    await press('Q',['control','shift']);
    const messages=await electron.evaluate(()=>global.shortcutMessages);
    assert.equal(messages.length,2);assert.match(messages[0],/F11/);assert.match(messages[1],/종료할까요/);
    await press('M',['control','shift']);
    await expect.poll(()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
    await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.focus();});
    console.log('PASS fullscreen default, F11 toggle, F1 help, exit confirmation cancellation and minimize shortcuts.');
    const state=await page.evaluate(async()=>({version:window.tagbackKioskHost.version,platform:window.tagbackKioskHost.platform,
      node:typeof window.require,exit:typeof window.tagbackKioskHost.requestExit,
      reader:await new Promise(resolve=>{const off=window.tagbackKioskHost.reader.subscribe(()=>{}, {onStatus:s=>{if(s!=='connecting'){resolve(s);queueMicrotask(off);}}});}),
      offline:await window.tagbackKioskHost.request({version:2,requestId:crypto.randomUUID(),command:{action:'health'}}).then(()=>false,()=>true),
      badCommand:await window.tagbackKioskHost.request({version:2,requestId:crypto.randomUUID(),command:{action:'fetch',url:'https://example.com'}}).then(()=>false,()=>true),
      browserNetworkBlocked:await fetch('https://example.com').then(()=>false,()=>true),
    }));
    assert.deepEqual(state,{version:2,platform:'windows',node:'undefined',exit:'undefined',reader:'disconnected',offline:true,badCommand:true,browserNetworkBlocked:true});
    const security=await electron.evaluate(({BrowserWindow,app})=>{
      const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      const wc=BrowserWindow.getAllWindows()[0].webContents;
      wc.openDevTools();
      return {packaged:app.isPackaged,sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,devToolsOpened:wc.isDevToolsOpened()};
    });
    assert.deepEqual(security,{packaged:true,sandbox:true,contextIsolation:true,nodeIntegration:false,devToolsOpened:false});
    await page.screenshot({path:path.join(output,'windows-kiosk.png')});
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({state,security,physicalReaderTested:false,serverDatabaseTested:false},null,2));
    console.log('PASS packaged Electron: local UI, host v2, isolated renderer, missing-config gate, denied arbitrary commands/network.');
  } finally {await electron.close();}
  const resources=path.join(host,'out/TagBackKiosk-win32-x64/resources/resources');
  await new Promise((resolve,reject)=>{
    const child=spawn(path.join(resources,'java/bin/java.exe'),['--add-modules=java.smartcardio','-cp',path.join(resources,'bridge.jar'),'com.tagback.nfc.bridge.PrivateBridgeMain'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const timer=setTimeout(()=>{child.kill();reject(Error('Reader IPC timeout'));},10000);
    let text='';
    child.on('error',reject);
    child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('READER_DISCONNECTED')) child.stdin.end();});
    child.on('exit',code=>{clearTimeout(timer);try {assert.equal(code,0);assert.match(text,/READER_DISCONNECTED/);resolve();}catch(error){reject(error);}});
    child.stdin.write(['TAGBACK_READER_V1',...['trial-bridge','TAGBACK_NONEXISTENT_READER','test-only-secret-at-least-32-bytes-long'].map(s=>Buffer.from(s).toString('base64'))].join('\n')+'\n');
  });
  console.log('PASS bundled Java private IPC: disconnected event and parent EOF shutdown (no hardware).');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
