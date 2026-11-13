const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createTransport,validate,apiOrigin}=require('../src/transport.cjs');
const {assetPath}=require('../src/assets.cjs');
const req=command=>({version:2,requestId:randomUUID(),command});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const rentReceipt={rentalId:'1',itemId:'2',itemTypeId:'3',rentalStatus:'RENTED',itemStatus:'RENTED',rentedAt:'2026-11-13T00:00:00Z',dueAt:'2026-11-14T00:00:00Z'};
async function grant(host) {return (await host.request(req({action:'verify',code:'123456'}))).data.grantHandle;}
const grantReply=()=>json({token:'server-secret-grant',maskedPhoneNumber:'010-****-1234',expiresAt:'2099-01-01T00:00:00Z'});
test('origin and privileged input are allowlisted',()=>{
  for(const value of ['http://localhost:8080','https://user:pw@example.com','https://example.com/path','https://example.com/?x=1']) assert.throws(()=>apiOrigin(value));
  assert.equal(apiOrigin('https://example.com'),'https://example.com');
  for(const c of [{action:'fetch',url:'https://evil.test'},{action:'health',headers:{}},{action:'verify',code:'12345'},{action:'scan',uid:'../etc',grantRef:randomUUID()}]) assert.throws(()=>validate(req(c)));
});
test('asset mapping cannot expose local files',()=>{
  assert.equal(assetPath('tagback://app/kiosk-app.html'),'kiosk-app.html');
  for(const u of ['file:///C:/secret','tagback://other/kiosk-app.html','tagback://app/%2e%2e%5csecret','tagback://app/assets/x.js?url=1','tagback://user@app/kiosk-app.html']) assert.equal(assetPath(u),null);
});
test('grant stays native, rental uses fixed path and idempotency key',async()=>{
  const calls=[];
  const host=createTransport('https://api.example.com',async(url,options)=>{calls.push({url,options});return calls.length===1?grantReply():json(rentReceipt);});
  const handle=await grant(host);assert.notEqual(handle,'server-secret-grant');
  const command={action:'rent',grantRef:handle,operationId:randomUUID(),itemId:'2',itemTypeId:'3'};
  const result=await host.request(req(command));assert.equal(result.status,200);assert.equal(host.hasPending(),false);
  assert.equal(calls[1].options.headers.Authorization,'Bearer server-secret-grant');
  assert.equal(calls[1].options.headers['Idempotency-Key'],command.operationId);
  assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].options.credentials,'omit');
  await host.request(req(command));assert.equal(calls.length,2);
  await assert.rejects(host.request(req({...command,itemId:'4'})),/OPERATION_CHANGED/);
});
test('unknown blocks new work and only exact replay can confirm',async()=>{
  let calls=0;
  const host=createTransport('https://api.example.com',async()=>{calls++;if(calls===1)return grantReply();if(calls===2)throw Error('network');return json(rentReceipt);});
  const command={action:'rent',grantRef:await grant(host),operationId:randomUUID(),itemId:'2',itemTypeId:'3'};
  await assert.rejects(host.request(req(command)),/OPERATION_UNKNOWN/);assert.equal(host.hasPending(),true);
  await assert.rejects(host.request(req({...command,operationId:randomUUID()})),/UNRESOLVED/);
  await assert.rejects(host.request(req({action:'verify',code:'123456'})),/UNRESOLVED/);
  await host.request(req(command));assert.equal(host.hasPending(),false);assert.equal(calls,3);
});
test('malformed receipt and auth failure after unknown do not release guard',async()=>{
  let calls=0;
  const host=createTransport('https://api.example.com',async()=>{calls++;return calls===1?grantReply():calls===2?json({ok:true}):json({error:{code:'RENTAL_GRANT_EXPIRED'}},401);});
  const c={action:'rent',grantRef:await grant(host),operationId:randomUUID(),itemId:'2',itemTypeId:'3'};
  await assert.rejects(host.request(req(c)));await assert.rejects(host.request(req(c)));assert.equal(host.hasPending(),true);
});
test('concurrent exact replay shares a single native request',async()=>{
  let calls=0,release;
  const host=createTransport('https://api.example.com',async()=>{calls++;if(calls===1)return grantReply();return new Promise(resolve=>{release=()=>resolve(json(rentReceipt));});});
  const c={action:'rent',grantRef:await grant(host),operationId:randomUUID(),itemId:'2',itemTypeId:'3'};
  const a=host.request(req(c)),b=host.request(req(c));release();
  const results=await Promise.all([a,b]);assert.equal(calls,2);assert.notEqual(results[0].requestId,results[1].requestId);
});
test('unconfigured host fails closed',async()=>{
  const host=createTransport(null,()=>{throw Error('must not fetch');});
  await assert.rejects(host.request(req({action:'health'})),/NOT_CONFIGURED/);
});
test('health accepts the real empty 200 response but business JSON remains mandatory',async()=>{
  const host=createTransport('https://api.example.com',async()=>new Response(null,{status:200}));
  const result=await host.request(req({action:'health'}));
  assert.equal(result.status,200);assert.equal(result.data,null);
  await assert.rejects(host.request(req({action:'verify',code:'123456'})),SyntaxError);
  const down=createTransport('https://api.example.com',async()=>new Response(null,{status:503}));
  assert.equal((await down.request(req({action:'health'}))).status,503);
});
test('return preserves ticket/proof/body and never adds an invented idempotency header',async()=>{
  const p={bridgeId:'bridge-1',uid:'11223344',issuedAt:Date.now(),nonce:randomUUID(),signature:'a'.repeat(64)};
  const ticket=randomUUID(),calls=[];
  const host=createTransport('https://api.example.com',async(url,options)=>{
    calls.push({url,options});
    return calls.length===1?json({scanTicketId:ticket,itemId:'2',rentalId:'1'}):json({...rentReceipt,rentalStatus:'RETURNED',itemStatus:'INSPECTION',condition:'DAMAGED',returnedAt:'2026-11-13T01:00:00Z'});
  });
  await host.request(req({action:'return-scan',proof:p}));
  const c={action:'return',operationId:randomUUID(),scanTicketId:ticket,proof:p,condition:'DAMAGED',returnCode:'123456'};
  const result=await host.request(req(c));assert.equal(result.status,200);assert.equal(host.hasPending(),false);
  assert.equal(calls[1].options.headers['Idempotency-Key'],undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body),{scanTicketId:ticket,proof:p,condition:'DAMAGED',returnCode:'123456'});
});
