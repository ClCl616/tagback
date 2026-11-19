const fs=require('node:fs');
const path=require('node:path');
const {apiOrigin}=require('./transport.cjs');
const {certificateInfo}=require('./https-client.cjs');
const defaults={apiBaseUrl:'https://tagback.chiro1.cloud',bridgeId:'kiosk-1',readerName:'ACR1552U',certificate:'',autoStart:false};
function validateConfig(input, allowExpired = false) {
  if(!input || typeof input!=='object') throw Error('INVALID_CONFIG');
  const apiBaseUrl=apiOrigin(input.apiBaseUrl);
  if(typeof input.bridgeId!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(input.bridgeId))throw Error('INVALID_BRIDGE_ID');
  if(typeof input.readerName!=='string'||!input.readerName.trim()||input.readerName.length>200)throw Error('INVALID_READER_NAME');
  const certificate=input.certificate||'';
  if(certificate)certificateInfo(certificate,allowExpired);
  if(input.autoStart!==undefined&&typeof input.autoStart!=='boolean')throw Error('INVALID_CONFIG');
  return {apiBaseUrl,bridgeId:input.bridgeId,readerName:input.readerName.trim(),certificate,autoStart:input.autoStart===true};
}
function atomicWrite(file,bytes) {
  const temp=file+'.tmp';const fd=fs.openSync(temp,'w');
  try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  fs.renameSync(temp,file);
}
function createJournal(dir,crypto) {
  const file=path.join(dir,'pending-operation.bin');
  return {
    load(){
      if(!fs.existsSync(file))return null;
      if(!crypto.isEncryptionAvailable())throw Error('JOURNAL_LOCKED');
      return JSON.parse(crypto.decryptString(fs.readFileSync(file)));
    },
    save(value){
      if(!crypto.isEncryptionAvailable())throw Error('JOURNAL_LOCKED');
      // An encrypted tombstone is atomic too; a crash cannot resurrect an older operation.
      atomicWrite(file,crypto.encryptString(JSON.stringify(value)));
    },
  };
}
function legacyCertificate(config,dir) {
  // Older local installs used NODE_EXTRA_CA_CERTS via Start-TagBackLocal.ps1.
  // Preserve that operator-provisioned trust only for a matching loopback server.
  const host=new URL(config.apiBaseUrl).hostname;
  if(config.certificate||!['localhost','127.0.0.1','[::1]'].includes(host))return config;
  const file=path.join(dir,'server.crt');
  if(!fs.existsSync(file)||fs.statSync(file).size>65536)return config;
  const certificate=fs.readFileSync(file,'utf8');
  try {
    certificateInfo(certificate);
    const cert=new (require('node:crypto').X509Certificate)(certificate);
    const matches=host==='localhost'?cert.checkHost(host,{subject:'never'}):cert.checkIP(host.replace(/[\[\]]/g,''));
    return matches?{...config,certificate}:config;
  } catch{return config;}
}
module.exports={defaults,validateConfig,atomicWrite,createJournal,legacyCertificate};
