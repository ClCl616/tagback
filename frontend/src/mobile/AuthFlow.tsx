import { HTTP_AUTH, COOKIE_SESSION } from '../shared/authMode';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Delete, LockKeyhole, Smartphone, ShieldCheck } from 'lucide-react';
import { authApi } from '../shared/auth';
import { api, phoneValid, ServiceError } from '../shared/api';
import { browserSource, pinError, REGISTRATION_KEY } from '../shared/authPolicy';
import type { AuthResult, Challenge, Purpose, Verification } from '../shared/authTypes';
import { ErrorBox, Loading, MessagePopup } from '../shared/ui';

type Mode = 'access' | 'signup' | 'reset' | 'change';
type Step =
  | 'profile'
  | 'boot'
  | 'phone'
  | 'pin'
  | 'setup'
  | 'confirm'
  | 'blocked'
  | 'change-confirm'
  | 'done';
const PENDING = HTTP_AUTH ? 'tagback.http.pending-auth' : 'tagback.mobile.pending-auth';
export default function AuthFlow({
  mode,
  token,
  onLogin,
  onClear,
}: {
  mode: Mode;
  token: string;
  onLogin: (value: string) => void;
  onClear: () => void;
}) {
  const nav = useNavigate(),
    [params] = useSearchParams();
  const next = params.get('next');
  const destination =
    next &&
    /^\/mobile(?:\/|$)/.test(next) &&
    !/^\/mobile\/(login|signup|recover|change-phone)/.test(next)
      ? next
      : '/mobile/account';
  const [name, setName] = useState('');
  const [occupation, setOccupation] = useState('');
  const [step, setStep] = useState<Step>('boot');
  const [smsRestart, setSmsRestart] = useState(false);
  const [showPinPolicy, setShowPinPolicy] = useState(false);
  const policyShown = useRef(false);
  useEffect(() => {
    if (mode === 'signup' && step === 'setup' && !policyShown.current) {
      policyShown.current = true;
      setShowPinPolicy(true);
    }
  }, [mode, step]);
  const [phone, setPhone] = useState(''),
    [sms, setSms] = useState('');
  const [pin, setPin] = useState(''),
    [firstPin, setFirstPin] = useState('');
  const [challenge, setChallenge] = useState<Challenge>(),
    [verification, setVerification] = useState<Verification>();
  const [registration, setRegistration] = useState(''),
    [mask, setMask] = useState('');
  const [reauth, setReauth] = useState('');
  const [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState('');
  const [retryAt, setRetryAt] = useState(0),
    [locked, setLocked] = useState(false);
  const [now, setNow] = useState(Date.now()),
    [source] = useState(browserSource);
  const alive = useRef(true),
    running = useRef(false),
    operationId = useRef('');
  const purpose: Purpose = mode === 'reset' ? 'reset' : mode === 'change' ? 'change' : 'access';
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const pending = sessionStorage.getItem(PENDING);
    if (pending) {
      let saved: { id: string; mode: Mode };
      try {
        const parsed = JSON.parse(pending);
        if (!parsed.id || !['access', 'signup', 'reset', 'change'].includes(parsed.mode))
          throw new Error();
        saved = parsed;
      } catch {
        saved = { id: pending, mode };
      }
      if (saved.mode !== mode) {
        const route = {
          access: 'login',
          signup: 'signup',
          reset: 'recover',
          change: 'change-phone',
        }[saved.mode];
        nav('/mobile/' + route + '?next=' + encodeURIComponent(destination), { replace: true });
      }
      setUnknown(saved.id);
      setStep('phone');
    } else {
      (async () => {
        try {
          if (mode === 'change') {
            const me = await api.me(token);
            if (alive.current) {
              setMask('010-****-' + me.phone.slice(-4));
              setStep('pin');
            }
          } else if (mode === 'access') {
            const value = HTTP_AUTH ? COOKIE_SESSION : localStorage.getItem(REGISTRATION_KEY) || '';
            const reg = value ? await authApi.registration(value) : null;
            if (!alive.current) return;
            if (reg) {
              setRegistration(value);
              setMask(reg.maskedPhone);
              setRetryAt(reg.retryAt);
              setLocked(reg.locked);
              setStep('pin');
            } else {
              localStorage.removeItem(REGISTRATION_KEY);
              setStep('phone');
            }
          } else setStep(mode === 'signup' ? 'profile' : 'phone');
        } catch (e) {
          if (alive.current) {
            if (mode === 'change' && e instanceof ServiceError && e.code === 'AUTH') {
              nav('/mobile/login?next=%2Fmobile%2Faccount', { replace: true });
              return;
            }
            setError(e);
            setStep('phone');
          }
        }
      })();
    }
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const resend = Math.max(0, Math.ceil(((challenge?.resendAt || 0) - now) / 1000));
  const remaining = Math.max(0, Math.ceil(((challenge?.expiresAt || 0) - now) / 1000));
  const proofExpired = !!verification && verification.expiresAt <= now;
  async function task(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      if (!alive.current) return;
      setError(e);
      if (e instanceof ServiceError) {
        if (e.retryAt) setRetryAt(e.retryAt);
        if (e.code === 'PIN_LOCKED') setLocked(true);
        if (e.code === 'UNKNOWN' && operationId.current) setUnknown(operationId.current);
        else if (!unknown) {
          sessionStorage.removeItem(PENDING);
          if (HTTP_AUTH) operationId.current = '';
        }
        if (e.code === 'SMS_RESTART') {
          setSms('');
          setVerification(undefined);
          setSmsRestart(true);
        }
      } else if (!unknown) sessionStorage.removeItem(PENDING);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function complete(result: AuthResult) {
    if (!alive.current) return;
    sessionStorage.removeItem(PENDING);
    setUnknown('');
    setPin('');
    setFirstPin('');
    if ('token' in result) {
      if (!HTTP_AUTH) localStorage.setItem(REGISTRATION_KEY, result.registration);
      onLogin(result.token);
      nav(HTTP_AUTH || mode === 'access' ? '/mobile' : destination, { replace: true });
    } else {
      localStorage.removeItem(REGISTRATION_KEY);
      onClear();
      setStep('done');
    }
  }
  async function save(action: (id: string) => Promise<AuthResult>) {
    operationId.current ||= crypto.randomUUID();
    sessionStorage.setItem(PENDING, JSON.stringify({ id: operationId.current, mode }));
    complete(await action(operationId.current));
  }
  function startPhone() {
    setStep(
      mode === 'change'
        ? 'pin'
        : mode === 'signup' && (!name.trim() || !occupation.trim())
          ? 'profile'
          : 'phone',
    );
    if (mode === 'change') setReauth('');
    setPin('');
    setFirstPin('');
    setVerification(undefined);
    setChallenge(undefined);
    setSms('');
    setRegistration('');
    setError(undefined);
    setNotice('');
    setRetryAt(0);
    setLocked(false);
    operationId.current = '';
  }
  async function send() {
    if (!phoneValid(phone)) {
      setError(new Error('010으로 시작하는 11자리 전화번호를 입력해 주세요.'));
      return;
    }
    await task(async () => {
      const c = await authApi.requestSms(phone, purpose, source, reauth);
      if (!alive.current) return;
      setChallenge(c);
      setSmsRestart(false);
      setSms('');
      setVerification(undefined);
      setNow(Date.now());
      setNotice('');
    });
  }
  async function verify() {
    await task(async () => {
      if (!challenge) return;
      const v = await authApi.verifySms(challenge.id, phone, sms, purpose, source);
      if (!alive.current) return;
      setVerification(v);
      setMask(v.maskedPhone);
      setPin('');
      setNotice('');
      if (HTTP_AUTH) setStep('setup');
      else if (mode === 'reset') setStep(v.existing ? 'setup' : 'blocked');
      else if (mode === 'change') setStep('change-confirm');
      else if (v.needsPin) {
        setStep('blocked');
        setNotice('PIN 설정이 필요합니다. PIN 찾기에서 문자 인증 후 설정해 주세요.');
      } else {
        setStep(v.existing ? 'pin' : 'setup');
        setNotice(v.existing ? '기존 계정을 확인했습니다. 기존 PIN으로 로그인해 주세요.' : '');
      }
    });
  }
  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (busy || unknown || wait || locked) return;
    if (!/^\d{6}$/.test(pin)) {
      setError(new Error('숫자 6자리를 입력해 주세요.'));
      return;
    }
    if (step === 'setup') {
      const problem = pinError(pin);
      if (problem) {
        setError(new Error(problem));
        return;
      }
      setFirstPin(pin);
      setPin('');
      setError(undefined);
      setStep('confirm');
      return;
    }
    if (step === 'confirm' && pin !== firstPin) {
      setPin('');
      setFirstPin('');
      setStep('setup');
      setError(new Error('PIN이 일치하지 않습니다. 다시 설정해 주세요.'));
      return;
    }
    await task(async () => {
      if (mode === 'change') {
        const value = await authApi.reauthenticate(token, pin, source);
        if (!alive.current) return;
        setReauth(value);
        setPin('');
        setStep('phone');
        setNotice('기존 계정 확인 완료. 새 전화번호를 입력해 주세요.');
      } else if (step === 'pin') {
        await save((id) =>
          mode === 'access' && !registration && !verification
            ? authApi.loginWithPhone(id, phone, pin, source)
            : authApi.login(
                id,
                registration || verification?.proof || '',
                pin,
                !!registration,
                source,
              ),
        );
      } else if (mode === 'reset') {
        await save((id) => authApi.resetPin(id, verification?.proof || '', pin, source));
      } else {
        await save((id) =>
          authApi.signup(id, verification?.proof || '', pin, source, { name, occupation }),
        );
      }
    });
  }
  function editPin(value: string) {
    setPin(value.replace(/\D/g, '').slice(0, 6));
    operationId.current = '';
  }
  if (HTTP_AUTH && mode === 'change')
    return (
      <div className="page-content">
        <p>전화번호 변경은 아직 지원하지 않습니다.</p>
        <Link to="/mobile/account">마이페이지로</Link>
      </div>
    );
  const isPin = ['pin', 'setup', 'confirm'].includes(step);
  return (
    <div className="page-content auth-flow">
      <div className="auth-topline">
        <button
          className="text-button"
          disabled={busy || !!unknown}
          onClick={() => {
            if (step === 'confirm') {
              setStep('setup');
              setPin('');
              setFirstPin('');
            } else if (step === 'phone' && mode === 'signup') {
              startPhone();
              setStep('profile');
            } else if (isPin && mode !== 'change') startPhone();
            else nav('/mobile');
          }}
          aria-label="이전"
        >
          <ArrowLeft size={20} />
        </button>
        <span>
          {mode === 'reset'
            ? 'PIN 재설정'
            : mode === 'change'
              ? '전화번호 변경'
              : mode === 'signup'
                ? '회원가입'
                : '로그인'}
        </span>
      </div>
      {unknown ? (
        <>
          <h1>처리 결과를 확인해 주세요.</h1>
          <p className="muted">
            요청이 이미 저장되었을 수 있습니다. 다시 가입하거나 PIN을 바꾸기 전에 결과를 확인하세요.
          </p>
          <button
            className="primary full"
            disabled={busy}
            onClick={() =>
              task(async () => {
                const result = await authApi.result(unknown);
                if (!alive.current) return;
                if (result) complete(result);
                else {
                  sessionStorage.removeItem(PENDING);
                  setUnknown('');
                  startPhone();
                  setNotice(
                    HTTP_AUTH
                      ? '로그인 세션을 확인하지 못했습니다. 이미 가입했다면 로그인해 주세요.'
                      : '저장된 결과가 없습니다. 인증부터 다시 진행해 주세요.',
                  );
                }
              })
            }
          >
            처리 결과 다시 확인
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              sessionStorage.removeItem(PENDING);
              setUnknown('');
              startPhone();
              setNotice(
                '결과 확인을 중단했습니다. 기존 처리가 완료되었을 수 있으므로 전화번호 인증으로 계정을 다시 확인하세요.',
              );
            }}
          >
            전화번호 인증으로 안전하게 재진입
          </button>
        </>
      ) : step === 'boot' ? (
        <Loading text="로그인 방법을 확인하고 있어요" />
      ) : step === 'profile' ? (
        <>
          <p className="signup-progress">1 / 4 · 개인정보</p>
          <h1>
            반가워요!
            <br />
            어떻게 불러드릴까요?
          </h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !occupation.trim()) {
                setError(new Error('이름과 직업을 입력해 주세요.'));
                return;
              }
              setName(name.trim());
              setOccupation(occupation.trim());
              setError(undefined);
              setStep('phone');
            }}
          >
            <label>
              이름
              <input
                autoComplete="name"
                value={name}
                maxLength={40}
                placeholder="이름을 입력해 주세요"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              직업
              <select
                className="occupation-select"
                aria-label="직업"
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
              >
                <option value="" disabled>
                  직업을 선택해 주세요
                </option>
                {['학생', '직장인', '자영업', '프리랜서', '구직 중', '기타'].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary full" type="submit">
              다음
              <ArrowRight size={18} />
            </button>
          </form>
        </>
      ) : step === 'done' ? (
        <>
          <ShieldCheck className="auth-symbol" />
          <h1>{mode === 'change' ? '전화번호가 변경되었습니다.' : 'PIN이 재설정되었습니다.'}</h1>
          <p>
            기존 로그인과 브라우저 등록이 모두 해제되었습니다. 전화번호와 PIN으로 다시 로그인해
            주세요.
          </p>
          <Link className="primary full" to="/mobile/login">
            로그인으로
          </Link>
        </>
      ) : step === 'blocked' ? (
        <>
          <ShieldCheck className="auth-symbol" />
          <h1>{verification?.needsPin ? 'PIN 설정이 필요해요.' : 'PIN 복구 안내'}</h1>
          <p>
            {verification?.needsPin
              ? 'PIN 찾기에서 등록된 전화번호로 문자를 인증한 뒤 새 PIN을 설정해 주세요.'
              : '등록된 전화번호로 다시 확인해 주세요. 기존 전화번호를 사용할 수 없다면 현재 자동 복구를 진행할 수 없습니다.'}
          </p>
          <Link className="primary full" to="/mobile/login">
            로그인으로 돌아가기
          </Link>
          <Link className="text-link" to="/mobile/recover">
            PIN 찾기로
          </Link>
        </>
      ) : step === 'change-confirm' ? (
        <>
          <h1>전화번호를 변경할까요?</h1>
          <p>새 전화번호 {mask}</p>
          <p>대여 기록은 유지되며 기존 로그인과 브라우저 등록은 모두 해제됩니다.</p>
          <button
            className="primary full"
            disabled={busy || proofExpired}
            onClick={() =>
              task(() => save((id) => authApi.changePhone(id, verification!.proof, reauth, source)))
            }
          >
            전화번호 변경 확정
          </button>
        </>
      ) : isPin ? (
        <>
          <section className="auth-login-card">
            <LockKeyhole className="auth-symbol" />
            <h1>
              {step === 'setup'
                ? mode === 'reset'
                  ? '변경할 PIN 번호를 입력해 주세요.'
                  : '사용할 PIN 번호를 설정해 주세요.'
                : step === 'confirm'
                  ? 'PIN 번호를 한 번 더 입력해 주세요.'
                  : 'PIN 번호를 입력해 주세요.'}
            </h1>
            <p className="auth-mask">{mask}</p>
            <form onSubmit={submitPin} aria-busy={busy}>
              <div className="pin-field">
                <div className="pin-dots" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, i) => (
                    <i key={i} className={i < pin.length ? 'filled' : ''} />
                  ))}
                </div>
                <input
                  aria-label="PIN 번호"
                  type="password"
                  inputMode="numeric"
                  autoComplete={step === 'pin' ? 'current-password' : 'new-password'}
                  maxLength={6}
                  value={pin}
                  disabled={busy || wait > 0 || locked || proofExpired}
                  onChange={(e) => editPin(e.target.value)}
                />
              </div>
              <div className="pin-keypad" aria-label="숫자 키패드">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'delete'].map(
                  (key) => (
                    <button
                      type="button"
                      key={key}
                      disabled={busy || wait > 0 || locked || proofExpired}
                      aria-label={
                        key === 'delete' ? '한 자리 지우기' : key === 'clear' ? '모두 지우기' : key
                      }
                      onClick={() =>
                        editPin(
                          key === 'clear' ? '' : key === 'delete' ? pin.slice(0, -1) : pin + key,
                        )
                      }
                    >
                      {key === 'delete' ? (
                        <Delete size={23} />
                      ) : key === 'clear' ? (
                        '전체 삭제'
                      ) : (
                        key
                      )}
                    </button>
                  ),
                )}
              </div>
              <button
                className="primary full"
                type="submit"
                disabled={busy || wait > 0 || locked || proofExpired}
              >
                {busy
                  ? '확인 중…'
                  : step === 'setup'
                    ? '계속'
                    : step === 'confirm'
                      ? mode === 'reset'
                        ? 'PIN 재설정'
                        : '가입 완료'
                      : mode === 'change'
                        ? '계정 확인'
                        : '로그인'}
                <ArrowRight size={18} />
              </button>
            </form>
          </section>

          {step === 'pin' && mode !== 'change' && (
            <div className="auth-links">
              <Link to="/mobile/recover">PIN 찾기</Link>
              <Link to={'/mobile/signup?next=' + encodeURIComponent(destination)}>회원가입</Link>
            </div>
          )}
        </>
      ) : (
        <>
          <section className="auth-login-card">
            <Smartphone className="auth-symbol" />
            <h1>
              {mode === 'change'
                ? '새 전화번호를 입력해 주세요.'
                : mode === 'reset'
                  ? '등록된 전화번호를 확인해 주세요.'
                  : '전화번호를 입력해 주세요.'}
            </h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (mode === 'access') {
                  if (!phoneValid(phone)) {
                    setError(new Error('010으로 시작하는 11자리 전화번호를 입력해 주세요.'));
                    return;
                  }
                  setMask('010-****-' + phone.replace(/\D/g, '').slice(-4));
                  setError(undefined);
                  setStep('pin');
                } else challenge ? verify() : send();
              }}
              aria-busy={busy}
            >
              <label>
                전화번호
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="010-0000-0000"
                  value={phone}
                  disabled={busy}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setChallenge(undefined);
                    setVerification(undefined);
                    setSms('');
                    setPin('');
                    setFirstPin('');
                    setError(undefined);
                    setNotice('');
                    operationId.current = '';
                  }}
                />
              </label>
              {mode === 'access' ? (
                <button className="primary full" type="submit" disabled={busy}>
                  다음
                </button>
              ) : (
                <>
                  {challenge && (
                    <>
                      <div className="auth-sms-field">
                        <div className="auth-label-row">
                          <label htmlFor="sms-code">SMS 인증번호</label>
                          <span className="note-text">
                            남은 시간 {Math.floor(remaining / 60)}:
                            {String(remaining % 60).padStart(2, '0')}
                          </span>
                        </div>
                        <input
                          id="sms-code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="6자리 인증번호"
                          value={sms}
                          disabled={busy || smsRestart || remaining === 0}
                          onChange={(e) => setSms(e.target.value.replace(/\D/g, ''))}
                        />
                      </div>
                      <button
                        className="primary full"
                        type="submit"
                        disabled={busy || smsRestart || sms.length !== 6 || !remaining || wait > 0}
                      >
                        인증번호 확인
                      </button>
                    </>
                  )}
                  <button
                    className="secondary full"
                    type="button"
                    disabled={busy || wait > 0}
                    onClick={() => {
                      if (resend > 0) {
                        setRetryAt(challenge!.resendAt);
                        setError(
                          new ServiceError(
                            'SMS_WAIT',
                            '인증번호 재발송을 잠시 기다려 주세요.',
                            challenge!.resendAt,
                          ),
                        );
                      } else void send();
                    }}
                  >
                    {challenge ? '인증번호 재발송' : '인증번호 발송'}
                  </button>
                </>
              )}
            </form>
          </section>

          <div className="auth-links">
            <Link to="/mobile/recover">PIN 찾기</Link>
            <Link to="/mobile/signup">회원가입</Link>
          </div>
          {mode === 'reset' && (
            <button className="text-button" onClick={() => setStep('blocked')}>
              기존 전화번호를 사용할 수 없어요
            </button>
          )}
        </>
      )}
      <ErrorBox
        error={
          error ||
          (proofExpired && !unknown
            ? '인증 결과가 만료되었습니다. 전화번호부터 다시 인증해 주세요.'
            : challenge && remaining === 0 && step === 'phone'
              ? '인증번호가 만료되었습니다. 다시 발송해 주세요.'
              : locked
                ? 'PIN 로그인이 제한되었습니다. PIN 찾기에서 계정을 복구해 주세요.'
                : undefined)
        }
      />
      {showPinPolicy && (
        <MessagePopup title="PIN 설정 안내" onClose={() => setShowPinPolicy(false)}>
          <ul className="pin-guidance">
            <li>숫자 6자리로 설정해 주세요.</li>
            <li>6자리 전체가 연속된 숫자는 사용할 수 없어요.</li>
            <li>같은 숫자를 3번 연속 사용할 수 없어요.</li>
          </ul>
        </MessagePopup>
      )}{' '}
      {error instanceof ServiceError &&
        ['REGISTRATION', 'SMS_REQUIRED', 'AUTH', 'RECOVERY'].includes(error.code) && (
          <button className="text-button" onClick={startPhone}>
            전화번호 인증부터 다시 시작
          </button>
        )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
