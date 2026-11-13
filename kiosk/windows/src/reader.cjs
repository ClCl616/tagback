const {spawn}=require('node:child_process');
const path=require('node:path');
const {proof}=require('./transport.cjs');
function startReader(resources, config, secret, publish) {
  let child, timer, stopped=false, failures=0, status='disconnected';
  const emit=event=>{if(event.type==='READER_CONNECTED') status='connected';if(event.type==='READER_DISCONNECTED') status='disconnected';publish(event);};
  function start() {
    if(stopped) return;
    child=spawn(path.join(resources,'java','bin','java.exe'),['--add-modules=java.smartcardio','-cp',path.join(resources,'bridge.jar'),'com.tagback.nfc.bridge.PrivateBridgeMain'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot}});
    let buffer='', ended=false;
    const fail=()=>{
      if(ended) return;ended=true;child?.kill();emit({type:'READER_DISCONNECTED'});
      if(!stopped) timer=setTimeout(start,Math.min(30000,1000*2**Math.min(failures++,5)));
    };
    child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
    child.stderr.resume(); // Never forward native diagnostics or sensitive input to renderer/logs.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;
      if(buffer.length>65536) return fail();
      let end;
      while((end=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try {
          const e=JSON.parse(line);
          if(e.type==='TAG_READ') {
            if(!proof({bridgeId:e.bridgeId,uid:e.uid,issuedAt:e.issuedAt,nonce:e.nonce,signature:e.signature})||e.bridgeId!==config.bridgeId) return fail();
          } else if(!['TAG_REMOVED','READER_CONNECTED','READER_DISCONNECTED'].includes(e.type)) return fail();
          if(e.type==='READER_CONNECTED') failures=0;
          emit(e);
        } catch {return fail();}
      }
    });
    // Private framed startup: version + base64 fields. No secret in argv/environment/socket.
    child.stdin.write(['TAGBACK_READER_V1',config.bridgeId,config.readerName,secret].map((v,i)=>i?Buffer.from(v,'utf8').toString('base64'):v).join('\n')+'\n');
  }
  if(secret) start();
  return {status:()=>status,stop(){stopped=true;clearTimeout(timer);child?.stdin.end();child?.kill();}};
}
module.exports={startReader};
