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
  Ticket,
  Copy,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react';
import { ItemPicture } from '../shared/ItemPicture';
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
import './mobile-viewport.css';

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
function Failure({
  error,
  retry,
  title = '정보를 불러오지 못했어요',
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
}) {
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
    <State title={title} error>
      <p>{error instanceof Error ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.'}</p>
      {retry && (
        <button className="primary" onClick={retry}>
          다시 시도
        </button>
      )}
    </State>
  );
}
function RefreshStatus({
  resource,
}: {
  resource: { refreshing: boolean; refreshError: unknown; reload: () => void };
}) {
  if (resource.refreshError)
    return (
      <div className="uw-refresh-status" role="status">
        최신 정보를 확인하지 못했어요. 이전 조회 내용을 표시하고 있어요.
        <button className="secondary" onClick={resource.reload}>
          다시 시도
        </button>
      </div>
    );
  return resource.refreshing ? (
    <p className="uw-refresh-status" role="status">
      최신 정보를 확인하고 있어요.
    </p>
  ) : null;
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
  const [state, setState] = useState<{ code?: Code; busy: boolean; error?: unknown }>({
    busy: true,
  });
  const initial = useRef<{ epoch: number; promise: Promise<Code> } | undefined>(undefined);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!token) {
      setState({ busy: false });
      return;
    }
    setState({ busy: true });
    let alive = true,
      running = false;
    if (initial.current?.epoch !== epoch)
      initial.current = { epoch, promise: api.code(token, true) };
    let lastCode = '';
    const update = async (first = false) => {
      if (running) return;
      running = true;
      try {
        const code = await (first ? initial.current!.promise : api.code(token, false));
        if (alive) {
          setState({ code, busy: false });
          if (lastCode && lastCode !== code.value)
            window.dispatchEvent(new Event('tagback-change'));
          lastCode = code.value;
        }
      } catch (error) {
        if (alive) setState({ busy: false, error });
      } finally {
        running = false;
      }
    };
    refresh.current = () => update();
    void update(true);
    const timer = window.setInterval(() => void update(), 2000);
    const focus = () => void update();
    window.addEventListener('focus', focus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [token, epoch]);
  return (
    <CodeContext.Provider value={{ ...state, issue: () => refresh.current() }}>
      {children}
    </CodeContext.Provider>
  );
}
function CodeCard({ compact = false }: { compact?: boolean }) {
  const [copyMessage, setCopyMessage] = useState('');
  const { code, busy, error, issue } = useContext(CodeContext);
  return (
    <section className={`uw-card uw-code ${compact ? 'compact' : ''}`} aria-label="이용 코드">
      {compact && <h2>나의 이용 코드</h2>}
      {error ? (
        <Failure error={error} retry={() => void issue()} title="이용 코드를 확인하지 못했어요" />
      ) : busy || !code || code.expiresAt <= Date.now() ? (
        <Loading text="이용 코드를 준비하고 있어요" />
      ) : (
        <>
          <div className="uw-code-value">
            <strong className="code-number" aria-label="이용 코드 숫자">
              {code.value}
            </strong>
          </div>
          <button
            className="secondary uw-copy-code"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code.value);
                setCopyMessage('코드를 복사했어요.');
              } catch {
                setCopyMessage('복사하지 못했어요. 코드를 직접 입력해 주세요.');
              }
            }}
          >
            <Copy size={16} />
            복사
          </button>
          <span role="status">{copyMessage}</span>
          <p className="uw-code-status">키오스크에 입력해 주세요</p>
          <p className="uw-caption">대여·반납 후에는 새 코드로 자동 변경돼요.</p>
        </>
      )}
    </section>
  );
}
const menu = [
  { to: '/mobile/items', label: '물품 조회', icon: Box },
  { to: '/mobile/rentals', label: '내 대여 현황', icon: ClipboardList },
  { to: '/mobile/history', label: '이용 이력', icon: History },
];
const savedPositions = new Map<
  string,
  { y: number; main: number; regions: number[]; focus?: string }
>();
function Layout() {
  const { token } = useAuth();
  const location = useLocation();
  const navigationType = useNavigationType();
  const authScreen = /^\/mobile\/(login|signup|recover|change-phone)/.test(location.pathname);
  // Opening item details must preserve the mounted catalogue and its scroll position.
  const viewKey = location.pathname;
  const main = useRef<HTMLElement>(null);
  const remember = (focus?: string) => {
    savedPositions.set(location.key, {
      y: window.scrollY,
      main: main.current?.scrollTop || 0,
      regions: Array.from(
        main.current?.querySelectorAll<HTMLElement>('[data-scroll-region]') || [],
      ).map((region) => region.scrollTop),
      focus: focus || savedPositions.get(location.key)?.focus,
    });
  };
  const restorePosition = (saved?: ReturnType<typeof savedPositions.get>) => {
    window.scrollTo(0, saved?.y || 0);
    if (main.current) main.current.scrollTop = saved?.main || 0;
    main.current?.querySelectorAll<HTMLElement>('[data-scroll-region]').forEach((region, i) => {
      region.scrollTop = saved?.regions[i] || 0;
    });
  };
  useEffect(() => {
    const save = () => remember();
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [location.key]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const layout = main.current?.closest<HTMLElement>('.uw-layout');
    const resize = () => {
      // Resize for the software keyboard, but let browser pinch zoom work normally.
      if (viewport?.scale === 1) layout?.style.setProperty('--uw-viewport', `${viewport.height}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    return () => viewport?.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const restored = navigationType === 'POP' ? savedPositions.get(location.key) : undefined;
    const frame = requestAnimationFrame(() => {
      restorePosition(restored);
      if (!restored) {
        const heading = main.current?.querySelector<HTMLElement>('.uw-detail-panel h2, h1');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus({ preventScroll: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
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
      if (target || (!restored.focus && main.current!.querySelector('[data-scroll-region]'))) {
        target?.focus({ preventScroll: true });
        restorePosition(restored);
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
      <div className="uw-workspace">
        {!authScreen && (
          <header className="uw-header">
            <Link to="/mobile" aria-label="TagBack 홈" className="uw-mobile-brand">
              <UserBrand />
            </Link>
            <nav className="uw-top-nav" aria-label="사용자 메뉴">
              {menu.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}>
                  <Icon size={20} aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <Link className="uw-account-link" to="/mobile/account" aria-label="내 계정">
              <UserRound size={22} />
              <span>내 정보</span>
            </Link>
          </header>
        )}
        <main
          id="user-main"
          className={`uw-main uw-view-${location.pathname.split('/')[2] || 'home'}`}
          ref={main}
          onScrollCapture={() => remember()}
          onClickCapture={(event) => {
            const link = (event.target as HTMLElement).closest('a');
            if (link) remember(link.getAttribute('href') || undefined);
          }}
        >
          <Outlet />
        </main>
      </div>
      {!authScreen && token && (
        <nav className="uw-bottom-nav" aria-label="모바일 메뉴">
          {menu
            .filter(() => true)
            .map(({ to, label, icon: Icon }) => {
              const active =
                to === '/mobile'
                  ? location.pathname === to || location.pathname === to + '/'
                  : location.pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  className={active ? 'active' : ''}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={24} aria-hidden="true" />
                  <span>{label}</span>
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
  const rentals = useResource(() => api.rentals(token), [token], true, true);
  const rows = rentals.data?.filter((x) => !x.returnedAt);
  return (
    <div className="uw-depot-home">
      <h1 className="uw-sr-only">홈</h1>
      <div className="uw-depot-grid">
        <div className="uw-ticket">
          <CodeCard compact />
        </div>
        <section className="uw-card uw-home-rentals uw-depot-rentals">
          <div className="uw-section-title">
            <h2>대여 중인 물품</h2>
            {rows && <span>{rows.length}개</span>}
            <Link className="uw-text-link" to="/mobile/rentals">
              전체 보기 <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <RefreshStatus resource={rentals} />
          {rentals.loading ? (
            <Loading />
          ) : rentals.error ? (
            <Failure error={rentals.error} retry={rentals.reload} />
          ) : !rows?.length ? (
            <State title="대여 중인 물품이 없어요">
              <Link className="uw-text-link" to="/mobile/items">
                물품 둘러보기 <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </State>
          ) : (
            <div
              className="uw-rental-list"
              data-scroll-region
              tabIndex={0}
              aria-label="최근 대여 물품"
            >
              {rows.slice(0, 3).map((row) => (
                <RentalRow key={row.id} row={row} compact />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
function CatalogDetails({ children, close }: { children: ReactNode; close: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const origin = document.querySelector<HTMLElement>('.uw-product.selected');
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => {
      requestAnimationFrame(() => origin?.isConnected && origin.focus({ preventScroll: true }));
    };
  }, []);
  return (
    <section
      ref={panel}
      className="uw-detail-panel uw-detail-page"
      aria-label="물품 상세"
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <header className="uw-detail-heading">
        <h1 tabIndex={-1}>물품 상세</h1>
        <button
          type="button"
          className="secondary uw-detail-back"
          aria-label="물품 상세 닫기"
          onClick={close}
        >
          <ArrowLeft size={18} /> 목록으로
        </button>
      </header>
      {children}
    </section>
  );
}
const itemState: Record<string, string> = {
  available: '대여 가능',
  rented: '대여 중',
  inspection: '점검 중',
  repair: '수리 중',
  pending: '태그 등록 대기',
};
function CatalogPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const r = useResource(() => publicCatalogHttp(query), [query], true, true);
  const category = params.get('category') || '전체';
  const selected = params.get('item');
  const categories = ['전체', ...new Set(r.data?.kinds.map((k) => k.category) || [])];
  const kinds = r.data?.items.filter(
    (i) =>
      (category === '전체' ||
        r.data?.kinds.find((k) => k.id === i.kindId)?.category === category) &&
      (params.get('available') !== 'true' || i.status === 'available'),
  );
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete('item');
    setParams(next, { replace: true });
  }
  const selectedKind = r.data?.items.find((k) => k.id === selected);
  function closeDetails() {
    if (location.state?.catalogOverlay) navigate(-1);
    else {
      const next = new URLSearchParams(params);
      next.delete('item');
      setParams(next, { replace: true });
    }
  }
  return (
    <>
      <div className="uw-catalog-heading-controls" hidden={!!selected}>
        <Heading title="물품 조회">
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
              placeholder="물품명 검색"
              value={query}
              onChange={(e) => update('q', e.target.value)}
            />
            {query && (
              <button onClick={() => update('q', '')} aria-label="검색어 지우기">
                <X size={18} />
              </button>
            )}
          </label>
          <Link className="primary uw-catalog-code" to="/mobile/code">
            <Ticket size={20} />
            이용 코드 보기
          </Link>
          <p className="uw-station">
            <MapPin size={18} />
            {r.data?.stations[0]?.name || '대여소 확인 중'}
          </p>
          <label className="uw-available-filter">
            <input
              type="checkbox"
              checked={params.get('available') === 'true'}
              onChange={(e) => update('available', e.target.checked ? 'true' : '')}
            />{' '}
            대여 가능만
          </label>
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
      </div>
      {!selected && <RefreshStatus resource={r} />}
      {kinds && !selected && <p className="uw-result-count">전체 {kinds.length}개 물품</p>}
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
        <div
          className={`uw-master-detail uw-catalog-layout ${selectedKind ? 'has-selection' : ''}`}
        >
          <div
            className="uw-products uw-individual-items"
            hidden={!!selected}
            data-scroll-region
            tabIndex={0}
            aria-label="물품 목록"
          >
            {kinds.map((k) => {
              const available = k.status === 'available';
              const next = new URLSearchParams(params);
              next.set('item', k.id);
              return (
                <Link
                  className={`uw-product ${selected === k.id ? 'selected' : ''}`}
                  key={k.id}
                  to={`/mobile/items?${next}`}
                  state={{ catalogOverlay: true }}
                >
                  <div className="uw-product-art">
                    {k.image ? (
                      <img src={k.image} alt={k.name || k.label} />
                    ) : (
                      <ItemIcon name={k.name || k.label} />
                    )}
                  </div>
                  <span className="uw-category">
                    {r.data?.kinds.find((kind) => kind.id === k.kindId)?.category || '물품'}
                  </span>
                  <span className="uw-caption">#{k.id}</span>
                  <h2>{k.name}</h2>
                  <Pill tone={available ? 'green' : 'gray'}>{itemState[k.status]}</Pill>
                  <span className="uw-product-detail">
                    상세 보기 <ChevronRight size={16} />
                  </span>
                </Link>
              );
            })}
          </div>
          {selected && (
            <CatalogDetails close={closeDetails}>
              <RefreshStatus resource={r} />
              {selectedKind ? (
                <ItemDetails kindId={selected} catalog={r.data!} />
              ) : (
                <State title="물품을 찾을 수 없어요" />
              )}
            </CatalogDetails>
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
  const item = catalog.items.find((i) => i.id === kindId)!;
  const kind = catalog.kinds.find((k) => k.id === item.kindId);
  return (
    <div className="uw-item-detail">
      <div className="uw-product-art">
        {item.image ? <img src={item.image} alt={item.label} /> : <ItemIcon name={item.label} />}
      </div>
      <div className="uw-detail-information">
        <span className="uw-category">{kind?.category || '물품'}</span>
        <h2>{item.label}</h2>
        <Pill tone={item.status === 'available' ? 'green' : 'gray'}>{itemState[item.status]}</Pill>
        {kind?.description && <p className="uw-detail-description">{kind.description}</p>}
        <dl className="uw-facts">
          <div>
            <dt>식별번호</dt>
            <dd>#{item.id}</dd>
          </div>
          <div>
            <dt>종류</dt>
            <dd>{kind?.name}</dd>
          </div>
          <div>
            <dt>대여소</dt>
            <dd>{catalog.stations[0]?.name}</dd>
          </div>
        </dl>
        <Notice>대여와 반납은 키오스크에서 진행해요.</Notice>
        <Link className="primary" to="/mobile/code">
          <Ticket size={20} />
          이용 코드 보기
        </Link>
      </div>
    </div>
  );
}

function LegacyItemDetail() {
  const { id } = useParams();
  const r = useResource(() => publicCatalogHttp(), [id], true, true);
  return (
    <>
      <Back to="/mobile/items">물품 목록으로</Back>
      <Heading title="물품 상세" />
      <RefreshStatus resource={r} />
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure error={r.error} retry={r.reload} />
      ) : !r.data?.items.some((k) => k.id === id) ? (
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
  const instructions = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      if (instructions.current) instructions.current.open = desktop.matches;
    };
    sync();
    desktop.addEventListener('change', sync);
    return () => desktop.removeEventListener('change', sync);
  }, []);
  return (
    <div className="uw-code-page">
      <Heading title="나의 이용 코드" />
      <CodeCard />
      <details className="uw-card uw-code-help" ref={instructions}>
        <summary>대여·반납 이용 방법</summary>
        <div className="uw-instructions">
          <h2>이렇게 대여하세요</h2>
          <ol>
            <li>키오스크에서 이용 코드를 입력해요.</li>
            <li>대여할 물품의 NFC 태그를 인식해요.</li>
            <li>물품 정보를 확인하고 대여를 확정해요.</li>
          </ol>
          <h2>반납할 때는</h2>
          <p>NFC 인식 → 정상·손상 상태 선택 → 이용 코드 입력 → 반납 확정</p>
          <Link className="uw-text-link" to="/mobile/rentals">
            대여 내역 확인 <ArrowRight size={18} />
          </Link>
        </div>
      </details>
    </div>
  );
}
function RentalRow({
  row,
  history = false,
  compact = false,
}: {
  row: Rental;
  history?: boolean;
  compact?: boolean;
}) {
  const location = useLocation();
  const overdue = !row.returnedAt && row.overdue === true;
  if (compact)
    return (
      <Link className="uw-depot-item" to={`/mobile/rentals/${row.id}`}>
        <span className="uw-rental-art">
          <ItemPicture src={row.image} alt={row.itemName || row.itemTypeName} />
        </span>
        <div>
          <strong>{row.itemTypeName || '물품'}</strong>
          <span className="uw-depot-item-label">{row.itemName}</span>
          <time
            className={`uw-due-tag ${overdue ? 'overdue' : ''}`}
            dateTime={new Date(row.dueAt).toISOString()}
          >
            {overdue ? '기한 초과 · ' : '반납 예정 · '}
            {new Intl.DateTimeFormat('ko-KR', {
              timeZone: 'Asia/Seoul',
              month: 'numeric',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            }).format(row.dueAt)}
          </time>
        </div>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    );
  return (
    <Link
      className={`uw-rental-row ${history ? 'uw-history-entry' : 'uw-loan-tag'} ${overdue ? 'is-overdue' : ''}`}
      to={`/mobile/${history ? 'history' : 'rentals'}/${row.id}${location.search}`}
    >
      <span className="uw-rental-art">
        <ItemPicture src={row.image} alt={row.itemName || row.itemTypeName} />
      </span>
      <div className="uw-record-name">
        <strong>{row.itemTypeName || '물품'}</strong>
        <span>{row.itemName}</span>
      </div>
      {history ? (
        <div className="uw-record-date">
          <span className="uw-history-status">{row.overdue ? '지연 반납' : '반납 완료'}</span>
          <span>
            대여일{' '}
            <time dateTime={new Date(row.rentedAt).toISOString()}>{stamp(row.rentedAt)}</time>
          </span>
          <span>
            반납 기한 <time dateTime={new Date(row.dueAt).toISOString()}>{stamp(row.dueAt)}</time>
          </span>
          <span>
            반납일{' '}
            <time dateTime={new Date(row.returnedAt!).toISOString()}>{stamp(row.returnedAt!)}</time>
          </span>
        </div>
      ) : (
        <>
          <div className={`uw-loan-deadline ${overdue ? 'overdue' : ''}`}>
            <span>{overdue ? '반납 기한 초과' : '반납 예정'}</span>
            <time dateTime={new Date(row.dueAt).toISOString()}>{stamp(row.dueAt)}</time>
          </div>
          <span className="uw-loan-start">대여일 · {stamp(row.rentedAt)}</span>
        </>
      )}
      <ChevronRight className="uw-record-arrow" size={18} aria-hidden="true" />
    </Link>
  );
}

function RentalsPage({ history = false }: { history?: boolean }) {
  const { token } = useAuth();
  const r = useResource(() => api.rentals(token), [token], true, true);
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
  const rows = all
    ?.filter(
      (row) =>
        `${row.itemTypeName} ${row.itemName}`.toLowerCase().includes(query.trim().toLowerCase()) &&
        (!month || monthKey(row.returnedAt!) === month),
    )
    .sort((a, b) =>
      history
        ? b.returnedAt! - a.returnedAt!
        : Number(!!b.overdue) - Number(!!a.overdue) || a.dueAt - b.dueAt,
    );
  const selected = r.data?.find((row) => row.id === id);
  const base = `/mobile/${history ? 'history' : 'rentals'}${params.size ? '?' + params.toString() : ''}`;
  return (
    <>
      <Heading title={history ? '이용 이력' : '내 대여 현황'}>
        <button className="secondary" disabled={r.loading} onClick={r.reload}>
          <RefreshCw size={18} />
          새로고침
        </button>
      </Heading>
      {!history && all && (
        <div className="uw-rental-summary" aria-label="내 대여 요약">
          <div>
            <span>미반납 (연체 포함)</span>
            <strong>{all.length}개</strong>
          </div>
          <div>
            <span>연체</span>
            <strong>{all.filter((row) => row.overdue).length}개</strong>
          </div>
        </div>
      )}
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
      <RefreshStatus resource={r} />
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
              <div
                className={`uw-rental-list ${history ? 'uw-history-entries' : 'uw-loan-tags'}`}
                data-scroll-region
                tabIndex={0}
                aria-label={history ? '이용 이력 목록' : '대여 물품 목록'}
              >
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
      <span className="uw-rental-art">
        <ItemPicture src={row.image} alt={row.itemName || row.itemTypeName} />
      </span>
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
            <p>이용 코드 입력 → NFC 인식 → 상태 선택 → 반납 확정</p>
          </Notice>
          <Link to="/mobile/code" className="primary full">
            이용 코드 보기
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
      <Heading title="내 정보" />
      {error ? (
        <>
          <Failure error={error} retry={() => void logout()} title="로그아웃을 확인하지 못했어요" />
          <p>로그아웃 결과를 확인하지 못해 개인정보를 가렸어요.</p>
        </>
      ) : profile.loading ? (
        <Loading />
      ) : profile.error ? (
        <Failure error={profile.error} retry={profile.reload} />
      ) : (
        <>
          <section className="uw-card uw-profile uw-member-pass">
            <UserRound size={40} aria-hidden="true" />
            <div>
              <span className="uw-member-label">캠퍼스 이용자</span>
              <h2>{profile.data?.name}님</h2>
              <p>{profile.data?.occupation}</p>
            </div>
          </section>
          <button className="secondary full" disabled={busy} onClick={() => void logout()}>
            {busy ? '로그아웃 중…' : '로그아웃'}
          </button>
        </>
      )}
    </div>
  );
}
function AuthPage({ mode = 'access' }: { mode?: 'access' | 'signup' }) {
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
                <Route path="recover" element={<Navigate to="/mobile/login" replace />} />
                <Route path="change-phone" element={<Navigate to="/mobile/login" replace />} />
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
