const { randomUUID } = require('node:crypto');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const uid = value => typeof value === 'string' && /^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(value);
const code = value => typeof value === 'string' && /^[0-9]{6}$/.test(value);
const fields = (obj, names) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).sort().join(',') === names.split(' ').sort().join(',');
function proof(p) {
  return fields(p, 'bridgeId uid issuedAt nonce signature') && uid(p.uid) && uuid(p.nonce) &&
    typeof p.bridgeId === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(p.bridgeId) &&
    Number.isSafeInteger(p.issuedAt) && p.issuedAt > 0 && typeof p.signature === 'string' && /^[0-9a-f]{64}$/i.test(p.signature);
}
function validate(request) {
  if (!fields(request, 'version requestId command') || request.version !== 2 || !uuid(request.requestId)) throw Error('INVALID_REQUEST');
  const c = request.command;
  const schemas = { health:'action', verify:'action code', catalog:'action grantRef', scan:'action uid grantRef',
    rent:'action operationId grantRef itemId itemTypeId', 'return-scan':'action proof',
    return:'action operationId scanTicketId proof condition returnCode' };
  if (!c || !Object.hasOwn(schemas, c.action) || !fields(c, schemas[c.action])) throw Error('INVALID_COMMAND');
  if (('grantRef' in c && !uuid(c.grantRef)) || ('operationId' in c && !uuid(c.operationId)) ||
      ('itemId' in c && !id(c.itemId)) || ('itemTypeId' in c && !id(c.itemTypeId)) ||
      ('uid' in c && !uid(c.uid)) || ('code' in c && !code(c.code)) ||
      ('returnCode' in c && !code(c.returnCode)) || ('scanTicketId' in c && !uuid(c.scanTicketId)) ||
      ('proof' in c && !proof(c.proof)) || ('condition' in c && !['NORMAL','DAMAGED'].includes(c.condition))) throw Error('INVALID_COMMAND');
  return c;
}
function apiOrigin(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('INVALID_API_ORIGIN');
  return u.origin;
}
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
function receipt(c, d, ticket) {
  if (!d || !id(d.rentalId) || !id(d.itemId) || !date(d.rentedAt) || !date(d.dueAt)) return false;
  if (c.action === 'rent') return d.itemId === c.itemId && d.itemTypeId === c.itemTypeId && d.rentalStatus === 'RENTED' && d.itemStatus === 'RENTED';
  return ticket && d.itemId === ticket.itemId && d.rentalId === ticket.rentalId && d.rentalStatus === 'RETURNED' &&
    d.itemStatus === (c.condition === 'NORMAL' ? 'AVAILABLE':'INSPECTION') && d.condition === c.condition && date(d.returnedAt);
}
// P2 memory-only guard. Durable operations and restart reconciliation belong to P4.
function createTransport(origin, fetcher = fetch) {
  const base = origin ? apiOrigin(origin) : null;
  const grants = new Map(), tickets = new Map(), finished = new Map();
  let pending;
  async function execute(c) {
    if (!base) throw Error('HOST_NOT_CONFIGURED');
    let route, body, token;
    if ('grantRef' in c) {
      token = grants.get(c.grantRef)?.token;
      if (!token) throw Error('UNKNOWN_GRANT');
    }
    switch (c.action) {
      case 'health': route='/api/v1/kiosk/health'; break;
      case 'verify': route='/api/v1/kiosk/rental-grants'; body={code:c.code}; break;
      case 'catalog': route='/api/v1/item-types'; break;
      case 'scan': route=`/api/tags/${c.uid}`; break;
      case 'rent': route='/api/v1/rentals'; body={itemId:c.itemId,itemTypeId:c.itemTypeId}; break;
      case 'return-scan': route='/api/v1/rentals/return/scan'; body={proof:c.proof}; break;
      case 'return': route='/api/v1/rentals/return'; body={scanTicketId:c.scanTicketId,proof:c.proof,condition:c.condition,returnCode:c.returnCode}; break;
    }
    const response = await fetcher(base+route, {method:body?'POST':'GET', redirect:'error', credentials:'omit',
      headers:{Accept:'application/json', ...(body?{'Content-Type':'application/json'}:{}),
        ...(token?{Authorization:`Bearer ${token}`} : {}), ...(c.action==='rent'?{'Idempotency-Key':c.operationId}:{})},
      body:body?JSON.stringify(body):undefined, signal:AbortSignal.timeout(c.action==='health'?2500:14000)});
    // Bounded stream, including responses without Content-Length.
    let size=0; const chunks=[];
    if (response.body) for await (const chunk of response.body) {
      size+=chunk.length; if (size>2*1024*1024) throw Error('RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(chunk));
    }
    const responseText=Buffer.concat(chunks).toString('utf8');
    // Health is ResponseEntity<Void>; business responses still require valid JSON.
    let data = c.action==='health' && !responseText.trim() ? null : JSON.parse(responseText);
    if (response.ok && c.action==='verify') {
      if (typeof data?.token!=='string' || !data.token.length || data.token.length>8192 || typeof data.maskedPhoneNumber!=='string' || !date(data.expiresAt)) throw Error('INVALID_GRANT_RESPONSE');
      for (const [key,g] of grants) if (g.expiresAt<Date.now() && pending?.grantRef!==key) grants.delete(key);
      if (grants.size>=32) throw Error('GRANT_CAPACITY');
      const handle=randomUUID(); grants.set(handle,{token:data.token,expiresAt:Date.parse(data.expiresAt)});
      data={grantHandle:handle,maskedPhoneNumber:data.maskedPhoneNumber,expiresAt:data.expiresAt};
    }
    if (response.ok && c.action==='return-scan') {
      if (!uuid(data?.scanTicketId) || !id(data.itemId) || !id(data.rentalId)) throw Error('INVALID_TICKET_RESPONSE');
      if (tickets.size>=32) tickets.delete(tickets.keys().next().value);
      tickets.set(data.scanTicketId,{itemId:data.itemId,rentalId:data.rentalId});
    }
    return {status:response.status,data};
  }
  return {
    hasPending:()=>!!pending,
    async request(request) {
      const c=validate(request), write=c.action==='rent'||c.action==='return';
      const wrap = result => ({version:2,requestId:request.requestId,...result});
      if (!write) {
        if (pending && c.action!=='health') throw Error('OPERATION_UNRESOLVED');
        return wrap(await execute(c));
      }
      // Canonical keys, independent of IPC object property order.
      const fingerprint=JSON.stringify(Object.fromEntries(Object.keys(c).sort().map(k=>[k,c[k]])));
      const old=finished.get(c.operationId);
      if (old) { if(old.fingerprint!==fingerprint) throw Error('OPERATION_CHANGED'); return wrap(old.result); }
      if (pending && (pending.id!==c.operationId || pending.fingerprint!==fingerprint)) throw Error('OPERATION_UNRESOLVED');
      if (!pending) pending={id:c.operationId,fingerprint,grantRef:c.grantRef,unknown:false};
      const operation=pending;
      if (!operation.promise) operation.promise=(async()=>{
        try {
          const result=await execute(c);
          const confirmed=result.status>=200&&result.status<300&&receipt(c,result.data,tickets.get(c.scanTicketId));
          const rejected=!operation.unknown&&result.status>=400&&result.status<500&&typeof result.data?.error?.code==='string';
          if (confirmed||rejected) {
            finished.set(c.operationId,{fingerprint,result});
            if(finished.size>32) finished.delete(finished.keys().next().value);
            pending=undefined;
          } else { operation.unknown=true; throw Error('OPERATION_UNKNOWN'); }
          return result;
        } catch { operation.unknown=true; throw Error('OPERATION_UNKNOWN'); }
        finally { operation.promise=undefined; }
      })();
      return wrap(await operation.promise);
    },
  };
}
module.exports={createTransport,validate,apiOrigin,proof};
