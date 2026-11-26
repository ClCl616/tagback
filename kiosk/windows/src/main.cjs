const {app,BrowserWindow,ipcMain,protocol,session,Menu,dialog,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {createTransport,apiOrigin}=require('./transport.cjs');
const {loadAssets,assetPath}=require('./assets.cjs');
const {startReader,listReaders}=require('./reader.cjs');
const {createHttpsClient}=require('./https-client.cjs');
const {validateConfig,atomicWrite,createJournal,legacyCertificate}=require('./profile.cjs');
const {installOperator}=require('./operator.cjs');
const storage=require('./windows-storage.cjs').createWindowsStorage(safeStorage);
const ENTRY='tagback://app/kiosk-app.html';
const provision=process.argv.find(v=>v.startsWith('--provision-secret-pipe='));
protocol.registerSchemesAsPrivileged([{scheme:'tagback',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
// Separate test profile is supported without enabling insecure networking or mock readers.
const profile=process.argv.find(v=>v.startsWith('--kiosk-profile='));
if(profile) app.setPath('userData',path.resolve(profile.slice('--kiosk-profile='.length)));
app.setAppUserModelId('com.squirrel.TagBackKiosk.TagBackKiosk');
if(require('electron-squirrel-startup')) app.quit();
else if(!app.requestSingleInstanceLock()) app.exit(provision?2:0);
else {
  let window,reader,transport;
  app.on('second-instance',()=>{window?.restore();window?.focus();});
  app.on('before-quit',event=>{if(transport?.hasPending()) event.preventDefault();else reader?.stop();});
  app.on('window-all-closed',()=>app.quit());
  app.whenReady().then(async()=>{
    const resources=app.isPackaged?path.join(process.resourcesPath,'resources'):path.join(__dirname,'..','resources');
    const {assets}=loadAssets(path.join(resources,'ui'));
    const profileDir=app.getPath('userData');fs.mkdirSync(profileDir,{recursive:true});
    // Operator provisions outside the renderer; encryption is tied to this Windows account.
    if(provision) {
      const name=provision.slice('--provision-secret-pipe='.length);
      if(!/^tagback-provision-[0-9a-f-]{36}$/.test(name)) throw Error('INVALID_PROVISION_PIPE');
      const input=await new Promise((resolve,reject)=>{
        const socket=net.connect('\\\\.\\pipe\\'+name);let value='';
        socket.setEncoding('utf8');socket.setTimeout(15000,()=>socket.destroy(Error('PROVISION_TIMEOUT')));
        socket.on('data',chunk=>{value+=chunk;if(Buffer.byteLength(value)>4096) socket.destroy(Error('SECRET_TOO_LARGE'));});
        socket.on('error',reject);socket.on('end',()=>resolve(value));
      });
      const secret=input.trimEnd();
      if(Buffer.byteLength(secret)<32||!storage.isEncryptionAvailable()) throw Error('SECRET_UNAVAILABLE');
      const file=path.join(profileDir,'reader-secret.bin');
      atomicWrite(file,storage.encryptString(secret));
      app.quit();return;
    }
    let config=null,secret=null,client=null,recoveryLocked=false,openOperator;
    try {
      const parsed=JSON.parse(fs.readFileSync(path.join(profileDir,'host-config.json'),'utf8'));
      config=legacyCertificate(validateConfig(parsed,true),profileDir);
      if(storage.isEncryptionAvailable()) secret=storage.decryptString(fs.readFileSync(path.join(profileDir,'reader-secret.bin')));
    } catch {secret=null;}
    function makeTransport() {
      client?.close();
      client=config?createHttpsClient(config.apiBaseUrl,config.certificate):null;
      try {
        transport=createTransport(config?.apiBaseUrl,client||fetch,createJournal(profileDir,storage));
        recoveryLocked=transport.hasPending();
      } catch {
        recoveryLocked=true;
        // Keep the failed encrypted journal intact and fail closed.
        transport=createTransport(config?.apiBaseUrl,client||fetch);
      }
    }
    makeTransport();
    const ses=session.defaultSession;
    ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    ses.setPermissionCheckHandler(()=>false);
    ses.on('will-download',event=>event.preventDefault());
    ses.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('tagback://app/')&&!details.url.startsWith('tagback://operator/')}));
    protocol.handle('tagback',request=>{
      const operatorFiles={'tagback://operator/index.html':['operator.html','text/html; charset=utf-8'],
        'tagback://operator/style.css':['operator.css','text/css'], 'tagback://operator/panel.js':['operator-ui.js','text/javascript']};
      if(Object.hasOwn(operatorFiles,request.url)&&request.method==='GET') {
        const [file,mime]=operatorFiles[request.url];return new Response(fs.readFileSync(path.join(__dirname,file)),{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }
      let name;try{name=assetPath(request.url);}catch{return new Response(null,{status:400});}
      const bytes=assets.get(name);
      if(request.method!=='GET'||!bytes) return new Response(null,{status:404});
      const mime=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream';
      return new Response(bytes,{headers:{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
    });
    window=new BrowserWindow({width:1280,height:900,minWidth:960,minHeight:640,fullscreen:true,show:false,title:'TagBack 키오스크',autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:!app.isPackaged}});
    Menu.setApplicationMenu(null);
    const trusted=event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===ENTRY;
    ipcMain.handle('kiosk:request',(event,request)=>{if(!trusted(event)) throw Error('UNTRUSTED_SENDER');if(recoveryLocked)throw Error('RECOVERY_REQUIRED');return transport.request(request);});
    ipcMain.handle('kiosk:reader-status',event=>{if(!trusted(event)) throw Error('UNTRUSTED_SENDER');return reader?.status()??'disconnected';});
    ipcMain.handle('kiosk:operator',event=>{if(!trusted(event))throw Error('UNTRUSTED_SENDER');openOperator();});
    function restartReader() {
      reader?.stop();reader=null;
      if(!window.isDestroyed())window.webContents.send('kiosk:reader',{type:'READER_DISCONNECTED'});
      if(config&&secret)reader=startReader(resources,config,secret,event=>{if(!window.isDestroyed())window.webContents.send('kiosk:reader',event);});
    }
    openOperator=installOperator({window,profileDir,listReaders:()=>listReaders(resources),config:()=>config?{...config}:null,hasSecret:()=>!!secret,
      readerStatus:()=>reader?.status()||'disconnected',transport:()=>transport,recoveryLocked:()=>recoveryLocked,restartReader,
      recovered(){recoveryLocked=false;void window.reload();},
      async save(next,newSecret){
        if(!storage.isEncryptionAvailable())throw Error('Windows 암호화 저장소를 사용할 수 없습니다.');
        if(profile&&next.autoStart)throw Error('별도 시험 프로필에서는 Windows 자동 실행을 설정할 수 없습니다.');
        const configFile=path.join(profileDir,'host-config.json'),keyFile=path.join(profileDir,'reader-secret.bin');
        const previousKey=fs.existsSync(keyFile)?fs.readFileSync(keyFile):null;
        try {
          if(newSecret)atomicWrite(keyFile,storage.encryptString(newSecret));
          atomicWrite(configFile,JSON.stringify(next,null,2));
        } catch(error){if(previousKey)atomicWrite(keyFile,previousKey);throw error;}
        config=next;if(newSecret)secret=newSecret;
        if(!profile) {
          const updater=path.resolve(path.dirname(process.execPath),'..','Update.exe');
          app.setLoginItemSettings(fs.existsSync(updater)?{openAtLogin:next.autoStart,path:updater,args:['--processStart','TagBackKiosk.exe']}:{openAtLogin:next.autoStart,path:process.execPath,args:[]});
        }
        makeTransport();restartReader();await window.loadURL(ENTRY);
      }});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,url)=>{if(url!==ENTRY) event.preventDefault();});
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    let shortcutDialog=false;
    window.webContents.on('before-input-event',async(event,input)=>{
      if(input.key==='F5'||((input.control||input.meta)&&['r','R'].includes(input.key))) event.preventDefault();
      const key=input.key.toLowerCase();
      const exit=input.control&&input.shift&&!input.alt&&key==='q';
      const minimize=input.control&&input.shift&&!input.alt&&key==='m';
      const settings=input.control&&input.shift&&!input.alt&&key==='s';
      if(!['f1','f11'].includes(key)&&!exit&&!minimize&&!settings) return;
      event.preventDefault();
      if(input.type!=='keyDown'||input.isAutoRepeat||shortcutDialog) return;
      if(key==='f11') {window.setFullScreen(!window.isFullScreen());return;}
      if(minimize) {window.minimize();return;}
      if(settings) {openOperator();return;}
      shortcutDialog=true;
      try {
        if(key==='f1') await dialog.showMessageBox(window,{type:'info',title:'키오스크 도움말',message:'F11  전체화면 / 창 모드\nCtrl+Shift+S  연결·설정\nCtrl+Shift+M  최소화\nCtrl+Shift+Q  종료 확인\nAlt+F4  창 닫기\nF1  단축키 안내',detail:'서버·인증서·리더기 문제는 연결·설정에서 확인하세요. 관리자 태그 등록은 시작 화면에서 이용합니다. 미확인 거래는 같은 요청으로 확인하며, 앱 재시작 후에도 보호합니다.'});
        else if(transport.hasPending()) await dialog.showMessageBox(window,{type:'warning',message:'서버 처리 결과를 먼저 확인해 주세요. 현재 종료할 수 없습니다.'});
        else {
          const answer=await dialog.showMessageBox(window,{type:'question',title:'키오스크 종료',message:'키오스크 프로그램을 종료할까요?',detail:'진행 중인 코드 입력 등 화면 상태는 저장되지 않습니다.',buttons:['계속 사용','종료'],defaultId:0,cancelId:0,noLink:true});
          if(answer.response===1&&!window.isDestroyed()) window.close();
        }
      } finally {shortcutDialog=false;}
    });
    window.on('close',event=>{
      if(transport.hasPending()) {event.preventDefault();dialog.showMessageBoxSync(window,{type:'warning',message:'서버 처리 결과가 확인되지 않았습니다. 같은 요청으로 결과를 확인하세요.'});}
    });
    restartReader();
    window.once('ready-to-show',()=>window.show());
    await window.loadURL(ENTRY);
    if(!config||!secret||recoveryLocked||process.argv.includes('--configure'))openOperator();
  }).catch(()=>{dialog.showErrorBox('TagBack 시작 실패','설정 또는 앱 파일을 확인해 주세요. 시험 패키지 README를 참고하세요.');app.exit(1);});
}
