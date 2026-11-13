const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function loadAssets(root) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'kiosk-build.json'),'utf8'));
  if(manifest.hostProtocolVersion!==2||manifest.transportVersion!==1||manifest.entry!=='kiosk-app.html'||!Array.isArray(manifest.files)||sha(JSON.stringify(manifest.files))!==manifest.uiBuildHash) throw Error('INVALID_UI_MANIFEST');
  const assets=new Map();
  for(const entry of manifest.files) {
    if(typeof entry.path!=='string'||! /^(?:assets\/[A-Za-z0-9_.-]+|kiosk-app\.html)$/.test(entry.path)||assets.has(entry.path)) throw Error('INVALID_UI_PATH');
    const bytes=fs.readFileSync(path.join(root,entry.path));
    if(sha(bytes)!==entry.sha256) throw Error('UI_HASH_MISMATCH');
    assets.set(entry.path,bytes);
  }
  if(!assets.has(manifest.entry)) throw Error('UI_ENTRY_MISSING');
  return {manifest,assets};
}
function assetPath(raw) {
  const url=new URL(raw);
  if(url.protocol!=='tagback:'||url.hostname!=='app'||url.port||url.username||url.password||url.search||url.hash) return null;
  const name=decodeURIComponent(url.pathname.slice(1));
  return /^(?:assets\/[A-Za-z0-9_.-]+|kiosk-app\.html)$/.test(name)?name:null;
}
module.exports={loadAssets,assetPath};
