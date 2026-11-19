import { useRef, useState } from 'react';
import { request } from '../shared/http';
export type AdminSession = { sessionId: string; channel: string; expiresAt: string };
export async function adminSession(): Promise<AdminSession> {
  const value = await request('/api/v1/admin/auth/session');
  if (typeof value?.sessionId !== 'string' || value.channel !== 'WEB' || !Number.isFinite(Date.parse(value.expiresAt)))
    throw new Error('관리자 세션을 확인하지 못했습니다.');
  return value;
}
export const adminLogout = () => request('/api/v1/admin/auth/logout', 'POST', {});
export function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [password,setPassword]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const lock=useRef(false);
  return <form className="aw-card" onSubmit={async e => {
    e.preventDefault(); if(lock.current) return; lock.current=true; setBusy(true);setError('');
    const secret=password;setPassword('');
    try { await request('/api/v1/admin/auth/login','POST',{password:secret}); await adminSession(); onLogin(); }
    catch(e) { setError(e instanceof Error ? e.message : '로그인에 실패했습니다.'); }
    finally { lock.current=false;setBusy(false); }
  }}>
    <label>관리자 비밀번호<input type="password" autoComplete="current-password" required maxLength={128}
      value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} autoFocus /></label>
    {error && <p role="alert">{error}</p>}
    <button className="aw-primary aw-full" disabled={busy || !password}>{busy ? '확인 중…' : '관리자 로그인'}</button>
    <p>비밀번호를 잊었다면 서버 운영자에게 문의하세요.</p>
  </form>;
}
