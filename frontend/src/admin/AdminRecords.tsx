import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadAdminData, type AdminData } from './adminQueries';
import './admin-records.css';
const labels: Record<string, string> = {
  AVAILABLE: '대여 가능',
  TAG_PENDING: '태그 등록 대기',
  RENTED: '대여 중',
  INSPECTION: '점검 중',
  REPAIR: '수리 중',
  RETURNED: '반납 완료',
  OVERDUE: '연체 중',
  ACTIVE: '대여 중 전체 (연체 포함)',
  USER: '일반 사용자',
  ADMIN: '관리자',
};
const tabs = { items: '물품', users: '사용자', rentals: '대여 이력' };
type Tab = keyof typeof tabs;
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
export default function AdminRecords({
  section,
  initialFilter,
  onSection,
}: {
  section: string;
  initialFilter: string;
  onSection: (section: string, filter?: string) => void;
}) {
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const tab: Tab = section === 'users' ? 'users' : section === 'rentals' ? 'rentals' : 'items';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let active = true;
    setData(undefined);
    setError('');
    setPage(0);
    loadAdminData(controller.signal)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) {
          setError(
            controller.signal.aborted
              ? '조회 시간이 초과되었습니다. 다시 시도해 주세요.'
              : e instanceof Error
                ? e.message
                : '조회에 실패했습니다.',
          );
          controller.abort();
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [reload]);
  const select = (next: Tab, state = '') => {
    onSection(next, state);
    setQuery('');
    setFilter(state);
    setPage(0);
  };
  const rows = (data?.[tab] || []).filter(
    (r) =>
      (section !== 'maintenance' || ['INSPECTION', 'REPAIR'].includes(r.status)) &&
      (!filter || (filter === 'ACTIVE' ? r.status !== 'RETURNED' : r.status === filter)) &&
      [r.name, r.id, r.detail, r.userId, r.itemId]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const current = Math.min(page, pages - 1);
  const options =
    tab === 'items'
      ? ['AVAILABLE', 'TAG_PENDING', 'RENTED', 'INSPECTION', 'REPAIR']
      : tab === 'users'
        ? ['USER', 'ADMIN']
        : ['ACTIVE', 'RENTED', 'OVERDUE', 'RETURNED'];
  return (
    <div className="admin-records">
      <div>
        <div className="admin-records-heading">
          <div>
            <h1>
              {section === 'users'
                ? '사용자 관리'
                : section === 'rentals'
                  ? '대여 현황'
                  : section === 'maintenance'
                    ? '점검·수리'
                    : '물품 관리'}
            </h1>
            <p>{'물품과 사용자, 대여 현황을 한곳에서 확인하세요.'}</p>
          </div>
          <button onClick={() => setReload((v) => v + 1)}>새로고침</button>
        </div>
        {error ? (
          <section className="admin-records-error" role="alert">
            <p>{error}</p>
            <button onClick={() => setReload((v) => v + 1)}>다시 시도</button>
            <Link to="/mobile">로그인 화면으로</Link>
          </section>
        ) : !data ? (
          <p role="status">전체 현황을 불러오는 중입니다…</p>
        ) : (
          <>
            <div className="admin-records-meta">
              {data.operator} · {formatDate(new Date(data.loadedAt).toISOString())} 조회 · 시간은
              한국 기준
            </div>
            <section className="admin-records-stats" aria-label="전체 현황">
              {(
                [
                  ['전체 물품', data.items.length, 'items', ''],
                  ['사용자', data.users.length, 'users', ''],
                  [
                    '대여 중',
                    data.rentals.filter((r) => r.status !== 'RETURNED').length,
                    'rentals',
                    'ACTIVE',
                  ],
                  [
                    '연체 중',
                    data.rentals.filter((r) => r.status === 'OVERDUE').length,
                    'rentals',
                    'OVERDUE',
                  ],
                  [
                    '반납 완료',
                    data.rentals.filter((r) => r.status === 'RETURNED').length,
                    'rentals',
                    'RETURNED',
                  ],
                ] as const
              ).map(([label, count, next, state]) => (
                <button key={label} onClick={() => select(next, state)}>
                  <span>{label}</span>
                  <strong>{count.toLocaleString()}</strong>
                </button>
              ))}
            </section>
            <section className="admin-records-panel">
              <div className="admin-records-controls">
                <label>
                  검색
                  <input
                    value={query}
                    placeholder={
                      tab === 'rentals' ? '물품명, 사용자명, ID 검색' : '이름, ID, 종류·직업 검색'
                    }
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <label>
                  {tab === 'users' ? '권한' : '상태'}
                  <select
                    aria-label={tab === 'users' ? '권한' : '상태'}
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">전체</option>
                    {options.map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => {
                    setQuery('');
                    setFilter('');
                    setPage(0);
                  }}
                >
                  조건 초기화
                </button>
              </div>
              <p aria-live="polite">
                검색 결과 {rows.length.toLocaleString()}건 / 전체{' '}
                {data[tab].length.toLocaleString()}건
              </p>
              <div className="admin-records-table">
                <table>
                  <caption>{tabs[tab]} 조회 결과</caption>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>{tab === 'users' ? '사용자명' : '물품명'}</th>
                      <th>{tab === 'users' ? '직업' : tab === 'items' ? '물품 종류' : '사용자'}</th>
                      <th>{tab === 'users' ? '권한' : '상태'}</th>
                      {tab === 'rentals' && (
                        <>
                          <th>대여 시각</th>
                          <th>반납 예정</th>
                          <th>반납 시각</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(current * 20, current * 20 + 20).map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>
                          {r.name}
                          {tab === 'rentals' && <small>물품 ID {r.itemId}</small>}
                        </td>
                        <td>
                          {r.detail || '—'}
                          {tab === 'rentals' && <small>사용자 ID {r.userId}</small>}
                        </td>
                        <td>
                          <span
                            className={
                              'admin-records-badge ' + (r.status === 'OVERDUE' ? 'overdue' : '')
                            }
                          >
                            {labels[r.status]}
                          </span>
                          {r.status === 'RETURNED' && r.overdue && <small>연체 반납</small>}
                        </td>
                        {tab === 'rentals' && (
                          <>
                            <td>{formatDate(r.rentedAt)}</td>
                            <td>{formatDate(r.dueAt)}</td>
                            <td>{formatDate(r.returnedAt)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && (
                <p className="admin-records-empty">
                  {data[tab].length ? '조건에 맞는 결과가 없습니다.' : '등록된 내역이 없습니다.'}
                </p>
              )}
              <nav className="admin-records-pagination" aria-label="페이지 이동">
                <button disabled={current === 0} onClick={() => setPage(current - 1)}>
                  이전
                </button>
                <span>
                  {current + 1} / {pages} 페이지
                </span>
                <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
                  다음
                </button>
              </nav>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
