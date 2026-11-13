import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  startTransition,
  type ReactNode,
} from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  History,
  Home,
  Info,
  MapPin,
  Package,
  RefreshCw,
  ScanLine,
  Search,
  Tag,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react';
import { api, ServiceError } from '../shared/api';
import { authApi } from '../shared/auth';
import { serverSession } from '../shared/httpAuth';
import { COOKIE_SESSION } from '../shared/authMode';
import { KIOSK, STATION } from '../shared/config';
import type { Code, Rental } from '../shared/types';
import { ErrorBox, Loading, useResource } from '../shared/ui';
import { publicCatalogHttp } from '../shared/catalogHttp';
import AuthFlow from './AuthFlow';
import './user-web.css';

type AuthState = { token: string; epoch: number; setToken: (token: string) => void };
const Auth = createContext<AuthState>({ token: '', epoch: 0, setToken: () => {} });
const useAuth = () => useContext(Auth);
const stamp = (value: number) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);

export function UserBrand() {
  return (
    <span className="uw-brand">
      <Tag aria-hidden="true" size={32} strokeWidth={2.4} />
      <span>TagBack</span>
    </span>
  );
}
function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="uw-heading">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
function State({
  title,
  children,
  error = false,
}: {
  title: string;
  children?: ReactNode;
  error?: boolean;
}) {
  return (
    <div className="uw-state" role={error ? 'alert' : undefined}>
      {error ? <WifiOff aria-hidden="true" /> : <Package aria-hidden="true" />}
      <h2>{title}</h2>
      {children}
    </div>
  );
}
function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  const { setToken } = useAuth();
  const location = useLocation();
  if (error instanceof ServiceError && error.code === 'AUTH')
    return (
      <State title="로그인이 만료되었어요" error>
        <p>다시 로그인한 뒤 이용해 주세요.</p>
        <Link
          className="primary"
          onClick={() => setToken('')}
          to={`/mobile/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        >
          다시 로그인
        </Link>
      </State>
    );
  return (
    <State title="정보를 불러오지 못했어요" error>
      <p>{error instanceof Error ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.'}</p>
      {retry && (
        <button className="primary" onClick={retry}>
          다시 시도
        </button>
      )}
    </State>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="uw-notice">
      <Info size={20} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
function Back({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="uw-back" to={to}>
      <ArrowLeft size={20} aria-hidden="true" />
      {children}
    </Link>
  );
}
function Pill({ tone = 'blue', children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`uw-pill ${tone}`}>
      {tone === 'green' && <Check size={14} aria-hidden="true" />}
      {children}
    </span>
  );
}
function ItemIcon({ name }: { name: string }) {
  return (
    <span className="uw-item-icon" aria-hidden="true">
      <Box size={32} strokeWidth={1.6} />
      <span>{name.slice(0, 1)}</span>
    </span>
  );
}

type CodeState = { code?: Code; busy: boolean; error?: unknown; issue: () => Promise<void> };
const CodeContext = createContext<CodeState>({ busy: false, issue: async () => {} });
function CodeProvider({ children }: { children: ReactNode }) {
  const { token, epoch } = useAuth();
  const [state, setState] = useState<{
    epoch: number;
    code?: Code;
    busy: boolean;
    error?: unknown;
  }>({ epoch, busy: false });
  const currentEpoch = useRef(epoch);
  currentEpoch.current = epoch;
  const visible = state.epoch === epoch ? state : { epoch, busy: false };
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    running.current = false;
  }, [epoch]);
  async function issue() {
    if (!token || running.current) return;
    running.current = true;
    setState({ epoch, busy: true });
    try {
      const code = await api.code(token, true);
      if (alive.current && currentEpoch.current === epoch) setState({ epoch, code, busy: false });
    } catch (error) {
      if (alive.current && currentEpoch.current === epoch) setState({ epoch, error, busy: false });
    } finally {
      if (currentEpoch.current === epoch) running.current = false;
    }
  }
  return <CodeContext.Provider value={{ ...visible, issue }}>{children}</CodeContext.Provider>;
}
function CodeCard({ compact = false }: { compact?: boolean }) {
  const { code, busy, error, issue } = useContext(CodeContext);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = !!code && code.expiresAt <= now;
  const seconds = Math.max(0, Math.ceil(((code?.expiresAt || 0) - now) / 1000));
  return (
    <section className={`uw-card uw-code ${compact ? 'compact' : ''}`} aria-label="이용 코드">
      <h2>
        이용 코드 <Info size={18} aria-hidden="true" />
      </h2>
      {error ? (
        <Failure error={error} retry={() => void issue()} />
      ) : busy ? (
        <Loading text="이용 코드를 발급하고 있어요" />
      ) : (
        <>
          <div className={`uw-code-value ${expired ? 'expired' : ''}`}>
            <ScanLine size={32} aria-hidden="true" />
            <strong className="code-number" aria-label="이용 코드 숫자">
              {code && !expired ? code.value : '— — —'}
            </strong>
          </div>
          <p className="uw-code-status" role="status">
            {expired
              ? '유효시간이 지났어요'
              : code
                ? '코드가 발급되었어요'
                : '키오스크에서 사용할 코드를 발급해 주세요.'}
          </p>
          {code && !expired && (
            <p className="uw-countdown">
              <Clock3 size={16} aria-hidden="true" />
              남은 시간{' '}
              <strong>
                {String(Math.floor(seconds / 60)).padStart(2, '0')}:
                {String(seconds % 60).padStart(2, '0')}
              </strong>
            </p>
          )}
          <button
            className={code && !expired ? 'secondary full' : 'primary full'}
            onClick={() => void issue()}
          >
            {code ? '새 코드 발급' : '이용 코드 발급'}
          </button>
          {code && !expired && (
            <p className="uw-caption">
              유효한 코드가 있으면 같은 코드가 표시돼요. 사용 여부는 키오스크에서 확인합니다.
            </p>
          )}
        </>
      )}
      {!compact && (
        <p className="uw-caption">
          코드는 본인만 사용해 주세요. 코드 발급만으로 대여·반납이 완료되지 않아요.
        </p>
      )}
    </section>
  );
}
const menu = [
  { to: '/mobile', label: '홈', icon: Home },
  { to: '/mobile/items', label: '물품 조회', icon: Box },
  { to: '/mobile/rentals', label: '대여 내역', icon: ClipboardList },
  { to: '/mobile/history', label: '이용 이력', icon: History },
  { to: '/mobile/account', label: '내 정보', icon: UserRound },
];
const savedPositions = new Map<string, { y: number; focus?: string }>();
function Layout() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const authScreen = /^\/mobile\/(login|signup|recover|change-phone)/.test(location.pathname);
  const viewKey =
    location.pathname + ':' + (new URLSearchParams(location.search).get('item') || '');
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const restored = navigationType === 'POP' ? savedPositions.get(location.key) : undefined;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, restored?.y || 0);
      if (!restored) {
        const heading = main.current?.querySelector<HTMLElement>('.uw-detail-panel h2, h1');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus({ preventScroll: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      const focused = document.activeElement as HTMLElement | null;
      savedPositions.set(location.key, {
        y: window.scrollY,
        focus: focused?.closest('a')?.getAttribute('href') || undefined,
      });
    };
    // Search/filter REPLACE navigations must not steal focus from the input.
  }, [viewKey]);
  // Lists can arrive after navigation; restore scroll and the selected link once they render.
  useEffect(() => {
    const restored = navigationType === 'POP' ? savedPositions.get(location.key) : undefined;
    if (!restored || !main.current) return;
    const restore = () => {
      const target = Array.from(main.current!.querySelectorAll<HTMLAnchorElement>('a')).find(
        (a) => a.getAttribute('href') === restored.focus,
      );
      if (target || document.documentElement.scrollHeight >= restored.y + innerHeight) {
        target?.focus({ preventScroll: true });
        window.scrollTo(0, restored.y);
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(restore);
    observer.observe(main.current, { childList: true, subtree: true });
    restore();
    return () => observer.disconnect();
  }, [viewKey]);
  return (
    <div className={`uw-layout ${authScreen ? 'uw-auth-layout' : ''}`}>
      <a className="uw-skip" href="#user-main">
        본문 바로가기
      </a>
      {!authScreen && (
        <aside className="uw-sidebar">
          <Link to="/mobile" aria-label="TagBack 홈">
            <UserBrand />
          </Link>
          <nav aria-label="사용자 메뉴">
            {menu.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/mobile'}>
                <Icon size={22} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
          <p className="uw-sidebar-foot">함께 쓰고, 다시 연결하다.</p>
        </aside>
      )}
      <div className="uw-workspace">
        {!authScreen && (
          <header className="uw-header">
            <Link to="/mobile" aria-label="TagBack 홈" className="uw-mobile-brand">
              <UserBrand />
            </Link>
            <span className="uw-desktop-title">내 물품 관리</span>
            <Link className="uw-account-link" to="/mobile/account" aria-label="내 계정">
              <UserRound size={22} />
              <span>내 정보</span>
            </Link>
          </header>
        )}
        <main
          id="user-main"
          className="uw-main"
          ref={main}
          onClickCapture={(event) => {
            const link = (event.target as HTMLElement).closest('a');
            if (link)
              savedPositions.set(location.key, {
                y: window.scrollY,
                focus: link.getAttribute('href') || undefined,
              });
          }}
        >
          <Outlet />
        </main>
      </div>
      {!authScreen && (
        <nav className="uw-bottom-nav" aria-label="모바일 메뉴">
          {menu
            .filter((x) => x.to !== '/mobile/history')
            .map(({ to, label, icon: Icon }) => {
              const active =
                to === '/mobile'
                  ? location.pathname === to || location.pathname === to + '/'
                  : location.pathname.startsWith(to) ||
                    (to === '/mobile/rentals' && location.pathname.startsWith('/mobile/history'));
              return (
                <Link
                  key={to}
                  to={to}
                  className={active ? 'active' : ''}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={24} aria-hidden="true" />
                  <span>{label === '물품 조회' ? '물품' : label}</span>
                </Link>
              );
            })}
        </nav>
      )}
    </div>
  );
}
function GuestHome() {
  return (
    <section className="uw-welcome uw-card">
      <UserBrand />
      <div className="uw-welcome-art">
        <Box size={70} strokeWidth={1.4} />
      </div>
      <Heading
        title="필요한 물품을 가볍게 빌려보세요"
        description="물품을 찾아보고, 이용 코드로 현장 키오스크에서 대여·반납하세요."
      />
      <Link className="primary full" to="/mobile/login">
        로그인
      </Link>
      <Link className="secondary full" to="/mobile/signup">
        회원가입
      </Link>
      <Link className="uw-text-link" to="/mobile/items">
        물품 둘러보기 <ArrowRight size={18} />
      </Link>
    </section>
  );
}
function HomePage() {
  const { token } = useAuth();
  return token ? <MemberHome /> : <GuestHome />;
}
function MemberHome() {
  const { token } = useAuth();
  const profile = useResource(() => api.me(token), [token]);
  const rentals = useResource(() => api.rentals(token), [token], true);
  const rows = rentals.data?.filter((x) => !x.returnedAt);
  return (
    <>
      <Heading
        title={profile.data ? `안녕하세요, ${profile.data.name}님!` : '안녕하세요!'}
        description="필요한 물품을 찾고, 이용 코드를 발급해 키오스크에서 대여·반납해 보세요."
      />
      {profile.error && <Failure error={profile.error} retry={profile.reload} />}
      <div className="uw-home-grid">
        <div className="uw-home-primary">
          <section className="uw-hero">
            <ScanLine size={52} aria-hidden="true" />
            <div>
              <h2>이용 코드 발급</h2>
              <p>
                키오스크에서 대여·반납할 때 사용할
                <br className="uw-desktop-break" /> 이용 코드를 준비해 주세요.
              </p>
            </div>
            <Link to="/mobile/code" className="uw-hero-button">
              이용 코드 발급하기 <ArrowRight size={20} />
            </Link>
          </section>
          <div className="uw-shortcuts">
            {menu.slice(1, 4).map(({ to, label, icon: Icon }) => (
              <Link to={to} key={to}>
                <Icon size={30} aria-hidden="true" />
                <strong>{label}</strong>
                <ChevronRight size={18} aria-hidden="true" />
                <p>
                  {to.endsWith('items')
                    ? '대여 가능한 물품을 확인해요.'
                    : to.endsWith('rentals')
                      ? '지금 빌린 물품을 확인해요.'
                      : '지난 이용 기록을 확인해요.'}
                </p>
              </Link>
            ))}
          </div>
          <section className="uw-card">
            <div className="uw-section-title">
              <h2>내 대여 물품</h2>
              {rows && <span>{rows.length}개</span>}
            </div>
            {rentals.loading ? (
              <Loading />
            ) : rentals.error ? (
              <Failure error={rentals.error} retry={rentals.reload} />
            ) : !rows?.length ? (
              <State title="대여 중인 물품이 없어요">
                <Link className="uw-text-link" to="/mobile/items">
                  물품 찾아보기 <ArrowRight size={18} />
                </Link>
              </State>
            ) : (
              <div className="uw-rental-list">
                {rows.slice(0, 3).map((row) => (
                  <RentalRow key={row.id} row={row} />
                ))}
                <Link className="uw-text-link" to="/mobile/rentals">
                  대여 내역 전체 보기 <ArrowRight size={18} />
                </Link>
              </div>
            )}
          </section>
        </div>
        <aside className="uw-home-aside">
          <CodeCard compact />
          <Notice>
            대여와 반납은 현장 키오스크에서 진행해요. 처리 결과는 대여 내역과 이용 이력에서 확인할
            수 있어요.
          </Notice>
        </aside>
      </div>
    </>
  );
}
function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const r = useResource(() => publicCatalogHttp(query), [query], true);
  const category = params.get('category') || '전체';
  const selected = params.get('item');
  const categories = ['전체', ...new Set(r.data?.kinds.map((k) => k.category) || [])];
  const kinds = r.data?.kinds.filter((k) => category === '전체' || k.category === category);
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete('item');
    setParams(next, { replace: true });
  }
  const selectedKind = r.data?.kinds.find((k) => k.id === selected);
  return (
    <>
      <Heading title="물품 조회" description="대여 가능한 물품을 검색하고 확인해 보세요.">
        <button className="secondary" onClick={r.reload} disabled={r.loading}>
          <RefreshCw size={18} />
          새로고침
        </button>
      </Heading>
      <div className="uw-catalog-controls">
        <label className="uw-search">
          <Search size={20} aria-hidden="true" />
          <input
            aria-label="물품명 검색"
            placeholder="물품을 검색해 보세요"
            value={query}
            onChange={(e) => update('q', e.target.value)}
          />
          {query && (
            <button onClick={() => update('q', '')} aria-label="검색어 지우기">
              <X size={18} />
            </button>
          )}
        </label>
        <p className="uw-station">
          <MapPin size={18} />
          {r.data?.stations[0]?.name || '대여소 확인 중'}
        </p>
        <div className="uw-filters" aria-label="물품 분류">
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              className={category === c ? 'selected' : ''}
              onClick={() => update('category', c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure error={r.error} retry={r.reload} />
      ) : !kinds?.length ? (
        <State title={query || category !== '전체' ? '검색 결과가 없어요' : '등록된 물품이 없어요'}>
          <p>
            {query || category !== '전체'
              ? '다른 검색어나 분류를 선택해 보세요.'
              : '물품이 등록되면 여기에서 확인할 수 있어요.'}
          </p>
          {(query || category !== '전체') && (
            <button className="secondary" onClick={() => setParams({})}>
              검색 초기화
            </button>
          )}
        </State>
      ) : (
        <div className={`uw-master-detail ${selectedKind ? 'has-selection' : ''}`}>
          <div className="uw-products">
            {kinds.map((k) => {
              const items = r.data!.items.filter((i) => i.kindId === k.id);
              const available =
                k.availableCount ??
                items.filter((i) => i.active && i.status === 'available').length;
              const next = new URLSearchParams(params);
              next.set('item', k.id);
              return (
                <Link
                  className={`uw-product ${selected === k.id ? 'selected' : ''}`}
                  key={k.id}
                  to={`/mobile/items?${next}`}
                >
                  <div className="uw-product-art">
                    <ItemIcon name={k.name} />
                  </div>
                  <span className="uw-caption">{k.category}</span>
                  <h2>{k.name}</h2>
                  <Pill tone={available ? 'green' : 'gray'}>
                    {available ? `대여 가능 ${available}개` : '현재 대여 불가'}
                  </Pill>
                  <ChevronRight className="uw-product-arrow" size={20} />
                </Link>
              );
            })}
          </div>
          {selected && (
            <aside className="uw-detail-panel" aria-label="물품 상세">
              <Link
                className="uw-panel-close"
                to={`/mobile/items?${new URLSearchParams([...params].filter(([key]) => key !== 'item'))}`}
                aria-label="물품 상세 닫기"
              >
                <X size={20} />
              </Link>
              {selectedKind ? (
                <ItemDetails kindId={selected} catalog={r.data!} />
              ) : (
                <State title="물품을 찾을 수 없어요" />
              )}
            </aside>
          )}
        </div>
      )}
    </>
  );
}
function ItemDetails({
  kindId,
  catalog,
}: {
  kindId: string;
  catalog: Awaited<ReturnType<typeof api.catalog>>;
}) {
  const kind = catalog.kinds.find((k) => k.id === kindId)!;
  const items = catalog.items.filter((i) => i.kindId === kindId);
  const available =
    kind.availableCount ?? items.filter((i) => i.active && i.status === 'available').length;
  return (
    <div className="uw-item-detail">
      <div className="uw-product-art">
        <ItemIcon name={kind.name} />
      </div>
      <h2>{kind.name}</h2>
      {kind.description && <p>{kind.description}</p>}
      <Pill tone={available ? 'green' : 'gray'}>{available ? '대여 가능' : '현재 대여 불가'}</Pill>
      <dl className="uw-facts">
        <div>
          <dt>대여소</dt>
          <dd>{catalog.stations[0]?.name}</dd>
        </div>
        <div>
          <dt>대여 가능</dt>
          <dd>
            {available}개 / 전체 {kind.totalCount ?? items.length}개
          </dd>
        </div>
      </dl>
      <Notice>대여와 반납은 키오스크에서 진행해요. 현재 재고는 예약을 의미하지 않아요.</Notice>
      {available > 0 ? (
        <Link className="primary full" to="/mobile/code">
          이용 코드 발급 <ArrowRight size={18} />
        </Link>
      ) : (
        <Link className="secondary full" to="/mobile/items">
          다른 물품 찾아보기
        </Link>
      )}
    </div>
  );
}
function LegacyItemDetail() {
  const { id } = useParams();
  const r = useResource(() => publicCatalogHttp('', id), [id], true);
  return (
    <>
      <Back to="/mobile/items">물품 목록으로</Back>
      <Heading title="물품 상세" />
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure error={r.error} retry={r.reload} />
      ) : !r.data?.kinds.some((k) => k.id === id) ? (
        <State title="물품을 찾을 수 없어요">
          <Link to="/mobile/items">물품 목록으로</Link>
        </State>
      ) : (
        <section className="uw-card uw-single-detail">
          <ItemDetails kindId={id!} catalog={r.data} />
        </section>
      )}
    </>
  );
}
function CodePage() {
  return (
    <div className="uw-code-page">
      <Heading title="나의 이용 코드" description="대여·반납할 때 현장 키오스크에 입력해 주세요." />
      <CodeCard />
      <section className="uw-card uw-instructions">
        <h2>이렇게 대여하세요</h2>
        <ol>
          <li>키오스크에서 이용 코드를 입력해요.</li>
          <li>대여할 물품 종류를 선택해요.</li>
          <li>NFC 인식 후 대여를 확정해요.</li>
        </ol>
        <h2>반납할 때는</h2>
        <p>NFC 인식 → 정상·손상 상태 선택 → 본인의 이용 코드 입력 → 반납 확정</p>
        <Link className="uw-text-link" to="/mobile/rentals">
          대여 내역 확인 <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}
function RentalRow({ row, history = false }: { row: Rental; history?: boolean }) {
  const overdue = !row.returnedAt && row.overdue === true;
  return (
    <Link className="uw-rental-row" to={`/mobile/${history ? 'history' : 'rentals'}/${row.id}`}>
      <ItemIcon name={row.itemTypeName || '물품'} />
      <div className="uw-rental-name">
        <strong>{row.itemTypeName || '물품'}</strong>
        <span>{row.itemName}</span>
      </div>
      <div className="uw-rental-date">
        <span>대여일</span>
        <time>{stamp(row.rentedAt)}</time>
      </div>
      <div className="uw-rental-date">
        <span>{history ? '반납일' : '반납 예정'}</span>
        <time>{stamp(row.returnedAt || row.dueAt)}</time>
      </div>
      <Pill tone={history ? 'green' : overdue ? 'red' : 'blue'}>
        {history ? '반납 완료' : overdue ? '반납 기한 초과' : '대여 중'}
      </Pill>
      <ChevronRight size={18} aria-hidden="true" />
    </Link>
  );
}
function RentalsPage({ history = false }: { history?: boolean }) {
  const { token } = useAuth();
  const r = useResource(() => api.rentals(token), [token], true);
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || '';
  const query = params.get('q') || '';
  const all = r.data?.filter((row) => (history ? !!row.returnedAt : !row.returnedAt));
  const monthKey = (value: number) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
    }).format(value);
  const rows = all?.filter(
    (row) =>
      `${row.itemTypeName} ${row.itemName}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!month || monthKey(row.returnedAt!) === month),
  );
  const selected = r.data?.find((row) => row.id === id);
  const base = `/mobile/${history ? 'history' : 'rentals'}`;
  return (
    <>
      <Heading
        title={history ? '이용 이력' : '대여 내역'}
        description={
          history
            ? '그동안 이용한 대여·반납 기록을 확인해 보세요.'
            : '현재 대여 중인 물품과 반납 예정일을 확인해 보세요.'
        }
      >
        <button className="secondary" disabled={r.loading} onClick={r.reload}>
          <RefreshCw size={18} />
          새로고침
        </button>
      </Heading>
      {!history && (
        <Link className="uw-text-link uw-history-link" to="/mobile/history">
          <History size={18} />
          이용 이력 보기 <ArrowRight size={18} />
        </Link>
      )}
      {history && (
        <div className="uw-history-filters">
          <label>
            물품 검색
            <input
              value={query}
              placeholder="물품명"
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('q', e.target.value);
                setParams(next, { replace: true });
              }}
            />
          </label>
          <label>
            반납 월
            <select
              value={month}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('month', e.target.value);
                setParams(next, { replace: true });
              }}
            >
              <option value="">전체 기간</option>
              {[...new Set(all?.map((row) => monthKey(row.returnedAt!)) || [])]
                .sort()
                .reverse()
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
          </label>
        </div>
      )}
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure error={r.error} retry={r.reload} />
      ) : (
        <div className={`uw-master-detail ${id ? 'has-selection' : ''}`}>
          <section className="uw-card uw-rentals-card">
            <div className="uw-section-title">
              <h2>{history ? '완료된 이용 기록' : '내 대여 물품'}</h2>
              <span>{rows?.length}건</span>
            </div>
            {!rows?.length ? (
              <State
                title={
                  query || month
                    ? '조건에 맞는 기록이 없어요'
                    : history
                      ? '아직 이용 기록이 없어요'
                      : '지금 대여 중인 물품이 없어요'
                }
              >
                {query || month ? (
                  <button className="secondary" onClick={() => setParams({})}>
                    검색 초기화
                  </button>
                ) : (
                  <Link className="primary" to="/mobile/items">
                    물품 찾아보기
                  </Link>
                )}
              </State>
            ) : (
              <div className="uw-rental-list">
                {rows.map((row) => (
                  <RentalRow key={row.id} row={row} history={history} />
                ))}
              </div>
            )}
          </section>
          {id && (
            <aside className="uw-detail-panel" aria-label="대여 상세">
              <Link to={base} className="uw-panel-close" aria-label="대여 상세 닫기">
                <X size={20} />
              </Link>
              {selected ? (
                <RentalDetails row={selected} />
              ) : (
                <State title="대여 내역을 찾을 수 없어요">
                  <Link to={base}>목록으로 돌아가기</Link>
                </State>
              )}
            </aside>
          )}
        </div>
      )}
    </>
  );
}
function RentalDetails({ row }: { row: Rental }) {
  const overdue = !row.returnedAt && row.overdue;
  return (
    <div className="uw-item-detail">
      <h2>대여 상세</h2>
      <ItemIcon name={row.itemTypeName || '물품'} />
      <h3>{row.itemTypeName || '물품'}</h3>
      <p>{row.itemName}</p>
      <Pill tone={row.returnedAt ? 'green' : overdue ? 'red' : 'blue'}>
        {row.returnedAt ? '반납 완료' : overdue ? '반납 기한 초과' : '대여 중'}
      </Pill>
      <dl className="uw-facts">
        <div>
          <dt>대여일</dt>
          <dd>{stamp(row.rentedAt)}</dd>
        </div>
        <div>
          <dt>반납 예정</dt>
          <dd>{stamp(row.dueAt)}</dd>
        </div>
        {row.returnedAt && (
          <div>
            <dt>실제 반납</dt>
            <dd>{stamp(row.returnedAt)}</dd>
          </div>
        )}
        <div>
          <dt>대여소</dt>
          <dd>{row.stationId === KIOSK.stationId ? STATION.name : '대여소 정보 없음'}</dd>
        </div>
      </dl>
      {row.returnedAt ? (
        <Notice>
          {row.returnedAt > row.dueAt
            ? '반납 예정일 이후에 반납한 기록이에요.'
            : '키오스크에서 반납이 완료된 기록이에요.'}
        </Notice>
      ) : (
        <>
          <Notice>
            <strong>반납은 키오스크에서 진행해 주세요.</strong>
            <p>NFC 인식 → 상태 선택 → 본인 코드 입력 → 반납 확정</p>
          </Notice>
          <Link to="/mobile/code" className="primary full">
            이용 코드 발급
          </Link>
        </>
      )}
    </div>
  );
}
function AccountPage() {
  const { token, setToken } = useAuth();
  const nav = useNavigate();
  const profile = useResource(() => api.me(token), [token]);
  const rentals = useResource(() => api.rentals(token), [token], true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const locked = useRef(false);
  async function logout() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await authApi.logout(token);
      startTransition(() => {
        nav('/mobile');
        setToken('');
      });
    } catch (e) {
      setError(e);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="uw-account">
      <Heading title="내 정보" description="계정 정보와 이용 현황을 확인해 보세요." />
      {error ? (
        <>
          <Failure error={error} retry={() => void logout()} />
          <p>로그아웃 결과를 확인하지 못해 개인정보를 가렸어요.</p>
        </>
      ) : profile.loading ? (
        <Loading />
      ) : profile.error ? (
        <Failure error={profile.error} retry={profile.reload} />
      ) : (
        <>
          <section className="uw-card uw-profile">
            <UserRound size={40} aria-hidden="true" />
            <div>
              <h2>{profile.data?.name}님</h2>
              <p>{profile.data?.occupation}</p>
            </div>
          </section>
          {rentals.loading ? (
            <Loading />
          ) : rentals.error ? (
            <Failure error={rentals.error} retry={rentals.reload} />
          ) : (
            <div className="uw-account-stats">
              <Link to="/mobile/rentals">
                <Box />
                <span>대여 중</span>
                <strong>{rentals.data?.filter((r) => !r.returnedAt).length}</strong>
                <ChevronRight />
              </Link>
              <Link to="/mobile/history">
                <History />
                <span>이용 이력</span>
                <strong>{rentals.data?.filter((r) => !!r.returnedAt).length}</strong>
                <ChevronRight />
              </Link>
            </div>
          )}
          <section className="uw-card uw-settings">
            <Link to="/mobile/recover">
              PIN 재설정
              <ChevronRight size={20} />
            </Link>
            <Link to="/mobile/history">
              이용 이력
              <ChevronRight size={20} />
            </Link>
            <Link to="/mobile/code">
              내 이용 코드
              <ChevronRight size={20} />
            </Link>
          </section>
          <button className="secondary full" disabled={busy} onClick={() => void logout()}>
            {busy ? '로그아웃 중…' : '로그아웃'}
          </button>
        </>
      )}
    </div>
  );
}
function AuthPage({ mode = 'access' }: { mode?: 'access' | 'signup' | 'reset' | 'change' }) {
  const { token, setToken } = useAuth();
  return (
    <>
      <div className="uw-auth-brand">
        <Link to="/mobile" aria-label="TagBack 홈">
          <UserBrand />
        </Link>
      </div>
      <AuthFlow mode={mode} token={token} onLogin={setToken} onClear={() => setToken('')} />
    </>
  );
}
function Protected({ children }: { children: ReactNode }) {
  const { token, epoch } = useAuth();
  const loc = useLocation();
  return token ? (
    <Fragment key={epoch}>{children}</Fragment>
  ) : (
    <Navigate to={`/mobile/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  );
}

export default function UserWeb() {
  const [token, setTokenState] = useState('');
  const [epoch, setEpoch] = useState(0);
  const sessionRevision = useRef(0);
  const identity = useRef('');
  const setToken = (value: string) => {
    sessionRevision.current++;
    setTokenState(value);
    setEpoch((n) => n + 1);
    identity.current = '';
    window.dispatchEvent(new Event('tagback-session'));
  };
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<unknown>();
  useEffect(() => {
    let active = true,
      checking = false,
      authenticated = false;
    async function sync() {
      if (checking) return;
      checking = true;
      const revision = sessionRevision.current;
      try {
        const session = await serverSession();
        if (!active || revision !== sessionRevision.current) return;
        authenticated = true;
        if (identity.current && identity.current !== session.user.userId) setEpoch((n) => n + 1);
        identity.current = session.user.userId;
        setTokenState(COOKIE_SESSION);
        setBootError(undefined);
        setReady(true);
      } catch (e) {
        if (active && revision === sessionRevision.current) {
          if (e instanceof ServiceError && e.code === 'AUTH') {
            if (authenticated || identity.current) setEpoch((n) => n + 1);
            authenticated = false;
            identity.current = '';
            setTokenState('');
            setBootError(undefined);
            setReady(true);
          } else setBootError(e);
        }
      } finally {
        checking = false;
        if (active && revision !== sessionRevision.current) void sync();
      }
    }
    void sync();
    const refresh = () => void sync();
    window.addEventListener('tagback-session', refresh);
    window.addEventListener('tagback-change', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30000);
    let lastActivity = 0;
    const activity = () => {
      if (!authenticated || Date.now() - lastActivity < 60000) return;
      lastActivity = Date.now();
      void serverSession(true).catch(refresh);
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('tagback-session', refresh);
      window.removeEventListener('tagback-change', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, []);
  return (
    <div className="user-web">
      <Auth.Provider value={{ token, epoch, setToken }}>
        {!ready ? (
          <div className="uw-boot">
            {bootError ? (
              <>
                <Heading title="서비스에 연결하지 못했어요" />
                <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
                <button
                  className="primary"
                  onClick={() => {
                    setBootError(undefined);
                    window.dispatchEvent(new Event('tagback-session'));
                  }}
                >
                  다시 시도
                </button>
                <ErrorBox error={bootError} />
              </>
            ) : (
              <Loading />
            )}
          </div>
        ) : (
          <CodeProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage key={epoch} />} />
                <Route path="items" element={<CatalogPage />} />
                <Route path="items/:id" element={<LegacyItemDetail />} />
                <Route path="login" element={<AuthPage key="login" />} />
                <Route path="signup" element={<AuthPage key="signup" mode="signup" />} />
                <Route path="recover" element={<AuthPage key="reset" mode="reset" />} />
                <Route path="change-phone" element={<AuthPage key="change" mode="change" />} />
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
                      <RentalsPage />
                    </Protected>
                  }
                />
                <Route
                  path="rentals/:id"
                  element={
                    <Protected>
                      <RentalsPage />
                    </Protected>
                  }
                />
                <Route
                  path="history"
                  element={
                    <Protected>
                      <RentalsPage history />
                    </Protected>
                  }
                />
                <Route
                  path="history/:id"
                  element={
                    <Protected>
                      <RentalsPage history />
                    </Protected>
                  }
                />
                <Route
                  path="account"
                  element={
                    <Protected>
                      <AccountPage />
                    </Protected>
                  }
                />
                <Route path="*" element={<Navigate to="/mobile" replace />} />
              </Route>
            </Routes>
          </CodeProvider>
        )}
      </Auth.Provider>
    </div>
  );
}
