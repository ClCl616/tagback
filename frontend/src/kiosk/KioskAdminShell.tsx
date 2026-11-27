import { useEffect, useRef, useState } from 'react';
import { MemoryRouter, UNSAFE_LocationContext } from 'react-router-dom';
import AdminWeb from '../admin/AdminWeb';
import { KioskAdminContext } from '../admin/KioskAdminContext';
import { kioskRequest } from '../kiosk-host/transport';
import { setAdminTransport } from '../shared/http';
import type { AdminSession } from '../admin/adminAuth';
import './kiosk-admin.css';
type Session = AdminSession & { token: string };
export default function KioskAdmin({ close }: { close: () => void }) {
  const [session, setSession] = useState<Session>(),
    [number, setNumber] = useState(''),
    [password, setPassword] = useState(''),
    [next, setNext] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const activity = useRef(Date.now()),
    requests = useRef(0),
    pending = useRef(false),
    loginLock = useRef(false);
  async function leave() {
    if (pending.current || requests.current || loginLock.current) return;
    if (session)
      void kioskRequest({ action: 'admin-logout', adminRef: session.token }).catch(() => {});
    setAdminTransport(undefined);
    close();
  }
  useEffect(() => {
    if (!session || session.mustChangePassword) return;
    setAdminTransport(async (path, method, body) => {
      requests.current++;
      try {
        if (path === '/api/v1/admin/auth/logout') {
          const result = await kioskRequest({ action: 'admin-logout', adminRef: session.token });
          if (result.ok)
            setTimeout(() => {
              setAdminTransport(undefined);
              close();
            }, 0);
          return result;
        }
        return await kioskRequest({
          action: 'admin-api',
          adminRef: session.token,
          path,
          method,
          body: body ?? null,
        });
      } finally {
        requests.current--;
      }
    });
    return () => setAdminTransport(undefined);
  }, [session]);
  useEffect(() => {
    const touch = () => {
      activity.current = Date.now();
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const timer = setInterval(() => {
      if (
        Date.now() - activity.current >= 300000 &&
        !pending.current &&
        !requests.current &&
        !loginLock.current
      )
        void leave();
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, [session]);
  async function login() {
    if (loginLock.current) return;
    loginLock.current = true;
    setBusy(true);
    setError('');
    try {
      if (session?.mustChangePassword) {
        const result = await kioskRequest({
          action: 'admin-api',
          adminRef: session.token,
          path: '/api/v1/admin/auth/password',
          method: 'POST',
          body: { currentPassword: password, newPassword: next },
        });
        if (!result.ok) throw Error('비밀번호를 변경하지 못했습니다. 입력 내용을 확인해 주세요.');
        setSession({ ...session, mustChangePassword: false });
        setPassword('');
        setNext('');
      } else {
        const response = await kioskRequest({
          action: 'admin-login',
          adminNumber: number,
          password,
        });
        const data: any = await response.json();
        if (!response.ok) throw Error(data?.error?.message || '관리자 인증에 실패했습니다.');
        if (typeof data.token !== 'string' || typeof data.adminNumber !== 'string')
          throw Error('관리자 응답을 확인하지 못했습니다.');
        setSession(data);
        if (!data.mustChangePassword) setPassword('');
      }
      activity.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인에 실패했습니다.');
    } finally {
      loginLock.current = false;
      setBusy(false);
    }
  }
  async function reauthenticate(password: string) {
    const response = await kioskRequest({
      action: 'admin-login',
      adminNumber: session!.adminNumber,
      password,
    });
    const auth: any = await response.json();
    if (!response.ok || typeof auth.token !== 'string' || auth.mustChangePassword)
      throw Error('관리자 재인증에 실패했습니다.');
    setSession(auth);
    activity.current = Date.now();
    return auth.token as string;
  }
  const authenticated = session && !session.mustChangePassword;
  return (
    <div className={authenticated ? 'kiosk-admin shared-kiosk-admin' : 'kiosk-admin ka-auth'}>
      <header>
        <strong>TagBack · {authenticated ? '관리자 모드' : '관리자 인증'}</strong>
        <button onClick={() => void leave()}>이용 화면으로</button>
        {authenticated && window.tagbackKioskHost?.openOperatorPanel && (
          <button onClick={() => void window.tagbackKioskHost?.openOperatorPanel?.()}>
            연결 설정
          </button>
        )}
      </header>
      {authenticated ? (
        <KioskAdminContext.Provider
          value={{
            token: session.token,
            reauthenticate,
            lock: (locked) => {
              pending.current = locked;
            },
          }}
        >
          <EmbeddedAdmin />
        </KioskAdminContext.Provider>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <h1>{session?.mustChangePassword ? '개인 비밀번호 설정' : '관리자 로그인'}</h1>
          {!session && (
            <label>
              관리자 번호
              <input
                inputMode="numeric"
                pattern="[0-9]{3}"
                maxLength={3}
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
                required
              />
            </label>
          )}
          <label>
            {session ? '임시 비밀번호' : '비밀번호'}
            <input
              type="password"
              autoComplete="off"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {session && (
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
          <button disabled={busy}>{session ? '비밀번호 변경' : '관리자 로그인'}</button>
        </form>
      )}
    </div>
  );
}
function EmbeddedAdmin() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? (
    <UNSAFE_LocationContext.Provider value={null!}>
      <MemoryRouter initialEntries={['/admin']}>
        <AdminWeb />
      </MemoryRouter>
    </UNSAFE_LocationContext.Provider>
  ) : (
    <p>관리자 화면을 준비하고 있습니다.</p>
  );
}
