import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';
import { authApi } from '../shared/auth';
import { pinError } from '../shared/authPolicy';
import { ServiceError } from '../shared/serviceError';
import type { AuthResult, KakaoChallenge, KakaoPurpose } from '../shared/authTypes';
import { ErrorBox, Loading } from '../shared/ui';

type Mode = 'access' | 'signup' | 'reset';
type Step = 'boot' | 'profile' | 'kakao' | 'pin' | 'setup' | 'confirm' | 'done';
const channelUrl = import.meta.env.VITE_KAKAO_CHANNEL_URL || '';
const pendingKey = 'tagback.http.pending-auth';
function clearPending() { try { sessionStorage.removeItem(pendingKey); } catch { /* Storage is optional. */ } }

export default function AuthFlow({ mode, onLogin, onClear, adminDestination }: {
  mode: Mode; token: string; onLogin: (value: string) => void; onClear: () => void; adminDestination?: string;
}) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const destination = adminDestination || (next && /^\/mobile(?:\/|$)/.test(next) && !/^\/mobile\/(login|signup|recover)/.test(next) ? next : '/mobile');
  const authBase = adminDestination ? '/admin' : '/mobile';
  const purpose: KakaoPurpose = mode === 'signup' ? 'SIGNUP' : mode === 'reset' ? 'PIN_RESET' : 'LOGIN';
  const [step, setStep] = useState<Step>(mode === 'signup' ? 'profile' : mode === 'reset' ? 'kakao' : 'boot');
  const [name, setName] = useState('');
  const [occupation, setOccupation] = useState('');
  const [challenge, setChallenge] = useState<KakaoChallenge>();
  const [verified, setVerified] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const [unknown, setUnknown] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [locked, setLocked] = useState(false);
  const key = useRef('');
  const alive = useRef(true);
  const activeChallenge = useRef<KakaoChallenge | undefined>(undefined);
  const uncertainResult = useRef(false);
  useEffect(() => { activeChallenge.current = challenge; }, [challenge]);
  useEffect(() => { uncertainResult.current = unknown; }, [unknown]);
  useEffect(() => () => {
    if (activeChallenge.current && !uncertainResult.current)
      void authApi.cancel(activeChallenge.current.id).catch(() => { /* Expiry remains the fallback if the browser is closing. */ });
  }, []);
  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
      if (saved?.mode === mode && typeof saved.id === 'string') { key.current = saved.id; setUnknown(true); }
    } catch { clearPending(); }
    if (mode === 'access') authApi.registration().then((value) => {
      if (!alive.current) return; setRegistered(value); setStep(value ? 'pin' : 'kakao');
    }).catch((e) => { if (alive.current) { setError(e); setStep('kakao'); } });
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [mode]);

  const checkStatus = useCallback(async (c: KakaoChallenge, quiet = false) => {
    try {
      const status = await authApi.status(c.id);
      if (!alive.current) return;
      if (status.purpose !== purpose) throw new Error('인증 목적을 확인하지 못했습니다. 다시 시작해 주세요.');
      if (status.status === 'VERIFIED') { setVerified(true); setPin(''); setStep(mode === 'access' ? 'pin' : 'setup'); setNotice('카카오톡 연결을 확인했습니다.'); }
      else if (status.status === 'EXPIRED' || status.status === 'CANCELED') { setChallenge(undefined); setVerified(false); setNotice('인증 요청이 만료되었거나 취소되었습니다. 다시 시작해 주세요.'); }
      else if (status.status === 'CONSUMED') { setChallenge(undefined); setNotice('이미 사용한 인증 요청입니다. 다시 시작해 주세요.'); }
      else if (!quiet) setNotice('아직 인증되지 않았습니다. 카카오톡에 코드를 입력해 주세요.');
    } catch (e) { if (!quiet && alive.current) setError(e); }
  }, [mode, purpose]);
  useEffect(() => {
    if (!challenge || verified || step !== 'kakao') return;
    const onVisible = () => { if (document.visibilityState === 'visible') void checkStatus(challenge, true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [challenge, verified, step, checkStatus]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await action(); }
    catch (e) {
      if (e instanceof ServiceError) {
        if (e.retryAt) setRetryAt(e.retryAt);
        if (e.code === 'PIN_LOGIN_BLOCKED') setLocked(true);
        if (e.code === 'KAKAO_IDENTITY_ALREADY_REGISTERED') setNotice('이미 가입된 계정입니다. 로그인하거나 PIN 찾기를 이용해 주세요.');
        if (e.code === 'ACCOUNT_NOT_FOUND') setNotice('연결된 계정이 없습니다. 가입한 카카오톡 계정을 확인해 주세요.');
      }
      setError(e);
    } finally { if (alive.current) setBusy(false); }
  }
  async function issue() {
    await run(async () => { const c = await authApi.issue(purpose); setChallenge(c); setVerified(false); setNow(Date.now()); setNotice('본인이 시작한 인증에만 코드를 입력해 주세요.'); });
  }
  async function cancel() {
    await run(async () => {
      if (challenge && !verified) await authApi.cancel(challenge.id);
      else if (challenge && verified && !unknown) await authApi.cancel(challenge.id);
      setChallenge(undefined); setVerified(false); setPin(''); setFirstPin(''); setNotice(''); setStep(mode === 'signup' ? 'profile' : 'kakao');
    });
  }
  function complete(result: AuthResult) {
    activeChallenge.current = undefined;
    clearPending(); key.current = ''; setUnknown(false); setPin(''); setFirstPin('');
    if ('token' in result) { onLogin(result.token); nav(destination, { replace: true }); }
    else { onClear(); setStep('done'); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) { setError(new Error('PIN 숫자 6자리를 입력해 주세요.')); return; }
    if (step === 'setup') { const problem = pinError(pin); if (problem) { setError(new Error(problem)); return; } setFirstPin(pin); setPin(''); setStep('confirm'); return; }
    if (step === 'confirm' && pin !== firstPin) { setError(new Error('처음 입력한 PIN과 일치하지 않습니다.')); setPin(''); return; }
    if (!registered && !challenge) { setError(new Error('카카오톡 인증을 다시 시작해 주세요.')); return; }
    await run(async () => {
      key.current ||= crypto.randomUUID();
      try { sessionStorage.setItem(pendingKey, JSON.stringify({ id: key.current, mode })); } catch { /* Do not persist PIN or request body. */ }
      try {
        const result = mode === 'signup' ? await authApi.signup(key.current, challenge!.id, pin, { name: name.trim(), occupation: occupation.trim() })
          : mode === 'reset' ? await authApi.resetPin(key.current, challenge!.id, pin)
          : registered ? await authApi.registeredLogin(key.current, pin)
          : await authApi.newBrowserLogin(key.current, challenge!.id, pin);
        complete(result);
      } catch (e) { if (e instanceof ServiceError && e.code === 'UNKNOWN') { uncertainResult.current = true; setUnknown(true); } else { clearPending(); key.current = ''; } throw e; }
    });
  }
  const remaining = challenge ? Math.max(0, Math.ceil((challenge.expiresAt - now) / 1000)) : 0;
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return <div className="auth-flow">
    <div className="auth-top"><Link to={authBase + '/login'} aria-label="로그인으로"><ArrowLeft size={20} /></Link><span>{mode === 'signup' ? '회원가입' : mode === 'reset' ? 'PIN 재설정' : '로그인'}</span></div>
    {unknown ? <div><h1>처리 결과를 확인해 주세요</h1><p>이전 요청이 이미 완료되었을 수 있습니다. 같은 요청의 결과를 확인해 주세요.</p><button className="secondary full" disabled={busy} onClick={() => void run(async () => {
      try { complete(await authApi.result(key.current)); }
      catch (e) { if (e instanceof ServiceError && e.code !== 'UNKNOWN' && e.code !== 'RECOVERY_UNCONFIRMED') { clearPending(); setUnknown(false); key.current = ''; } throw e; }
    })}>결과 다시 확인</button><button className="text-button" disabled={busy} onClick={() => { clearPending(); key.current = ''; setUnknown(false); setChallenge(undefined); setVerified(false); setPin(''); setFirstPin(''); setStep(mode === 'signup' ? 'profile' : 'kakao'); setNotice('이전 요청이 완료되었을 수 있습니다. 가입했다면 로그인하고, PIN을 변경했다면 새 PIN으로 로그인해 주세요.'); }}>인증 다시 시작</button></div>
    : step === 'boot' ? <Loading text="로그인 방법을 확인하고 있어요" /> : step === 'profile' ? <>
      <p className="signup-progress">1 / 4 · 프로필</p><h1>반가워요!<br />어떻게 불러드릴까요?</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !occupation.trim()) { setError(new Error('이름과 직업을 입력해 주세요.')); return; } setStep('kakao'); }}>
        <label>이름<input autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>직업<select aria-label="직업" className="occupation-select" value={occupation} onChange={(e) => setOccupation(e.target.value)}><option value="">직업을 선택해 주세요</option>{['학생', '직장인', '자영업', '프리랜서', '구직 중', '기타'].map((v) => <option key={v}>{v}</option>)}</select></label>
        <button className="primary full" type="submit">다음</button>
      </form>
    </> : step === 'kakao' ? <>
      {mode === 'signup' && <p className="signup-progress">2 / 4 · 카카오톡 연결</p>}
      <ShieldCheck className="auth-symbol" /><h1>카카오톡으로 연결해 주세요</h1>
      <p>TagBack 채널에 아래 코드를 입력한 뒤 이 화면으로 돌아와 주세요.</p>
      {challenge ? <><p className="auth-code" aria-label="인증 코드"><strong>{challenge.code}</strong></p><p>남은 시간 {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>
        {channelUrl ? <a className="primary full" href={channelUrl} target="_blank" rel="noopener noreferrer">카카오톡 채널 열기</a> : <p>카카오톡에서 TagBack 채널을 열어 주세요.</p>}
        <button className="secondary full" type="button" disabled={busy || !remaining} onClick={() => void run(() => checkStatus(challenge))}>인증 확인</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => void issue()}>새 코드 발급</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => void cancel()}>인증 취소</button></>
        : <button className="primary full" disabled={busy} onClick={() => void issue()}>카카오톡 인증 시작</button>}
    </> : step === 'done' ? <><ShieldCheck className="auth-symbol" /><h1>PIN이 재설정되었습니다.</h1><p>새 PIN으로 다시 로그인해 주세요.</p><Link className="primary full" to={authBase + '/login'}>로그인으로</Link></>
      : <section className="auth-login-card"><LockKeyhole className="auth-symbol" /><h1>{step === 'setup' ? '사용할 PIN을 설정해 주세요' : step === 'confirm' ? 'PIN을 한 번 더 입력해 주세요' : 'PIN을 입력해 주세요'}</h1>
        <form onSubmit={(e) => void submit(e)}><label>PIN 숫자 6자리<input type="password" inputMode="numeric" autoComplete={step === 'pin' ? 'current-password' : 'new-password'} maxLength={6} value={pin} disabled={busy || unknown || wait > 0 || locked} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <button type="submit" className="primary full" disabled={busy || unknown || wait > 0 || locked || pin.length !== 6}>{wait ? `${wait}초 후 다시 시도` : '확인'}</button></form>
        {(mode !== 'access' || !registered) && <button className="text-button" disabled={busy || unknown} onClick={() => void cancel()}>인증 취소</button>}
        {mode === 'access' && registered && <button className="text-button" disabled={busy || unknown} onClick={() => { setRegistered(false); setPin(''); setStep('kakao'); }}>다른 브라우저로 인증하기</button>}
      </section>}
    {notice && <p className="auth-notice" role="status">{notice}</p>}
    {locked && <p>PIN 로그인이 제한되었습니다. PIN 찾기에서 재설정해 주세요.</p>}
    {step !== 'done' && <div className="auth-links"><Link to={authBase + '/login'}>로그인</Link><Link to={authBase + '/recover'}>PIN 찾기</Link>{!adminDestination && <Link to="/mobile/signup">회원가입</Link>}</div>}
    <ErrorBox error={error} />
  </div>;
}
