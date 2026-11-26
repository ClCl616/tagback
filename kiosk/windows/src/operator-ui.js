const $=id=>document.getElementById(id);
let state,certificate='',busy=false;
function message(text,error=false){$('message').hidden=!text;$('message').textContent=text;$('message').className=error?'error':'';}
async function call(action,input){const r=await window.operator.call(action,input);if(!r.ok)throw Error(r.message);return r.value;}
async function run(task){if(busy)return;busy=true;document.body.classList.add('busy');try{await task();}catch(e){message(e.message,true);}finally{busy=false;document.body.classList.remove('busy');}}
function config(){return {apiBaseUrl:$('apiBaseUrl').value.trim(),bridgeId:$('bridgeId').value.trim(),readerName:$('readerName').value.trim(),certificate,autoStart:$('autoStart').checked};}
function render(s){state=s;$('version').textContent='v'+s.version;$('unlockSection').hidden=s.unlocked;$('fields').disabled=!s.unlocked||!!s.pending||s.recoveryLocked;
  for(const name of ['apiBaseUrl','bridgeId','readerName'])$(name).value=s.config[name];
  certificate=s.config.certificate||'';$('autoStart').checked=s.config.autoStart;
  $('certificateInfo').textContent=certificate?'앱 전용 인증서가 등록되어 있습니다.':'기본 인증서 저장소 사용 · 운영 주소는 보통 추가 등록이 필요 없습니다.';
  $('readerStatus').textContent=s.reader==='connected'?'연결됨':'연결 확인 필요';$('keyStatus').textContent=s.keyReady?'암호화 저장됨':'설정 필요';
  $('recovery').hidden=!s.pending&&!s.recoveryLocked;
  $('pending').textContent=s.pending?`작업: ${{rent:'대여',return:'반납','admin-tag':'태그 연결'}[s.pending.action]}\n물품 ID: ${s.pending.itemId||'확인 필요'}\n작업 ID: ${s.pending.operationId}\n요청 시각: ${s.pending.createdAt}`:'복구 기록을 읽지 못했습니다. Windows 계정과 프로필을 확인하세요. 기록을 삭제하지 말고 관리자에게 문의하세요.';
  $('retry').disabled=!s.unlocked||!s.pending||!s.recoveryLocked;$('reconcile').disabled=!s.unlocked||!s.pending||!s.recoveryLocked;
  if(!s.configured)message('처음 실행하는 기기입니다. 서버 주소와 리더기 설정을 입력하고 저장하세요.');
}
$('unlockForm').onsubmit=e=>{e.preventDefault();const password=$('password').value;$('password').value='';void run(async()=>{render(await call('unlock',password));message('5분 동안 설정을 변경할 수 있습니다.');});};
$('diagnose').onclick=()=>void run(async()=>{const d=await call('diagnose',config());$('serverStatus').textContent=d.server==='connected'?'연결 정상':'연결 확인 필요';$('diagnosis').textContent=d.message;$('readerStatus').textContent=d.reader==='connected'?'연결됨':'연결 확인 필요';$('keyStatus').textContent=d.keyReady?'암호화 저장됨':'설정 필요';message(d.message,d.server!=='connected');});
$('settingsForm').onsubmit=e=>{e.preventDefault();const input={config:config(),secret:$('secret').value};$('secret').value='';void run(async()=>{render(await call('save',input));message('설정을 적용했습니다. 창을 닫고 키오스크를 이용하세요.');});};
$('certificate').onclick=()=>void run(async()=>{const result=await call('certificate');if(result){certificate=result.certificate;$('certificateInfo').textContent=result.info.subject+' · 만료 '+result.info.validTo;message('인증서를 선택했습니다. 저장하고 적용을 눌러 반영하세요.');}});
$('clearCertificate').onclick=()=>{certificate='';$('certificateInfo').textContent='추가 인증서 없음 · 저장 시 적용';};
$('restartReader').onclick=()=>void run(async()=>{render(await call('reader-restart'));message('리더기를 다시 연결하고 있습니다. 잠시 후 연결 검사를 누르세요.');});
$('findReaders').onclick=()=>void run(async()=>{const readers=await call('readers');$('readers').replaceChildren();for(const name of readers){const option=document.createElement('option');option.value=name;$('readers').append(option);}if(readers.length===1)$('readerName').value=readers[0];message(readers.length?`리더기 ${readers.length}개를 찾았습니다. 이름 필터 입력란에서 사용할 장치를 선택한 뒤 저장하세요.`:'연결된 리더기가 없습니다. USB 연결과 드라이버를 확인하세요.');});
$('adminWeb').onclick=()=>void run(()=>call('admin-web'));
$('export').onclick=()=>void run(async()=>{await call('export');message('진단 정보에는 비밀번호·키·인증코드를 포함하지 않습니다.');});
$('retry').onclick=()=>{const password=$('recoveryPassword').value;$('recoveryPassword').value='';void run(async()=>{const result=await call('retry',password);render(await call('state'));$('recoveryResult').textContent=JSON.stringify(result.result.data);message(result.message+'\n'+JSON.stringify(result.result.data));});};
$('reconcile').onclick=()=>{const input={password:$('recoveryPassword').value,reason:$('reason').value,confirmed:$('confirmed').checked};$('recoveryPassword').value='';void run(async()=>{const result=await call('reconcile',input);if(result){render(result);message('수동 확인 기록을 남겼습니다. 서버 거래는 변경하지 않았습니다.');}});};
void run(async()=>render(await call('state')));
