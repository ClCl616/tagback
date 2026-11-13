import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  LayoutDashboard,
  Users,
  ClipboardList,
  History,
  CircleAlert,
  Radio,
  Plus,
  RefreshCw,
  Menu,
  X,
  Tag,
  ArrowRight,
  LogOut,
  Wrench,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { serverSession } from '../shared/httpAuth';
import { authApi } from '../shared/auth';
import { COOKIE_SESSION } from '../shared/authMode';
import { ServiceError } from '../shared/serviceError';
import type { Item } from '../shared/types';
import AuthFlow from '../mobile/AuthFlow';
import { loadAdminData, type AdminData, type AdminRecord } from './adminQueries';
import { adminApi } from './adminApi';
import { ItemEditor, StatusEditor, DeleteItem, TagEditor } from './AdminActions';
import { allPages } from '../shared/http';
import { parseItem } from '../shared/catalogHttp';
import '../mobile/user-web.css';
import './admin-web.css';

export const itemLabels: Record<string, string> = {
  pending: '태그 등록 대기',
  available: '대여 가능',
  rented: '대여 중',
  inspection: '점검 중',
  repair: '수리 중',
  TAG_PENDING: '태그 등록 대기',
  AVAILABLE: '대여 가능',
  RENTED: '대여 중',
  INSPECTION: '점검 중',
  REPAIR: '수리 중',
  RETURNED: '반납 완료',
  OVERDUE: '연체 중',
  USER: '일반 사용자',
  ADMIN: '관리자',
};
export const formatDate = (v?: string | null) =>
  v
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(v))
    : '—';
export function Badge({ value }: { value: string }) {
  return <span className={'aw-badge ' + value.toLowerCase()}>{itemLabels[value] || value}</span>;
}
export function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="aw-failure" role="alert">
      <CircleAlert size={20} />
      <div>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        {retry && (
          <button onClick={retry} type="button">
            다시 시도
          </button>
        )}
      </div>
    </div>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="aw-empty">
      <Box size={34} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}
const Access = createContext<(error: unknown) => boolean>(() => false);
export const useAdminError = () => useContext(Access);
const menus = [
  ['overview', '현황', LayoutDashboard],
  ['items', '물품 관리', Box],
  ['tags', 'NFC 태그', Radio],
  ['rentals', '대여 현황', ClipboardList],
  ['overdue', '연체 조회', CircleAlert],
  ['history', '이용 이력', History],
  ['users', '사용자', Users],
] as const;
function Brand() {
  return (
    <Link className="aw-brand" to="/admin">
      <Tag size={29} />
      <strong>TagBack</strong>
      <span>관리자</span>
    </Link>
  );
}
export default function AdminWeb() {
  const location = useLocation(),
    nav = useNavigate();
  const authPage = /\/admin\/(login|recover)$/.test(location.pathname);
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const seq = useRef(0),
    identity = useRef(''),
    active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const clear = (e?: unknown) => {
    seq.current++;
    controller.current?.abort();
    identity.current = '';
    setData(undefined);
    setError(e);
    setBusy(false);
    setGeneration((v) => v + 1);
  };
  const deny = (e: unknown) => {
    if (e instanceof ServiceError && ['AUTH', 'FORBIDDEN'].includes(e.code)) {
      clear(e);
      return true;
    }
    return false;
  };
  async function load(message = '') {
    const run = ++seq.current;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 60000);
    setBusy(true);
    setError(undefined);
    setData(undefined);
    setNotice(message);
    try {
      const result = await loadAdminData(ctrl.signal);
      const session = await serverSession();
      if (!active.current || run !== seq.current) return;
      if (session.user.role !== 'ADMIN')
        throw new ServiceError('FORBIDDEN', '관리자 계정으로 로그인해 주세요.');
      if (session.user.userId !== result.operatorId) {
        void load();
        return;
      }
      identity.current = result.operatorId;
      setData(result);
    } catch (e) {
      if (active.current && run === seq.current) {
        if (!deny(e)) setError(e);
      }
    } finally {
      clearTimeout(timer);
      if (active.current && run === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    if (!authPage) void load();
    else clear();
    return () => {
      active.current = false;
      seq.current++;
      controller.current?.abort();
    };
  }, [authPage]);
  useEffect(() => {
    let checking = false;
    async function check() {
      if (!identity.current || checking || document.visibilityState !== 'visible') return;
      checking = true;
      const run = seq.current;
      try {
        const session = await serverSession();
        if (!active.current || run !== seq.current) return;
        if (session.user.role !== 'ADMIN')
          deny(new ServiceError('FORBIDDEN', '관리자 권한이 필요합니다.'));
        else if (session.user.userId !== identity.current) {
          clear();
          void load();
        }
      } catch (e) {
        if (active.current && run === seq.current) {
          if (!deny(e)) {
            clear(e);
          }
        }
      } finally {
        checking = false;
      }
    }
    const timer = setInterval(check, 30000);
    window.addEventListener('focus', check);
    window.addEventListener('tagback-session', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('tagback-session', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  const currentSeq = seq.current;
  const report = (e: unknown) => (currentSeq === seq.current ? deny(e) : true);
  const reload = (message = '') => {
    if (currentSeq === seq.current) void load(message);
  };
  const loginTarget =
    '/admin/login?next=' + encodeURIComponent(location.pathname + location.search);
  const params = new URLSearchParams(location.search),
    next = params.get('next');
  const destination =
    next && /^\/admin(?:\/|\?|$)/.test(next) && !/^\/admin\/(login|recover)/.test(next)
      ? next
      : '/admin';
  if (authPage)
    return (
      <div className="admin-web aw-auth user-web">
        <Brand />
        <div className="aw-auth-heading">
          <ShieldCheck />
          <h1>{location.pathname.endsWith('recover') ? '관리자 PIN 재설정' : '관리자 로그인'}</h1>
          <p>TagBack 계정으로 로그인한 후 관리자 권한을 확인합니다.</p>
        </div>
        <AuthFlow
          key={location.pathname}
          mode={location.pathname.endsWith('recover') ? 'reset' : 'access'}
          token=""
          adminDestination={destination}
          onLogin={() => {}}
          onClear={() => {}}
        />
        <Link className="aw-back-user" to="/mobile">
          사용자 웹으로
        </Link>
      </div>
    );
  if (!data)
    return (
      <div className="admin-web aw-gate">
        <Brand />
        <section className="aw-card">
          <ShieldCheck size={40} />
          <h1>
            {busy
              ? '관리자 화면을 준비하고 있어요'
              : error instanceof ServiceError && error.code === 'FORBIDDEN'
                ? '관리자 권한이 필요해요'
                : error instanceof ServiceError && error.code === 'AUTH'
                  ? '로그인이 필요해요'
                  : '연결 상태를 확인해 주세요'}
          </h1>
          {busy ? (
            <p role="status">세션과 운영 데이터를 확인하고 있어요.</p>
          ) : (
            <>
              <Failure error={error} />
              <div className="aw-actions">
                <button onClick={() => void load()}>다시 시도</button>
                <Link className="aw-primary" to={loginTarget}>
                  로그인
                </Link>
                <Link to="/mobile">사용자 웹으로</Link>
              </div>
            </>
          )}
          {notice && <p role="status">{notice}</p>}
        </section>
      </div>
    );
  return (
    <Access.Provider value={report}>
      <Workspace
        key={generation + ':' + data.operatorId}
        data={data}
        notice={notice}
        reload={reload}
        logout={async () => {
          try {
            await authApi.logout(COOKIE_SESSION);
            clear();
            window.dispatchEvent(new Event('tagback-session'));
            nav('/admin/login', { replace: true });
          } catch (e) {
            if (currentSeq === seq.current) {
              if (!deny(e)) throw e;
            }
          }
        }}
      />
    </Access.Provider>
  );
}
function Workspace({
  data,
  notice,
  reload,
  logout,
}: {
  data: AdminData;
  notice: string;
  reload: (message?: string) => void;
  logout: () => Promise<void>;
}) {
  const loc = useLocation(),
    nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  latestParams.current = params;
  const name = loc.pathname.split('/')[2] || 'overview';
  const section = menus.some(([id]) => id === name) ? name : 'overview';
  const title = menus.find(([id]) => id === section)![1];
  const itemView = ['items', 'tags'].includes(section),
    userView = section === 'users';
  const [menuOpen, setMenuOpen] = useState(false),
    [modal, setModal] = useState<{ type: 'new' | 'edit' | 'status' | 'delete'; item?: Item }>();
  const [logoutError, setLogoutError] = useState<unknown>(),
    [loggingOut, setLoggingOut] = useState(false);
  const q = params.get('q') || '',
    filter = params.get('status') || '',
    kind = params.get('kind') || '',
    selected = params.get('selected') || '',
    userId = params.get('user') || '';
  const mainRef = useRef<HTMLElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    restoreY = useRef(0);
  const accessError = useAdminError();
  const searchKey = JSON.stringify([section, q, kind, filter, data.loadedAt]);
  const [serverItems, setServerItems] = useState<{ key: string; items: Item[]; error?: unknown }>();
  useEffect(() => {
    if (!itemView) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams();
      if (q.trim()) query.set('keyword', q.trim());
      if (kind) query.set('itemTypeId', kind);
      const states: Record<string, string> = {
        pending: 'TAG_PENDING',
        available: 'AVAILABLE',
        rented: 'RENTED',
        inspection: 'INSPECTION',
        repair: 'REPAIR',
      };
      if (section === 'items' && states[filter]) query.set('status', states[filter]);
      if (section === 'tags' && filter !== 'linked' && filter !== 'all')
        query.set('status', 'TAG_PENDING');
      allPages(
        '/api/v1/admin/items?' + query,
        'items',
        AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
      )
        .then((rows) => {
          if (!controller.signal.aborted)
            setServerItems({ key: searchKey, items: rows.map(parseItem) });
        })
        .catch((error) => {
          if (!controller.signal.aborted && !accessError(error))
            setServerItems({ key: searchKey, items: [], error });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchKey, itemView, accessError]);
  const searching = itemView && serverItems?.key !== searchKey;
  const searchError = serverItems?.key === searchKey ? serverItems.error : undefined;
  const headingKey = section + ':' + selected;
  useEffect(() => {
    setMenuOpen(false);
    if (selected) {
      mainRef.current?.querySelector<HTMLElement>('.aw-detail h2')?.focus();
    } else if (returnFocus.current?.isConnected) {
      returnFocus.current.focus({ preventScroll: true });
      window.scrollTo(0, restoreY.current);
      returnFocus.current = null;
    } else mainRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [headingKey]);
  useEffect(() => {
    setModal(undefined);
  }, [section]);
  const update = (key: string, value: string, replace = true) => {
    const p = new URLSearchParams(latestParams.current);
    value ? p.set(key, value) : p.delete(key);
    if (key !== 'page' && key !== 'selected') {
      p.delete('page');
      p.delete('selected');
    }
    latestParams.current = p;
    setParams(p, { replace });
  };
  const open = (id: string) => {
    returnFocus.current = document.activeElement as HTMLElement;
    restoreY.current = window.scrollY;
    update('selected', id, false);
  };
  const close = () => update('selected', '', true);
  const saved = (message = '저장 완료. 최신 목록을 확인하고 있어요.') => {
    setModal(undefined);
    reload(message);
  };
  const compare = (values: unknown[]) =>
    values.join(' ').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase());
  const items = (serverItems?.key === searchKey ? serverItems.items : []).filter(
    (i) =>
      (!kind || kind === i.kindId) &&
      (section !== 'tags'
        ? !filter ||
          (filter === 'maintenance'
            ? ['inspection', 'repair'].includes(i.status)
            : i.status === filter)
        : filter === 'linked'
          ? i.status !== 'pending'
          : filter === 'all'
            ? true
            : i.status === 'pending'),
  );
  const users = data.users.filter(
    (r) => compare([r.name, r.id, r.detail]) && (!filter || r.status === filter),
  );
  const rentals = data.rentals.filter(
    (r) =>
      compare([r.name, r.detail, r.id, r.userId, r.itemId]) &&
      (!userId || r.userId === userId) &&
      (section === 'overdue'
        ? r.status === 'OVERDUE'
        : section === 'history'
          ? r.status === 'RETURNED'
          : filter === 'RETURNED'
            ? r.status === 'RETURNED'
            : filter === 'OVERDUE'
              ? r.status === 'OVERDUE'
              : filter === 'RENTED'
                ? r.status === 'RENTED'
                : r.status !== 'RETURNED'),
  );
  const rows = itemView ? items : userView ? users : rentals;
  const total = itemView
    ? data.catalog.items.length
    : userView
      ? data.users.length
      : data.rentals.length;
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    rawPage = Number(params.get('page') || 1);
  const page = Math.max(1, Math.min(pages, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1));
  const selectedRecord = (userView ? data.users : data.rentals).find((r) => r.id === selected);
  return (
    <div className="admin-web aw-shell">
      <aside className={'aw-sidebar ' + (menuOpen ? 'is-open' : '')}>
        <Brand />
        <div className="aw-nav-caption">운영 관리</div>
        <nav aria-label="관리자 메뉴">
          {menus.map(([id, label, Icon]) => (
            <NavLink
              key={id}
              to={id === 'overview' ? '/admin' : '/admin/' + id}
              end
              className={section === id ? 'active' : ''}
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="aw-operator">
          <span className="aw-avatar">{data.operator.slice(0, 1)}</span>
          <div>
            <strong>{data.operator}</strong>
            <small>관리자</small>
          </div>
        </div>
        <Link className="aw-user-link" to="/mobile">
          사용자 웹 <ArrowRight size={16} />
        </Link>
        <button
          disabled={loggingOut}
          onClick={async () => {
            setLoggingOut(true);
            setLogoutError(undefined);
            try {
              await logout();
            } catch (e) {
              setLogoutError(e);
            } finally {
              setLoggingOut(false);
            }
          }}
        >
          <LogOut size={17} />
          {loggingOut ? '로그아웃 중…' : '로그아웃'}
        </button>
        <Failure error={logoutError} />
      </aside>
      <main className="aw-main" ref={mainRef}>
        <div className="aw-mobile-bar">
          <Brand />
          <button
            aria-label="관리자 메뉴 열기"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        <div className="aw-breadcrumb">
          운영 관리 <span>/</span> {title}
          <small>최근 조회 {formatDate(new Date(data.loadedAt).toISOString())}</small>
        </div>
        <header className="aw-heading">
          <div>
            <h1 tabIndex={-1}>{title}</h1>
            <p>
              {section === 'overview'
                ? '물품 이용 현황과 확인이 필요한 내역을 한눈에 살펴보세요.'
                : itemView
                  ? '대여소의 물품과 태그를 확인하고 관리하세요.'
                  : userView
                    ? '사용자 정보와 관련 이용 내역을 확인하세요.'
                    : '대여부터 반납까지 이용 내역을 확인하세요.'}
            </p>
          </div>
          <div className="aw-actions">
            <button aria-label="새로고침" onClick={() => reload()}>
              <RefreshCw size={18} />
              <span>새로고침</span>
            </button>
            {(itemView || section === 'overview') && (
              <button className="aw-primary" onClick={() => setModal({ type: 'new' })}>
                <Plus size={18} />
                물품 등록
              </button>
            )}
          </div>
        </header>
        {notice && (
          <div className="aw-notice" role="status">
            {notice.replace('최신 목록을 확인하고 있어요.', '목록을 갱신했어요.')}
          </div>
        )}
        {section === 'overview' ? (
          <Overview data={data} />
        ) : (
          <>
            {itemView && section === 'items' && (
              <section className="aw-item-summary" aria-label="물품 현황">
                {[
                  ['', '전체 물품'],
                  ['available', '대여 가능'],
                  ['rented', '대여 중'],
                  ['pending', '태그 등록 대기'],
                  ['maintenance', '점검·수리'],
                ].map(([v, label]) => (
                  <button key={v} aria-pressed={v === filter} onClick={() => update('status', v)}>
                    <span>{label}</span>
                    <strong>
                      {
                        data.catalog.items.filter(
                          (i) =>
                            !v ||
                            (v === 'maintenance'
                              ? ['inspection', 'repair'].includes(i.status)
                              : i.status === v),
                        ).length
                      }
                    </strong>
                  </button>
                ))}
              </section>
            )}
            <div className={'aw-master-detail ' + (selected ? 'has-selection' : '')}>
              <section className="aw-card aw-list">
                {section === 'tags' && (
                  <div className="aw-tabs" aria-label="태그 상태">
                    {[
                      ['', '태그 미등록'],
                      ['linked', '연결됨'],
                      ['all', '전체'],
                    ].map(([v, t]) => (
                      <button
                        key={v}
                        aria-pressed={filter === v}
                        onClick={() => update('status', v)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                <div className="aw-toolbar">
                  <label className="aw-search">
                    <Search size={18} />
                    <span className="aw-sr">
                      {itemView ? '물품 검색' : userView ? '사용자 검색' : '대여 검색'}
                    </span>
                    <input
                      aria-label={itemView ? '물품 검색' : userView ? '사용자 검색' : '대여 검색'}
                      placeholder={
                        itemView
                          ? '물품명, 종류명 또는 활성 태그 검색'
                          : userView
                            ? '이름, ID, 직업 검색'
                            : '물품명, 사용자명, ID 검색'
                      }
                      value={q}
                      onChange={(e) => update('q', e.target.value)}
                    />
                  </label>
                  {itemView && (
                    <select
                      aria-label="물품 종류 필터"
                      value={kind}
                      onChange={(e) => update('kind', e.target.value)}
                    >
                      <option value="">전체 종류</option>
                      {data.catalog.kinds.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {section === 'items' && (
                    <select
                      aria-label="상태 필터"
                      value={filter}
                      onChange={(e) => update('status', e.target.value)}
                    >
                      <option value="">전체 상태</option>
                      {['pending', 'available', 'rented', 'inspection', 'repair'].map((s) => (
                        <option key={s} value={s}>
                          {itemLabels[s]}
                        </option>
                      ))}
                      <option value="maintenance">점검·수리</option>
                    </select>
                  )}
                  {userView && (
                    <select
                      aria-label="권한"
                      value={filter}
                      onChange={(e) => update('status', e.target.value)}
                    >
                      <option value="">전체 권한</option>
                      <option value="USER">일반 사용자</option>
                      <option value="ADMIN">관리자</option>
                    </select>
                  )}
                  {section === 'rentals' && (
                    <select
                      aria-label="상태"
                      value={filter}
                      onChange={(e) => update('status', e.target.value)}
                    >
                      <option value="">대여 중 전체 (연체 포함)</option>
                      <option value="RENTED">대여 중 (연체 제외)</option>
                      <option value="OVERDUE">연체 중</option>
                      <option value="RETURNED">반납 완료</option>
                    </select>
                  )}
                </div>
                {userId && (
                  <div className="aw-notice">
                    사용자 ID {userId}의 이용 내역{' '}
                    <button onClick={() => update('user', '')}>사용자 필터 해제</button>
                  </div>
                )}
                <p className="aw-result-count">
                  {itemView
                    ? '총 ' + rows.length + '개 물품'
                    : '검색 결과 ' + rows.length + '건 / 전체 ' + total + '건'}
                </p>
                {searching ? (
                  <div role="status">물품을 조회하고 있습니다…</div>
                ) : searchError ? (
                  <Failure error={searchError} retry={() => reload()} />
                ) : rows.length ? (
                  <div className="aw-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{userView ? '사용자' : '물품'}</th>
                          <th>ID</th>
                          <th>{itemView ? '종류' : userView ? '직업' : '사용자'}</th>
                          <th>{userView ? '권한' : '상태'}</th>
                          {!itemView && !userView && (
                            <th>{section === 'history' ? '반납일' : '반납 예정'}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {itemView
                          ? items.slice((page - 1) * 20, page * 20).map((i) => (
                              <tr key={i.id} className={selected === i.id ? 'selected' : ''}>
                                <td data-label="물품">
                                  <button className="aw-row-link" onClick={() => open(i.id)}>
                                    {i.name}
                                    <span className="aw-sr"> 상세 보기</span>
                                  </button>
                                </td>
                                <td data-label="ID">{i.id}</td>
                                <td data-label="종류">
                                  {data.catalog.kinds.find((k) => k.id === i.kindId)?.name || '—'}
                                </td>
                                <td data-label="상태">
                                  <Badge value={i.status} />
                                </td>
                              </tr>
                            ))
                          : (userView ? users : rentals)
                              .slice((page - 1) * 20, page * 20)
                              .map((r) => (
                                <tr key={r.id} className={selected === r.id ? 'selected' : ''}>
                                  <td data-label={userView ? '사용자' : '물품'}>
                                    <button className="aw-row-link" onClick={() => open(r.id)}>
                                      {r.name}
                                      <span className="aw-sr"> 상세 보기</span>
                                    </button>
                                  </td>
                                  <td data-label="ID">{r.id}</td>
                                  <td data-label={userView ? '직업' : '사용자'}>
                                    {r.detail || '미입력'}
                                  </td>
                                  <td data-label={userView ? '권한' : '상태'}>
                                    <Badge value={r.status} />
                                    {r.status === 'RETURNED' && r.overdue && (
                                      <small className="aw-overdue-note">연체 반납</small>
                                    )}
                                  </td>
                                  {!userView && (
                                    <td data-label={section === 'history' ? '반납일' : '반납 예정'}>
                                      {formatDate(section === 'history' ? r.returnedAt : r.dueAt)}
                                    </td>
                                  )}
                                </tr>
                              ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title={
                      !total
                        ? '등록된 내역이 없어요'
                        : itemView
                          ? '조건에 맞는 물품이 없어요'
                          : '조건에 맞는 내역이 없어요'
                    }
                  >
                    <button onClick={() => setParams({})}>필터 초기화</button>
                  </Empty>
                )}
                <footer className="aw-pagination">
                  <button
                    disabled={page <= 1}
                    onClick={() => update('page', String(page - 1), false)}
                  >
                    이전
                  </button>
                  <span>
                    {page} / {pages}
                  </span>
                  <button
                    disabled={page >= pages}
                    onClick={() => update('page', String(page + 1), false)}
                  >
                    다음
                  </button>
                </footer>
              </section>
              {selected &&
                (itemView ? (
                  <ItemDetail
                    key={selected}
                    id={selected}
                    data={data}
                    tags={section === 'tags'}
                    close={close}
                    saved={saved}
                    edit={(type, item) => setModal({ type, item })}
                  />
                ) : (
                  <aside
                    className="aw-card aw-detail"
                    aria-label={userView ? '사용자 상세' : '대여 상세'}
                  >
                    <DetailHeader title={userView ? '사용자 상세' : '대여 상세'} close={close} />
                    {selectedRecord ? (
                      userView ? (
                        <>
                          <Badge value={selectedRecord.status} />
                          <h3>{selectedRecord.name}</h3>
                          <Fields
                            values={[
                              ['사용자 ID', selectedRecord.id],
                              ['직업', selectedRecord.detail || '미입력'],
                            ]}
                          />
                          <h3>관련 대여 내역</h3>
                          <RecordLinks
                            rows={data.rentals.filter((r) => r.userId === selectedRecord.id)}
                          />
                          <Link
                            className="aw-secondary"
                            to={'/admin/rentals?user=' + selectedRecord.id}
                          >
                            관련 대여 보기 <ArrowRight size={16} />
                          </Link>
                          <Link
                            className="aw-text-link"
                            to={'/admin/history?user=' + selectedRecord.id}
                          >
                            이용 이력 보기
                          </Link>
                        </>
                      ) : (
                        <>
                          <Badge value={selectedRecord.status} />
                          <h3>{selectedRecord.name}</h3>
                          <Fields
                            values={[
                              ['대여 ID', selectedRecord.id],
                              ['물품 ID', selectedRecord.itemId],
                              ['사용자', selectedRecord.detail],
                              ['사용자 ID', selectedRecord.userId],
                              ['대여일', formatDate(selectedRecord.rentedAt)],
                              ['반납 예정', formatDate(selectedRecord.dueAt)],
                              ['반납일', formatDate(selectedRecord.returnedAt)],
                            ]}
                          />
                          {selectedRecord.status === 'RETURNED' && selectedRecord.overdue && (
                            <p className="aw-warning">반납 기한을 넘겨 반납한 기록입니다.</p>
                          )}
                          <p className="aw-notice">대여·반납은 키오스크에서 처리합니다.</p>
                          <Link
                            className="aw-secondary"
                            to={'/admin/users?selected=' + selectedRecord.userId}
                          >
                            사용자 상세 보기
                          </Link>
                        </>
                      )
                    ) : (
                      <Empty title="내역을 찾을 수 없어요">
                        <button onClick={close}>목록으로</button>
                      </Empty>
                    )}
                  </aside>
                ))}
            </div>
          </>
        )}
        {modal?.type === 'new' || modal?.type === 'edit' ? (
          <ItemEditor
            original={modal.item}
            catalog={data.catalog}
            close={(changed) => {
              setModal(undefined);
              if (changed) reload();
            }}
            saved={saved}
          />
        ) : modal?.type === 'status' && modal.item ? (
          <StatusEditor item={modal.item} close={() => setModal(undefined)} saved={saved} />
        ) : modal?.type === 'delete' && modal.item ? (
          <DeleteItem item={modal.item} close={() => setModal(undefined)} saved={saved} />
        ) : null}
      </main>
    </div>
  );
}
function Overview({ data }: { data: AdminData }) {
  const cards = [
    { name: '등록 물품', value: data.items.length, href: '/admin/items', Icon: Box },
    {
      name: '대여 중',
      value: data.rentals.filter((r) => r.status !== 'RETURNED').length,
      href: '/admin/rentals',
      Icon: ClipboardList,
    },
    {
      name: '연체',
      value: data.rentals.filter((r) => r.status === 'OVERDUE').length,
      href: '/admin/overdue',
      Icon: CircleAlert,
    },
    {
      name: '점검·수리',
      value: data.items.filter((r) => ['INSPECTION', 'REPAIR'].includes(r.status)).length,
      href: '/admin/items?status=maintenance',
      Icon: Wrench,
    },
  ];
  const recent = [...data.rentals]
    .sort((a, b) => Date.parse(b.rentedAt!) - Date.parse(a.rentedAt!))
    .slice(0, 6);
  const overdue = data.rentals
    .filter((r) => r.status === 'OVERDUE')
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
    .slice(0, 6);
  return (
    <>
      <section className="aw-stats" aria-label="전체 현황">
        {cards.map(({ name, value, href, Icon }) => (
          <Link key={name} to={href}>
            <span className={'aw-stat-icon ' + (name === '연체' ? 'warning' : '')}>
              <Icon size={25} />
            </span>
            <div>
              <span>{name}</span>
              <strong>
                {value}
                <small>{name === '등록 물품' || name === '점검·수리' ? '개' : '건'}</small>
              </strong>
            </div>
            <ArrowRight size={17} />
          </Link>
        ))}
      </section>
      <div className="aw-overview-grid">
        <section className="aw-card">
          <div className="aw-section-heading">
            <div>
              <h2>최근 대여 내역</h2>
              <p>최근에 시작된 이용 내역을 확인하세요.</p>
            </div>
            <Link to="/admin/rentals">
              전체 보기 <ArrowRight size={16} />
            </Link>
          </div>
          <RecordLinks rows={recent} />
        </section>
        <section className="aw-card">
          <div className="aw-section-heading">
            <div>
              <h2>연체 목록</h2>
              <p>반납 기한이 지난 이용 내역이에요.</p>
            </div>
            <Link to="/admin/overdue">
              전체 보기 <ArrowRight size={16} />
            </Link>
          </div>
          <RecordLinks rows={overdue} empty="현재 연체 내역이 없어요" />
        </section>
      </div>
      <div className="aw-guide">
        <Radio size={25} />
        <div>
          <h2>새 물품을 등록하셨나요?</h2>
          <p>NFC 태그를 연결하면 키오스크에서 실물을 식별할 수 있어요.</p>
        </div>
        <Link className="aw-secondary" to="/admin/tags">
          태그 연결하기 <ArrowRight size={17} />
        </Link>
      </div>
    </>
  );
}
function RecordLinks({
  rows,
  empty = '표시할 내역이 없어요',
}: {
  rows: AdminRecord[];
  empty?: string;
}) {
  return rows.length ? (
    <div className="aw-record-links">
      {rows.slice(0, 10).map((r) => (
        <Link
          key={r.id}
          to={'/admin/' + (r.status === 'RETURNED' ? 'history' : 'rentals') + '?selected=' + r.id}
        >
          <span className="aw-record-icon">
            <Box size={20} />
          </span>
          <div>
            <strong>{r.name}</strong>
            <small>
              {r.detail} · {formatDate(r.rentedAt)}
            </small>
          </div>
          <Badge value={r.status} />
          <ArrowRight size={16} />
        </Link>
      ))}
    </div>
  ) : (
    <Empty title={empty} />
  );
}
function DetailHeader({ title, close }: { title: string; close: () => void }) {
  return (
    <header>
      <h2 tabIndex={-1}>{title}</h2>
      <button aria-label={title + ' 닫기'} onClick={close}>
        <X size={20} />
      </button>
    </header>
  );
}
function Fields({ values }: { values: [string, ReactNode][] }) {
  return (
    <dl className="aw-fields">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
function ItemDetail({
  id,
  data,
  tags,
  close,
  saved,
  edit,
}: {
  id: string;
  data: AdminData;
  tags: boolean;
  close: () => void;
  saved: () => void;
  edit: (type: 'edit' | 'status' | 'delete', item: Item) => void;
}) {
  const [item, setItem] = useState<Item>(),
    [error, setError] = useState<unknown>(),
    [attempt, setAttempt] = useState(0);
  const report = useAdminError();
  useEffect(() => {
    let alive = true;
    setItem(undefined);
    setError(undefined);
    adminApi
      .getItem(id)
      .then((i) => {
        if (alive) setItem(i);
      })
      .catch((e) => {
        if (alive && !report(e)) setError(e);
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);
  return (
    <aside className="aw-card aw-detail" aria-label="물품 상세">
      <DetailHeader title={tags ? '태그 연결' : '물품 상세'} close={close} />
      {error ? (
        <Failure error={error} retry={() => setAttempt((v) => v + 1)} />
      ) : !item ? (
        <p role="status">물품과 현재 태그를 확인하고 있어요…</p>
      ) : (
        <>
          <div className="aw-item-art">
            <Box size={46} />
          </div>
          <Badge value={item.status} />
          <h3>{item.name}</h3>
          <Fields
            values={[
              ['물품 ID', item.id],
              ['물품 종류', data.catalog.kinds.find((k) => k.id === item.kindId)?.name],
              ['태그 UID', item.tag || '태그 미등록'],
            ]}
          />
          {tags ? (
            item.tag ? (
              <p className="aw-notice">이 물품에 태그가 연결되어 있어요.</p>
            ) : (
              <TagEditor item={item} saved={saved} />
            )
          ) : (
            <div className="aw-detail-actions">
              <button className="aw-primary" onClick={() => edit('edit', item)}>
                물품 수정{!item.tag ? ' / NFC 태그 연결' : ''}
              </button>
              <button
                disabled={!['available', 'inspection', 'repair'].includes(item.status)}
                onClick={() => edit('status', item)}
              >
                상태 변경
              </button>
              <button
                className="aw-danger"
                disabled={item.status === 'rented' || !!item.tag}
                onClick={() => edit('delete', item)}
              >
                물품 삭제
              </button>
              {(item.status === 'rented' || item.tag) && (
                <p className="aw-help">대여 중이거나 태그가 연결된 물품은 삭제할 수 없어요.</p>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
