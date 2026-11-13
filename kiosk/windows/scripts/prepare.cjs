const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {loadAssets}=require('../src/assets.cjs');
const host=path.resolve(__dirname,'..'),repo=path.resolve(host,'../..');
function run(command,args,cwd=repo) {execFileSync(command,args,{cwd,stdio:'inherit',windowsHide:true});}
// Fixed commands only; never interpolate operator settings or secrets into a shell.
run('cmd.exe',['/d','/s','/c','pnpm build:kiosk'],path.join(repo,'frontend'));
run('cmd.exe',['/d','/s','/c','..\\..\\backend\\gradlew.bat jar --offline'],path.join(repo,'nfc/reader-bridge'));
const target=path.join(host,'resources');
if(path.dirname(target)!==host||path.basename(target)!=='resources') throw Error('INVALID_OUTPUT_PATH');
fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});
fs.cpSync(path.join(repo,'frontend/dist-kiosk'),path.join(target,'ui'),{recursive:true});
const {manifest}=loadAssets(path.join(target,'ui'));
const libs=path.join(repo,'nfc/reader-bridge/build/libs');
const jars=fs.readdirSync(libs).filter(name=>name.endsWith('.jar')&&!name.includes('sources'));
if(jars.length!==1) throw Error('AMBIGUOUS_BRIDGE_JAR');
fs.copyFileSync(path.join(libs,jars[0]),path.join(target,'bridge.jar'));
run('jlink',['--add-modules','java.base,java.smartcardio','--strip-debug','--no-header-files','--no-man-pages','--output',path.join(target,'java')]);
const javaVersion=execFileSync(path.join(target,'java/bin/java.exe'),['--version'],{encoding:'utf8',windowsHide:true});
if(!/^openjdk 21\./.test(javaVersion)) throw Error('JAVA_21_REQUIRED');
fs.writeFileSync(path.join(target,'package-manifest.json'),JSON.stringify({appVersion:require('../package.json').version,hostProtocolVersion:2,uiBuildHash:manifest.uiBuildHash,javaVersion:javaVersion.split('\n')[0],trial:true,signed:false},null,2));
console.log('Prepared verified UI, private reader bridge and Java 21 runtime.');
