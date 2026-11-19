const https = require('node:https');
const tls = require('node:tls');
const {X509Certificate} = require('node:crypto');
const {apiOrigin} = require('./transport.cjs');

function certificateInfo(pem, allowExpired = false) {
  if (typeof pem !== 'string' || Buffer.byteLength(pem) > 65536 || pem.includes('PRIVATE KEY')) throw Error('INVALID_CERTIFICATE');
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!blocks || blocks.length !== 1) throw Error('ONE_CERTIFICATE_REQUIRED');
  const cert = new X509Certificate(blocks[0]);
  if (!allowExpired && (Date.parse(cert.validTo) <= Date.now() || Date.parse(cert.validFrom) > Date.now())) throw Error('CERTIFICATE_EXPIRED');
  return {subject:cert.subject, fingerprint:cert.fingerprint256, validTo:cert.validTo};
}
function createHttpsClient(origin, certificate = '') {
  const base = apiOrigin(origin);
  if (certificate) certificateInfo(certificate,true); // TLS still enforces validity on every connection.
  const roots = tls.getCACertificates ? tls.getCACertificates('default') : tls.rootCertificates;
  const system = tls.getCACertificates ? tls.getCACertificates('system') : [];
  const agent = new https.Agent({keepAlive:true, ca:[...roots, ...system, ...(certificate ? [certificate] : [])], rejectUnauthorized:true});
  const client = (url, options = {}) => new Promise((resolve,reject) => {
    if (new URL(url).origin !== base) return reject(Error('ORIGIN_MISMATCH'));
    const req = https.request(url, {agent, method:options.method || 'GET', headers:options.headers, signal:options.signal}, res => {
      let size=0; const chunks=[];
      res.on('error',reject);
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)res.destroy(Error('RESPONSE_TOO_LARGE'));else chunks.push(chunk);});
      res.on('end',()=> {
        const status=res.statusCode;
        if(status>=300&&status<400) return reject(Error('REDIRECT_BLOCKED'));
        resolve(new Response(status===204?null:Buffer.concat(chunks),{status,headers:res.headers}));
      });
    });
    req.on('error',reject);
    req.end(options.body);
  });
  client.close = () => agent.destroy();
  return client;
}
function connectionMessage(error) {
  const code=error?.cause?.code || error?.code || error?.message;
  if (/CERT|SELF_SIGNED|VERIFY_LEAF|ISSUER/.test(code)) return '인증서를 신뢰할 수 없거나 서버 주소·유효기간이 맞지 않습니다. 운영 주소를 확인하거나 관리자가 제공한 인증서를 등록하세요.';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return '서버 주소를 찾지 못했습니다. 주소와 인터넷 연결을 확인하세요.';
  if (/ECONNREFUSED/.test(code)) return '서버가 연결을 받지 않습니다. 서버 실행 상태와 포트를 확인하세요.';
  if (/TIMEOUT|ABORT|Abort|Timeout/.test(code)) return '서버 응답 시간이 초과됐습니다. 인터넷 연결을 확인하고 다시 검사하세요.';
  return '서버에 연결하지 못했습니다. 주소·네트워크·인증서 설정을 확인하세요.';
}
module.exports={createHttpsClient,certificateInfo,connectionMessage};
