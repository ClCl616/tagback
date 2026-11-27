import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../shared/auth';
import { COOKIE_SESSION } from '../shared/authMode';
import { ErrorBox, Loading } from '../shared/ui';

export function safeNext(value: string | null): string {
  return value &&
    /^\/mobile(?:\/(?:items|rentals|history)(?:\/[0-9]+)?|\/code|\/account)?(?:\?[a-zA-Z0-9_=&+.%~-]*)?$/.test(
      value,
    )
    ? value
    : '/mobile';
}
export default function AuthFlow({
  mode,
  token,
  onLogin,
  onClear,
}: {
  mode: 'access' | 'signup';
  token: string;
  onLogin: (value: string) => void;
  onClear: () => void;
}) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [name, setName] = useState('');
  const [occupation, setOccupation] = useState('');
  const [profile, setProfile] = useState(false);
  const [existing, setExisting] = useState(false);
  const [loading, setLoading] = useState(mode === 'signup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    if (token && !uncertain) {
      nav(next, { replace: true });
      return;
    }
  }, [token, uncertain, nav, next]);
  useEffect(() => {
    if (mode !== 'signup') return;
    let active = true;
    authApi
      .pending()
      .then((value) => {
        if (!active) return;
        setName(value.nickname);
        setProfile(true);
        setExisting(!value.needsSignup);
      })
      .catch((e) => {
        if (active) setError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode]);
  async function start(switchAccount = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const url = await authApi.start(next, switchAccount);
      onClear();
      window.location.assign(url);
    } catch (e) {
      setError(e);
      locked.current = false;
      setBusy(false);
    }
  }
  async function complete() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await authApi.complete(name.trim(), occupation);
      setUncertain(false);
      onLogin(COOKIE_SESSION);
      nav(safeNext(result.next), { replace: true });
    } catch (e) {
      setError(e);
      setUncertain(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  return (
    <section className="auth-flow uw-access-pass">
      <div className="uw-auth-caption">
        <span>캠퍼스 이용증</span>
        <span>{profile ? '가입 정보' : '카카오 로그인'}</span>
      </div>
      <h1>
        {existing
          ? '로그인을 이어가세요'
          : profile
            ? '가입 정보를 확인해 주세요'
            : '카카오로 시작하세요'}
      </h1>
      {params.get('oauth') && (
        <p role="status">
          {params.get('oauth') === 'cancelled'
            ? '로그인을 취소했습니다.'
            : '로그인을 완료하지 못했습니다. 다시 시도해 주세요.'}
        </p>
      )}
      {existing ? (
        <>
          <p>가입된 카카오 계정을 확인했어요. 로그인 결과를 다시 확인할 수 있어요.</p>
          <button className="primary full" disabled={busy} onClick={() => void complete()}>
            로그인 계속
          </button>
          <button className="secondary full" disabled={busy} onClick={() => void start(true)}>
            다른 카카오 계정 사용
          </button>
        </>
      ) : profile ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void complete();
          }}
        >
          <p>카카오 닉네임을 불러왔어요. 서비스에서 사용할 닉네임으로 수정할 수 있어요.</p>
          <label>
            닉네임
            <input
              aria-label="닉네임"
              value={name}
              maxLength={40}
              required
              disabled={busy || uncertain}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            직업
            <select
              aria-label="직업"
              value={occupation}
              required
              disabled={busy || uncertain}
              onChange={(e) => setOccupation(e.target.value)}
            >
              <option value="">선택해 주세요</option>
              <option>학생</option>
              <option>교직원</option>
              <option>기타</option>
            </select>
          </label>
          {uncertain && (
            <p role="status">
              가입이 저장되었을 수 있어요. 같은 정보로 결과를 다시 확인하거나 카카오 로그인을 다시
              시작해 주세요.
            </p>
          )}
          <button className="primary full" disabled={busy || !name.trim() || !occupation}>
            {busy ? '확인 중…' : uncertain ? '가입 결과 다시 확인' : '가입 완료'}
          </button>
          <button
            type="button"
            className="secondary full"
            disabled={busy}
            onClick={() => void start(true)}
          >
            다른 카카오 계정 사용
          </button>
        </form>
      ) : (
        <>
          <p>처음 이용한다면 카카오 로그인 후 닉네임과 직업만 확인하면 돼요.</p>
          <button className="primary full kakao-login" disabled={busy} onClick={() => void start()}>
            {busy ? '연결 중…' : '카카오 로그인'}
          </button>
          <button className="secondary full" disabled={busy} onClick={() => void start(true)}>
            다른 카카오 계정 사용
          </button>
        </>
      )}
      <ErrorBox error={error} />
      <Link className="text-link" to="/mobile/items">
        물품 둘러보기
      </Link>
    </section>
  );
}
