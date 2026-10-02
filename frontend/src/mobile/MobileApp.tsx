import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
  useParams,
} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  History,
  MapPin,
  Package,
  Search,
  Ticket,
  UserRound,
  Check,
  ShieldCheck,
  LogOut,
  SlidersHorizontal,
} from 'lucide-react';
import { api, normalizePhone, passwordValid, phoneValid } from '../shared/api';
import { MOBILE_TOKEN_KEY } from '../shared/config';
import { Badge, Brand, date, ErrorBox, Loading, ProductArt, useResource } from '../shared/ui';
const Auth = createContext({ token: '', setToken: (_: string) => {} });
function useAuth() {
  return useContext(Auth);
}
function MobileLayout() {
  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <Link to="/mobile" aria-label="TagBack 홈">
          <Brand />
        </Link>
        <Link className="account-icon" to="/mobile/account" aria-label="내 계정">
          <UserRound size={21} />
        </Link>
      </header>
      <main className="mobile-main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="모바일 메뉴">
        <NavLink to="/mobile" end>
          <Search />
          <span>물품 찾기</span>
        </NavLink>
        <NavLink to="/mobile/code">
          <Ticket />
          <span>대여 코드</span>
        </NavLink>
        <NavLink to="/mobile/rentals">
          <Package />
          <span>내 대여</span>
        </NavLink>
        <NavLink to="/mobile/history">
          <History />
          <span>이용 기록</span>
        </NavLink>
      </nav>
    </div>
  );
}
function Back({ title }: { title: string }) {
  return (
    <div className="page-top">
      <Link to="/mobile" aria-label="물품 찾기로">
        <ArrowLeft size={21} />
      </Link>
      <span>{title}</span>
    </div>
  );
}
function Explore() {
  const [params, setParams] = useSearchParams();
  const station = params.get('station') || 'engineering';
  const search = params.get('q') || '';
  const category = params.get('category') || '전체';
  const r = useResource(() => api.catalog(), [], true);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };
  const items = r.data?.items.filter((i) => i.stationId === station) || [];
  const kinds =
    r.data?.kinds.filter(
      (k) =>
        items.some((i) => i.kindId === k.id) &&
        k.name.includes(search.trim()) &&
        (category === '전체' || k.category === category),
    ) || [];
  return (
    <>
      <section className="explore-intro">
        <div className="eyebrow">
          <span /> OUR CAMPUS, SHARED.
        </div>
        <h1>
          필요한 순간,
          <br />
          가까이 있는 <em>TagBack.</em>
        </h1>
        <p>잠깐 필요한 물건, 함께 쓰면 되니까.</p>
      </section>
      <section className="explore-controls">
        <label className="station-select">
          <MapPin size={18} />
          <select
            aria-label="대여소 선택"
            value={station}
            onChange={(e) => update('station', e.target.value)}
          >
            <option value="engineering">공학관 대여소</option>
            <option value="library">중앙도서관 대여소</option>
          </select>
          <span className="station-open">물품 조회</span>
        </label>
        <label className="search-field">
          <Search size={20} />
          <input
            aria-label="물품명 검색"
            placeholder="어떤 물품이 필요하세요?"
            value={search}
            onChange={(e) => update('q', e.target.value)}
          />
          {search && (
            <button onClick={() => update('q', '')} aria-label="검색어 지우기">
              ×
            </button>
          )}
        </label>
        <div className="filter-chips">
          {['전체', '학습 용품', '생활 용품', '전자 기기'].map((c) => (
            <button
              key={c}
              className={category === c ? 'selected' : ''}
              onClick={() => update('category', c)}
            >
              {c}
            </button>
          ))}
        </div>
      </section>
      <section className="inventory">
        <div className="section-heading">
          <h2>
            대여할 수 있는 물품 <span>{kinds.length}</span>
          </h2>
          <SlidersHorizontal size={17} />
        </div>
        <p className="section-caption">
          {r.data?.stations.find((s) => s.id === station)?.location ||
            '대여소의 물품을 확인해 보세요'}
        </p>
        {r.loading ? (
          <Loading />
        ) : r.error ? (
          <ErrorBox error={r.error} retry={r.reload} />
        ) : !kinds.length ? (
          <div className="empty">
            <Search />
            <h3>찾으시는 물품이 없어요</h3>
            <p>다른 검색어나 대여소를 선택해 보세요.</p>
            <button className="secondary" onClick={() => setParams({ station })}>
              검색 초기화
            </button>
          </div>
        ) : (
          <div className="product-grid">
            {kinds.map((k) => {
              const all = items.filter((i) => i.kindId === k.id);
              const count = all.filter((i) => i.status === 'available' && i.active).length;
              return (
                <Link
                  key={k.id}
                  to={`/mobile/items/${k.id}?station=${station}`}
                  className="product-card"
                >
                  <div className="product-image">
                    <Badge tone={count ? 'green' : 'gray'}>
                      {count ? '대여 가능' : '현재 대여 불가'}
                    </Badge>
                    <ProductArt kind={k.art} />
                    <span className="product-arrow">
                      <ArrowRight size={17} />
                    </span>
                  </div>
                  <div className="product-info">
                    <span>{k.category}</span>
                    <h3>{k.name}</h3>
                    <p>
                      <strong>{count}개</strong> 대여 가능 <i /> 전체 {all.length}개
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
      <div className="how-banner">
        <div className="how-icon">
          <Ticket size={25} />
        </div>
        <div>
          <strong>빌리는 건 간단하게</strong>
          <p>코드 확인 → 현장 키오스크 → NFC 인식</p>
        </div>
        <ChevronRight size={18} />
      </div>
      <footer className="mobile-footer">
        함께 쓰고, 다시 연결하다.<span>TagBack · 캠퍼스 공유 서비스</span>
      </footer>
    </>
  );
}
function Detail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const station = params.get('station') || 'engineering';
  const r = useResource(() => api.catalog(), [], true);
  const { token } = useAuth();
  const kind = r.data?.kinds.find((k) => k.id === id);
  const location = r.data?.stations.find((s) => s.id === station);
  const items = r.data?.items.filter((i) => i.kindId === id && i.stationId === station) || [];
  const count = items.filter((i) => i.active && i.status === 'available').length;
  return (
    <>
      <Back title="물품 상세" />
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <ErrorBox error={r.error} retry={r.reload} />
      ) : !kind || !location ? (
        <div className="empty">
          물품을 찾을 수 없어요.<Link to="/mobile">물품 목록으로</Link>
        </div>
      ) : (
        <>
          <div className="detail-art">
            <ProductArt kind={kind.art} large />
          </div>
          <div className="page-content">
            <Badge tone={count ? 'green' : 'gray'}>{count ? '대여 가능' : '현재 대여 불가'}</Badge>
            <h1>{kind.name}</h1>
            <p className="muted">{kind.description}</p>
            <div className="stock-panel">
              <div>
                <span>대여 가능</span>
                <strong>
                  {count}
                  <small>개</small>
                </strong>
              </div>
              <div>
                <span>전체 수량</span>
                <strong>
                  {items.length}
                  <small>개</small>
                </strong>
              </div>
            </div>
            <div className="location-card">
              <MapPin />
              <div>
                <strong>{location.name}</strong>
                <p>{location.location}</p>
              </div>
            </div>
            <div className="note">
              <ShieldCheck size={20} />
              <p>
                대여는 현장 키오스크에서 진행해요.
                <br />
                실물을 NFC 리더기에 접촉한 뒤 확정해 주세요.
              </p>
            </div>
            {count ? (
              <Link
                className="primary full"
                to={token ? '/mobile/code' : '/mobile/login?next=%2Fmobile%2Fcode'}
              >
                {token ? '대여 코드 확인하기' : '로그인하고 대여 코드 확인'}
                <ArrowRight size={19} />
              </Link>
            ) : (
              <>
                <button className="primary full" disabled>
                  지금은 대여 가능한 물품이 없어요
                </button>
                <Link className="text-link" to="/mobile">
                  다른 물품 찾아보기
                </Link>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
function AuthPage({ signup = false }: { signup?: boolean }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const { setToken } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const destination =
    next && /^\/mobile(?:\/|$)/.test(next) && !/^\/mobile\/(login|signup)/.test(next)
      ? next
      : '/mobile/code';
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(undefined);
    if (!phoneValid(phone))
      return setError(new Error('010으로 시작하는 11자리 전화번호를 입력해 주세요.'));
    if (signup && !passwordValid(password))
      return setError(new Error('비밀번호는 영문·숫자·특수문자를 포함해 8자 이상 입력해 주세요.'));
    if (signup && password !== confirm)
      return setError(new Error('비밀번호 확인이 일치하지 않습니다. 다시 입력해 주세요.'));
    setBusy(true);
    try {
      const token = signup ? await api.signup(phone, password) : await api.login(phone, password);
      setToken(token);
      nav(destination, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Back title={signup ? '회원가입' : '로그인'} />
      <div className="page-content auth-content">
        <div className="round-icon">
          <UserRound />
        </div>
        <h1>
          {signup ? (
            <>
              반가워요,
              <br />
              함께 쓰는 일상의 시작.
            </>
          ) : (
            <>
              다시 만나 반가워요.
              <br />
              필요한 순간을 함께해요.
            </>
          )}
        </h1>
        <p className="muted">전화번호로 간편하게 계정을 이용하세요.</p>
        <form onSubmit={submit} noValidate>
          <label>
            전화번호
            <input
              type="tel"
              autoComplete="tel"
              placeholder="010-0000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <label>
            비밀번호
            <div className="password-input">
              <input
                type={show ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력해 주세요"
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </label>
          {signup && (
            <>
              <div className="password-rules">
                {[
                  [password.length >= 8, '8자 이상'],
                  [/[a-zA-Z]/.test(password), '영문'],
                  [/[0-9]/.test(password), '숫자'],
                  [/[\p{P}\p{S}]/u.test(password), '특수문자'],
                ].map(([valid, label]) => (
                  <span className={valid ? 'met' : ''} key={String(label)}>
                    <Check size={13} />
                    {label}
                  </span>
                ))}
              </div>
              <label>
                비밀번호 확인
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="비밀번호를 한 번 더 입력해 주세요"
                  required
                />
              </label>
              <p className="note-text">
                1인 1계정이 원칙입니다. 본인 확인 방식은 준비 중이며, 이 시연의 전화번호 입력은 본인
                인증을 의미하지 않습니다.
              </p>
            </>
          )}
          <ErrorBox error={error} />
          <button className="primary full" disabled={busy} type="submit">
            {busy ? '처리 중…' : signup ? '가입하고 시작하기' : '로그인'}
            <ArrowRight size={19} />
          </button>
        </form>
        <p className="auth-switch">
          {signup ? '이미 계정이 있으신가요?' : '아직 계정이 없으신가요?'}{' '}
          <Link
            to={`/mobile/${signup ? 'login' : 'signup'}?next=${encodeURIComponent(destination)}`}
          >
            {signup ? '로그인' : '회원가입'}
          </Link>
        </p>
      </div>
    </>
  );
}
function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const loc = useLocation();
  return token ? (
    children
  ) : (
    <Navigate to={`/mobile/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  );
}
function AuthError({ next }: { next: string }) {
  const { setToken } = useAuth();
  return (
    <div className="empty">
      <p>로그인이 만료되었어요.</p>
      <Link
        className="primary"
        onClick={() => setToken('')}
        to={`/mobile/login?next=${encodeURIComponent(next)}`}
      >
        다시 로그인
      </Link>
    </div>
  );
}
function CodePage() {
  const { token } = useAuth();
  const [renew, setRenew] = useState(0);
  const lastRenew = useRef(0);
  const r = useResource(
    () => {
      const requested = renew !== lastRenew.current;
      lastRenew.current = renew;
      return api.code(token, requested);
    },
    [token, renew],
    true,
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expired = !!r.data && r.data.expiresAt <= now;
  const used = r.data?.used;
  const seconds = Math.max(0, Math.ceil(((r.data?.expiresAt || 0) - now) / 1000));
  return (
    <div className="page-content">
      <div className="eyebrow">READY TO BORROW</div>
      <h1>나의 대여 코드</h1>
      <p className="muted">현장 키오스크에 아래 코드를 입력해 주세요.</p>
      {r.authError ? (
        <AuthError next="/mobile/code" />
      ) : r.loading ? (
        <Loading text="대여 코드를 확인하고 있어요" />
      ) : r.error ? (
        <ErrorBox error={r.error} retry={r.reload} />
      ) : (
        <div className={`code-card ${used || expired ? 'inactive' : ''}`}>
          <div className="ticket-icon">
            <Ticket size={28} />
          </div>
          <span>일회성 대여 코드</span>
          <strong className="code-number" aria-label="대여 코드">
            {used || expired ? '••••••' : r.data?.value}
          </strong>
          <div className="ticket-divider" />
          <p>
            <Clock3 size={16} />
            {used
              ? '이미 사용한 코드예요'
              : expired
                ? '유효시간이 지났어요'
                : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} 남음`}
          </p>
          {(used || expired) && (
            <button className="primary" onClick={() => setRenew((n) => n + 1)}>
              새 코드 확인하기
            </button>
          )}
        </div>
      )}
      <div className="instructions">
        <h2>이렇게 대여하세요</h2>
        {[
          ['물품을 선택해요', '키오스크에서 대여할 물품 종류를 선택해요.'],
          ['코드를 입력해요', '위 코드를 입력하면 대여자를 확인할 수 있어요.'],
          ['NFC 인식 후 대여를 확정해요', '실물을 리더기에 접촉하고 정보를 확인해요.'],
        ].map(([a, b], i) => (
          <div key={a}>
            <span>{i + 1}</span>
            <section>
              <strong>{a}</strong>
              <p>{b}</p>
            </section>
          </div>
        ))}
      </div>
      <div className="note">
        <ShieldCheck size={19} />
        <p>
          코드는 본인만 사용해 주세요.
          <br />
          대여 완료 여부는 내 대여에서 확인할 수 있어요.
        </p>
      </div>
      <p className="demo-footnote">시연 코드 · 형식과 유효시간은 임시 설정입니다.</p>
    </div>
  );
}
function Rentals({ history = false }: { history?: boolean }) {
  const { token } = useAuth();
  const r = useResource(
    async () => ({ rentals: await api.rentals(token), catalog: await api.catalog() }),
    [token],
    true,
  );
  const rows = r.data?.rentals.filter((r) => (history ? !!r.returnedAt : !r.returnedAt)) || [];
  return (
    <div className="page-content">
      <div className="eyebrow">{history ? 'YOUR SHARED MOMENTS' : 'WITH YOU NOW'}</div>
      <h1>
        {history ? '함께 쓴 기록' : '내 대여 현황'} <small>{rows.length}</small>
      </h1>
      <p className="muted">
        {history
          ? '잘 쓰고 돌려준 물품들을 모았어요.'
          : '사용이 끝나면 현장 키오스크에서 반납해 주세요.'}
      </p>
      {r.authError ? (
        <AuthError next={history ? '/mobile/history' : '/mobile/rentals'} />
      ) : r.loading ? (
        <Loading />
      ) : r.error ? (
        <ErrorBox error={r.error} retry={r.reload} />
      ) : !rows.length ? (
        <div className="empty">
          <Package size={38} />
          <h3>{history ? '아직 이용 기록이 없어요' : '지금 대여 중인 물품이 없어요'}</h3>
          <Link className="secondary" to="/mobile">
            물품 찾아보기
          </Link>
        </div>
      ) : (
        <div className="rental-list">
          {rows.map((row) => {
            const item = r.data!.catalog.items.find((i) => i.id === row.itemId)!;
            const kind = r.data!.catalog.kinds.find((k) => k.id === item.kindId)!;
            const overdue = !row.returnedAt && row.dueAt < Date.now();
            return (
              <article className="rental-card" key={row.id}>
                <div className="rental-title">
                  <ProductArt kind={kind.art} />
                  <div>
                    <Badge tone={history ? 'gray' : overdue ? 'orange' : 'green'}>
                      {history
                        ? row.condition === 'damaged'
                          ? '반납 완료 · 점검 접수'
                          : '반납 완료'
                        : overdue
                          ? '연체'
                          : '대여 중'}
                    </Badge>
                    <h2>{kind.name}</h2>
                    <p>{item.label}</p>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>대여소</dt>
                    <dd>{r.data!.catalog.stations.find((s) => s.id === row.stationId)?.name}</dd>
                  </div>
                  <div>
                    <dt>대여 시각</dt>
                    <dd>{date(row.rentedAt)}</dd>
                  </div>
                  <div className={overdue ? 'overdue' : ''}>
                    <dt>{history ? '실제 반납' : '반납 예정'}</dt>
                    <dd>{date(history ? row.returnedAt! : row.dueAt)}</dd>
                  </div>
                </dl>
                {overdue && (
                  <p className="overdue-hint">반납 예정일이 지났어요. 현장에서 반납해 주세요.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
      {!history && (
        <Link to="/mobile/history" className="list-link">
          과거 대여 기록 보기
          <ChevronRight size={18} />
        </Link>
      )}
    </div>
  );
}
function Account() {
  const { token, setToken } = useAuth();
  const r = useResource(() => api.me(token), [token]);
  return (
    <div className="page-content">
      <h1>내 계정</h1>
      {r.authError ? (
        <AuthError next="/mobile/account" />
      ) : r.loading ? (
        <Loading />
      ) : r.error ? (
        <ErrorBox error={r.error} retry={r.reload} />
      ) : (
        <>
          <p className="account-phone">
            {normalizePhone(r.data?.phone || '').replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3')}
          </p>
          <button
            className="secondary"
            onClick={async () => {
              await api.logout(token);
              setToken('');
            }}
          >
            <LogOut size={18} />
            로그아웃
          </button>
        </>
      )}
    </div>
  );
}
export default function MobileApp() {
  const [token, setTokenState] = useState(() => sessionStorage.getItem(MOBILE_TOKEN_KEY) || '');
  const setToken = (v: string) => {
    setTokenState(v);
    if (v) sessionStorage.setItem(MOBILE_TOKEN_KEY, v);
    else sessionStorage.removeItem(MOBILE_TOKEN_KEY);
  };
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <Auth.Provider value={{ token, setToken }}>
      <Routes>
        <Route element={<MobileLayout />}>
          <Route index element={<Explore />} />
          <Route path="items/:id" element={<Detail />} />
          <Route path="login" element={<AuthPage />} />
          <Route path="signup" element={<AuthPage signup />} />
          <Route
            path="code"
            element={
              <Protected>
                <CodePage />
              </Protected>
            }
          />
          <Route
            path="rentals"
            element={
              <Protected>
                <Rentals />
              </Protected>
            }
          />
          <Route
            path="history"
            element={
              <Protected>
                <Rentals history />
              </Protected>
            }
          />
          <Route
            path="account"
            element={
              <Protected>
                <Account />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/mobile" replace />} />
        </Route>
      </Routes>
    </Auth.Provider>
  );
}
