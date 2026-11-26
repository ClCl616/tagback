const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createTransport}=require('../src/transport.cjs');
const req=command=>({version:2,requestId:randomUUID(),command});
const json=data=>new Response(JSON.stringify(data));
const grant=()=>json({token:'private-grant',userId:'1',userName:'홍길동',expiresAt:'2099-01-01T00:00:00Z'});
const receipt={rentalId:'1',itemId:'2',itemTypeId:'3',rentalStatus:'RENTED',itemStatus:'RENTED',rentedAt:'2026-11-19T00:00:00Z',dueAt:'2026-11-22T00:00:00Z'};
test('write is durably recorded before network; new process replays same body and key',async()=>{
  let disk=null,originalKey;
  const journal={load:()=>disk,save:value=>{disk=structuredClone(value);}};
  const host=createTransport('https://example.com',async(url,options)=>{
    if(url.endsWith('/rental-grants'))return grant();
    assert.equal(disk.pending.command.operationId,options.headers['Idempotency-Key']);
    originalKey=options.headers['Idempotency-Key'];throw Error('lost response');
  },journal);
  const handle=(await host.request(req({action:'verify',code:'123456'}))).data.grantHandle;
  await assert.rejects(host.request(req({action:'rent',grantRef:handle,itemId:'2',itemTypeId:'3',operationId:randomUUID()})));
  const restored=createTransport('https://example.com',async(url,options)=>{
    assert.equal(options.headers['Idempotency-Key'],originalKey);assert.equal(options.headers.Authorization,'Bearer private-grant');
    assert.deepEqual(JSON.parse(options.body),{itemId:'2',itemTypeId:'3'});return json(receipt);
  },journal);
  assert.equal(restored.pendingSummary().itemId,'2');
  await assert.rejects(restored.request(req({action:'verify',code:'654321'})),/UNRESOLVED/);
  await restored.recover();assert.equal(restored.hasPending(),false);assert.equal(disk,null);
});
test('local persistence failure never sends a write',async()=>{
  let writes=0;
  const host=createTransport('https://example.com',async url=>{if(url.endsWith('/rental-grants'))return grant();writes++;return json(receipt);},{load:()=>null,save:()=>{throw Error('disk full');}});
  const handle=(await host.request(req({action:'verify',code:'123456'}))).data.grantHandle;
  await assert.rejects(host.request(req({action:'rent',grantRef:handle,itemId:'2',itemTypeId:'3',operationId:randomUUID()})),/disk full/);
  assert.equal(writes,0);assert.equal(host.hasPending(),true);
});
test('journal origin mismatch fails closed',()=>{
  assert.throws(()=>createTransport('https://new.example.com',fetch,{load:()=>({version:1,origin:'https://old.example.com'})}),/JOURNAL_INVALID/);
});
test('failed journal clear cannot release guard through receipt cache',async()=>{
  let failClear=true;
  const host=createTransport('https://example.com',async url=>url.endsWith('/rental-grants')?grant():json(receipt),{
    load:()=>null,save:value=>{if(value===null&&failClear)throw Error('disk full');}});
  const handle=(await host.request(req({action:'verify',code:'123456'}))).data.grantHandle;
  const c={action:'rent',grantRef:handle,itemId:'2',itemTypeId:'3',operationId:randomUUID()};
  await assert.rejects(host.request(req(c)));assert.equal(host.hasPending(),true);
  failClear=false;await host.request(req(c));assert.equal(host.hasPending(),false);
});
