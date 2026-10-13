import { HTTP_AUTH, COOKIE_SESSION } from '../shared/authMode';
import { serverSession } from '../shared/httpAuth';
import { createContext, useContext, useEffect, useState } from 'react';
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
  History,
  MapPin,
  Package,
  Search,
  Ticket,
  UserRound,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { api, ServiceError } from '../shared/api';
import { MOBILE_TOKEN_KEY } from '../shared/config';
import AuthFlow from './AuthFlow';
import { authApi } from '../shared/auth';
import { Badge, Brand, date, ErrorBox, Loading, ProductArt, useResource } from '../shared/ui';
const Auth = createContext({ token: '', setToken: (_: string) => {} });
function useAuth() {
  return useContext(Auth);
}
function MobileLayout() {
  const location = useLocation();
  const tabPage = [
    '/mobile',
    '/mobile/',
    '/mobile/code',
    '/mobile/rentals',
    '/mobile/history',
  ].includes(location.pathname);
  return (
    <div className="mobile-shell">
      {tabPage && (
        <header className="mobile-header">
          <Link to="/mobile" aria-label="TagBack 홈">
            <Brand />
          </Link>
          <Link className="account-icon" to="/mobile/account" aria-label="내 계정">
            <UserRound size={21} />
          </Link>
        </header>
      )}
      <main className="mobile-main">
        <Outlet />
      </main>
      {!/^\/mobile\/(login|signup|recover|change-phone)/.test(location.pathname) && (
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
      )}
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
  const requestedStation = params.get('station');
  const search = params.get('q') || '';
  const category = params.get('category') || '전체';
  const r = useResource(() => api.catalog(), [], true);
  const station =
    r.data?.stations.find((s) => s.id === requestedStation)?.id ||
    r.data?.stations[0]?.id ||
    'engineering';
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
          <span /> 우리 캠퍼스의 공유 물품
        </div>
        <h1>
          필요한 순간,
          <br />
          <em>가볍게 빌려 쓰세요.</em>
        </h1>
        <p>가까운 대여소에서 물품을 찾아보세요.</p>
      </section>
      <section className="explore-controls">
        <label className="station-select">
          <MapPin size={18} />
          <select
            aria-label="대여소 선택"
            disabled={r.loading || !r.data}
            value={station}
            onChange={(e) => update('station', e.target.value)}
          >
            {r.data?.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
            대여소 물품 <span>{kinds.length}</span>
          </h2>
          <button
            className="text-button"
            disabled={r.loading}
            onClick={r.reload}
            aria-label="물품 목록 새로고침"
          >
            <RefreshCw size={17} /> 새로고침
          </button>
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
      <Link to="/mobile/code" className="how-banner">
        <div className="how-icon">
          <Ticket size={25} />
        </div>
        <div>
          <strong>빌리는 건 간단하게</strong>
          <p>코드 확인 → 현장 키오스크 → NFC 인식</p>
        </div>
        <ChevronRight size={18} />
      </Link>
      <footer className="mobile-footer">
        함께 쓰고, 다시 연결하다.<span>TagBack · 캠퍼스 공유 서비스</span>
      </footer>
    </>
  );
}
function Detail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const requestedStation = params.get('station');
  const r = useResource(() => api.catalog(), [], true);
  const station =
    r.data?.stations.find((s) => s.id === requestedStation)?.id ||
    r.data?.stations[0]?.id ||
    'engineering';
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
            <div className="stock-toolbar">
              <button className="text-button" onClick={r.reload} disabled={r.loading}>
                <RefreshCw size={15} /> 재고 새로고침
              </button>
            </div>
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
function AuthPage({ mode = 'access' }: { mode?: 'access' | 'signup' | 'reset' | 'change' }) {
  const { token, setToken } = useAuth();
  return <AuthFlow mode={mode} token={token} onLogin={setToken} onClear={() => setToken('')} />;
}
function AccountEntry() {
  const { token } = useAuth();
  return token ? (
    <Account />
  ) : (
    <div className="page-content">
      <Back title="마이페이지" />
      <h1>로그인이 필요해요</h1>
      <p className="muted">로그인하고 내 계정과 대여 내역을 확인해 주세요.</p>
      <Link className="primary full" to="/mobile/login">
        로그인
      </Link>
    </div>
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
  const r = useResource(() => api.code(token, true), [token], true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expired = !!r.data && r.data.expiresAt <= now;
  const used = r.data?.used;
  useEffect(() => {
    if ((expired || used) && !r.loading && !r.error) r.reload();
  }, [expired, used, r.loading, r.error]);
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
  const rows = r.data?.rentals?.filter((r) => (history ? !!r.returnedAt : !r.returnedAt)) || [];
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
    </div>
  );
}
function Account() {
  const { token, setToken } = useAuth();
  const r = useResource(
    async () => ({
      ...(await api.me(token)),
      rentals: HTTP_AUTH ? null : await api.rentals(token),
    }),
    [token],
    true,
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function leave() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await authApi.logout(token);
      setToken('');
      nav('/mobile/login');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-content">
      <h1>마이페이지</h1>
      {r.authError ? (
        <AuthError next="/mobile/account" />
      ) : r.loading ? (
        <Loading />
      ) : r.error ? (
        <ErrorBox error={r.error} retry={r.reload} />
      ) : (
        <>
          <section className="account-profile">
            <div className="profile-avatar">
              <UserRound size={30} />
            </div>
            <div>
              <h2>{r.data?.name}님</h2>
              <p>{r.data?.occupation || 'TagBack 회원'}</p>
            </div>
          </section>
          <section className="account-summary" aria-label="대여 현황">
            <Link to="/mobile/rentals">
              <strong>
                {r.data?.rentals?.filter((x) => !x.returnedAt).length ?? (HTTP_AUTH ? '—' : 0)}
              </strong>
              <span>대여 중</span>
            </Link>
            <Link to="/mobile/history">
              <strong>
                {r.data?.rentals?.filter((x) => !!x.returnedAt).length ?? (HTTP_AUTH ? '—' : 0)}
              </strong>
              <span>이용 기록</span>
            </Link>
          </section>
          <Link className="account-code" to="/mobile/code">
            <Ticket size={24} />
            <div>
              <strong>내 대여 코드</strong>
              <span>키오스크에서 대여할 때 확인하세요</span>
            </div>
            <ChevronRight size={20} />
          </Link>
          <section className="account-settings">
            <h2>계정 관리</h2>
            {!HTTP_AUTH && (
              <Link to="/mobile/change-phone">
                <span>전화번호 변경</span>
                <ChevronRight size={18} />
              </Link>
            )}
            <Link to="/mobile/recover">
              <span>PIN 재설정</span>
              <ChevronRight size={18} />
            </Link>
          </section>
          <button className="text-button account-logout" disabled={busy} onClick={leave}>
            로그아웃
          </button>
          <ErrorBox error={error} />
        </>
      )}
    </div>
  );
}
export default function MobileApp() {
  const [token, setTokenState] = useState(() =>
    HTTP_AUTH ? '' : localStorage.getItem(MOBILE_TOKEN_KEY) || '',
  );
  const setToken = (v: string) => {
    setTokenState(v);
    if (HTTP_AUTH) {
      window.dispatchEvent(new Event('tagback-session'));
      return;
    }
    if (v) localStorage.setItem(MOBILE_TOKEN_KEY, v);
    else localStorage.removeItem(MOBILE_TOKEN_KEY);
    window.dispatchEvent(new Event('tagback-session'));
  };
  const [sessionNotice, setSessionNotice] = useState('');
  const [sessionReady, setSessionReady] = useState(!HTTP_AUTH);
  const [bootError, setBootError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    let checking = false;
    let authenticated = false;
    const sync = async () => {
      if (HTTP_AUTH) {
        if (checking) return;
        checking = true;
        try {
          await serverSession();
          authenticated = true;
          if (active) {
            setTokenState(COOKIE_SESSION);
            setBootError(undefined);
            setSessionReady(true);
          }
        } catch (e) {
          if (active) {
            if (e instanceof ServiceError && e.code === 'AUTH') {
              authenticated = false;
              setTokenState('');
              setBootError(undefined);
              setSessionReady(true);
            } else setBootError(e);
          }
        } finally {
          checking = false;
        }
        return;
      }
      const current = localStorage.getItem(MOBILE_TOKEN_KEY) || '';
      if (active) setTokenState(current);
      if (!current || checking) return;
      checking = true;
      try {
        await api.me(current);
      } catch (e) {
        if (
          active &&
          e instanceof ServiceError &&
          e.code === 'AUTH' &&
          localStorage.getItem(MOBILE_TOKEN_KEY) === current
        ) {
          localStorage.removeItem(MOBILE_TOKEN_KEY);
          setTokenState('');
          setSessionNotice(e.message);
        }
      } finally {
        checking = false;
      }
    };
    const storage = (e: StorageEvent) => {
      if (e.key === MOBILE_TOKEN_KEY || e.key === 'tagback.mock.v1') void sync();
    };
    void sync();
    window.addEventListener('storage', storage);
    window.addEventListener('tagback-session', sync);
    window.addEventListener('tagback-change', sync);
    window.addEventListener('focus', sync);
    const timer = setInterval(sync, 30_000);
    let lastActivity = 0;
    const activity = () => {
      if (!HTTP_AUTH || !authenticated || Date.now() - lastActivity < 60000) return;
      lastActivity = Date.now();
      void serverSession(true).catch(() => void sync());
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
      window.removeEventListener('storage', storage);
      window.removeEventListener('tagback-session', sync);
      window.removeEventListener('tagback-change', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  if (!sessionReady)
    return bootError ? (
      <ErrorBox
        error={bootError}
        retry={() => window.dispatchEvent(new Event('tagback-session'))}
      />
    ) : (
      <Loading />
    );
  return (
    <Auth.Provider value={{ token, setToken }}>
      <ErrorBox error={sessionNotice} />
      <Routes>
        <Route element={<MobileLayout />}>
          <Route index element={<Explore />} />
          <Route path="items/:id" element={<Detail />} />
          <Route path="login" element={<AuthPage key="login" />} />
          <Route path="recover" element={<AuthPage key="reset" mode="reset" />} />
          <Route path="change-phone" element={<AuthPage key="change" mode="change" />} />
          <Route path="signup" element={<AuthPage key="signup" mode="signup" />} />
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
          <Route path="account" element={<AccountEntry />} />
          <Route path="*" element={<Navigate to="/mobile" replace />} />
        </Route>
      </Routes>
    </Auth.Provider>
  );
}
