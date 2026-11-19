const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createTransport,validate}=require('../src/transport.cjs');
const req=command=>({version:2,requestId:randomUUID(),command});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const login=()=>json({token:'server-admin-secret',sessionId:randomUUID(),expiresAt:'2099-01-01T00:00:00Z'});
const scan=()=>({bridgeId:'test-reader',uid:'AABBCCDD',issuedAt:Date.now(),nonce:randomUUID(),signature:'a'.repeat(64)});
test('administrator bearer remains native and logout invalidates its handle',async()=>{
  const calls=[];
  const host=createTransport('https://example.com',async(url,options)=>{
    calls.push({url,options});if(url.endsWith('/login'))return login();
    if(url.endsWith('/logout'))return new Response(null,{status:204});
    return json({items:[],totalPages:0});
  });
  const response=await host.request(req({action:'admin-login',password:'test-password'}));
  assert.equal(response.data.token,undefined);assert.notEqual(response.data.adminHandle,'server-admin-secret');
  const adminRef=response.data.adminHandle;
  await host.request(req({action:'admin-items',adminRef,keyword:'우산',page:0,pending:true}));
  assert.equal(calls[1].options.headers.Authorization,'Bearer server-admin-secret');
  assert.equal(calls[1].options.credentials,'omit');
  await host.request(req({action:'admin-logout',adminRef}));
  await assert.rejects(host.request(req({action:'admin-session',adminRef})),/ADMIN_SESSION_REQUIRED/);
});
test('unknown tag write blocks exit and new work but permits reauthentication and exact replay',async()=>{
  let writes=0;
  const host=createTransport('https://example.com',async(url,options)=>{
    if(url.endsWith('/login'))return login();
    if(url.endsWith('/tags')) {writes++;if(writes===1)throw Error('response lost');const body=JSON.parse(options.body);
      return json({itemId:body.itemId,uid:body.proof.uid,status:'AVAILABLE'});}
    throw Error('unexpected call');
  });
  let adminRef=(await host.request(req({action:'admin-login',password:'test-password'}))).data.adminHandle;
  const command={action:'admin-tag',adminRef,itemId:'1',operationId:randomUUID(),expectedUid:null,proof:scan()};
  await assert.rejects(host.request(req(command)),/OPERATION_UNKNOWN/);assert.equal(host.hasPending(),true);
  await assert.rejects(host.request(req({action:'verify',code:'123456'})),/UNRESOLVED/);
  await assert.rejects(host.request(req({action:'admin-logout',adminRef})),/UNRESOLVED/);
  adminRef=(await host.request(req({action:'admin-login',password:'test-password'}))).data.adminHandle;
  await host.request(req({...command,adminRef}));assert.equal(host.hasPending(),false);assert.equal(writes,2);
});
test('administrator commands require well-formed proof and never accept arbitrary URLs or headers',()=>{
  for(const command of [
    {action:'admin-login',password:'x'.repeat(129)},
    {action:'admin-items',adminRef:randomUUID(),keyword:'',page:-1,pending:true},
    {action:'admin-tag',adminRef:randomUUID(),itemId:'1',operationId:randomUUID(),expectedUid:null,proof:{uid:'AABBCCDD'}},
    {action:'admin-session',adminRef:randomUUID(),url:'https://other.example'},
  ])assert.throws(()=>validate(req(command)));
});
