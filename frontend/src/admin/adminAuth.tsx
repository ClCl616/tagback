import { useRef, useState } from 'react';
import { request } from '../shared/http';
export type AdminSession = {
  sessionId: string;
  channel: string;
  expiresAt: string;
  adminNumber: string;
  name: string;
  mustChangePassword: boolean;
};
export async function adminSession(): Promise<AdminSession> {
  const value = await request('/api/v1/admin/auth/session');
  if (
    typeof value?.sessionId !== 'string' ||
    !['WEB', 'KIOSK'].includes(value.channel) ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    throw new Error('관리자 세션을 확인하지 못했습니다.');
  return value;
}
export const adminLogout = () => request('/api/v1/admin/auth/logout', 'POST', {});
export function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [number, setNumber] = useState(''),
    [next, setNext] = useState(''),
    [change, setChange] = useState(false);
  const [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  return (
    <form
      className="aw-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError('');
        const secret = password;
        try {
          if (change) {
            await request('/api/v1/admin/auth/password', 'POST', {
              currentPassword: secret,
              newPassword: next,
            });
            setPassword('');
            setNext('');
            onLogin();
          } else {
            await request('/api/v1/admin/auth/login', 'POST', {
              adminNumber: number,
              password: secret,
            });
            const session = await adminSession();
            if (session.mustChangePassword) setChange(true);
            else {
              setPassword('');
              onLogin();
            }
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : '로그인에 실패했습니다.');
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      {!change && (
        <label>
          관리자 번호
          <input
            inputMode="numeric"
            autoComplete="username"
            pattern="[0-9]{3}"
            maxLength={3}
            required
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
          />
        </label>
      )}
      {change && <p>첫 로그인입니다. 본인만 사용할 비밀번호로 변경해 주세요.</p>}
      <label>
        {change ? '임시 비밀번호' : '관리자 비밀번호'}
        <input
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </label>
      {change && (
        <label>
          새 비밀번호
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="aw-primary aw-full" disabled={busy || !password}>
        {busy ? '확인 중…' : change ? '비밀번호 변경' : '관리자 로그인'}
      </button>
      <p>비밀번호를 잊었다면 대표 관리자에게 문의하세요.</p>
    </form>
  );
}
