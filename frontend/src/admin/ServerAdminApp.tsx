import { useEffect, useState } from 'react';
import { Box, RefreshCw, Search } from 'lucide-react';
import { Brand, Loading } from '../shared/ui';
import {
  fetchAdminItems,
  fetchItemTypes,
  serverStatusLabels,
  type ServerItemPage,
  type ServerItemType,
} from './adminQueryHttp';

const PAGE_SIZE = 20;

export default function ServerAdminApp() {
  const [keyword, setKeyword] = useState('');
  const [itemTypeId, setItemTypeId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<ServerItemPage>();
  const [types, setTypes] = useState<ServerItemType[]>([]);
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    const timer = window.setTimeout(() => {
      void Promise.all([
        fetchAdminItems({ keyword, itemTypeId, status, page, size: PAGE_SIZE }, controller.signal),
        fetchItemTypes(controller.signal),
      ])
        .then(([items, itemTypes]) => {
          if (controller.signal.aborted) return;
          setResult(items);
          setTypes(itemTypes);
          setLoading(false);
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setError(failure);
          setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, itemTypeId, status, page, attempt]);

  const selected = result?.items.find((item) => item.itemId === selectedId);
  const resetSelection = () => {
    setPage(0);
    setSelectedId(undefined);
  };
  const refresh = () => setAttempt((value) => value + 1);
  return (
    <div className="admin-shell has-detail server-admin">
      <aside className="admin-sidebar">
        <Brand />
        <span className="admin-workspace">관리자</span>
        <nav aria-label="관리자 메뉴">
          <button className="active">
            <Box size={20} /> 물품 관리
          </button>
        </nav>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <span>운영 관리 / 물품 관리</span>
        </header>
        <div className="admin-title">
          <div>
            <h1>물품 관리</h1>
            <p>서버에 등록된 물품을 조회합니다.</p>
          </div>
        </div>
        <section className="admin-inventory" aria-label="물품 조회">
          <div className="admin-toolbar">
            <label className="admin-search">
              <Search size={19} />
              <input
                aria-label="물품 검색"
                placeholder="물품명, 종류 또는 태그 ID 검색"
                value={keyword}
                maxLength={200}
                onChange={(event) => {
                  resetSelection();
                  setKeyword(event.target.value);
                }}
              />
            </label>
            <select
              aria-label="물품 종류 필터"
              value={itemTypeId}
              onChange={(event) => {
                resetSelection();
                setItemTypeId(event.target.value);
              }}
            >
              <option value="">전체 종류</option>
              {types.map((type) => (
                <option key={type.itemTypeId} value={type.itemTypeId}>
                  {type.itemTypeName}
                </option>
              ))}
            </select>
            <select
              aria-label="물품 상태 필터"
              value={status}
              onChange={(event) => {
                resetSelection();
                setStatus(event.target.value);
              }}
            >
              <option value="">전체 상태</option>
              {Object.entries(serverStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="secondary"
              disabled={!keyword && !itemTypeId && !status}
              onClick={() => {
                setKeyword('');
                setItemTypeId('');
                setStatus('');
                resetSelection();
              }}
            >
              조건 초기화
            </button>
            <button
              className="admin-refresh"
              aria-label="새로고침"
              title="새로고침"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {loading ? (
            <Loading />
          ) : error ? (
            <div className="admin-empty" role="alert">
              <p>{error instanceof Error ? error.message : '물품을 불러오지 못했습니다.'}</p>
              <button className="secondary" onClick={refresh}>
                다시 시도
              </button>
            </div>
          ) : (
            result && (
              <>
                <div className="admin-list-heading">
                  검색 결과 <span>{result.totalElements}개</span>
                </div>
                {result.items.length ? (
                  <div className="admin-table-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>물품명</th>
                          <th>물품 종류</th>
                          <th>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.items.map((item) => (
                          <tr
                            key={item.itemId}
                            className={selectedId === item.itemId ? 'is-selected' : ''}
                          >
                            <td>
                              <button
                                className="admin-item-cell"
                                aria-label={`${item.itemName} 상세 보기`}
                                aria-pressed={selectedId === item.itemId}
                                onClick={() => setSelectedId(item.itemId)}
                              >
                                {item.itemName}
                              </button>
                            </td>
                            <td>{item.itemTypeName}</td>
                            <td>
                              <span className={`admin-status ${item.status.toLowerCase()}`}>
                                {serverStatusLabels[item.status]}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-empty">
                    <Box size={34} />
                    <h2>조건에 맞는 물품이 없어요</h2>
                    <p>검색어나 필터를 변경해 보세요.</p>
                  </div>
                )}
                <footer className="admin-pagination" aria-label="페이지 이동">
                  <span>
                    검색 결과 총 {result.totalElements}개 ·{' '}
                    {result.totalPages ? result.page + 1 : 0} / {result.totalPages}페이지
                  </span>
                  <button
                    className="secondary"
                    disabled={page === 0}
                    onClick={() => {
                      setSelectedId(undefined);
                      setPage((value) => value - 1);
                    }}
                  >
                    이전
                  </button>
                  <button
                    className="secondary"
                    disabled={page + 1 >= result.totalPages}
                    onClick={() => {
                      setSelectedId(undefined);
                      setPage((value) => value + 1);
                    }}
                  >
                    다음
                  </button>
                </footer>
              </>
            )
          )}
        </section>
      </main>
      <aside className="admin-detail" aria-label="물품 상세">
        <header>
          <h2>물품 상세</h2>
        </header>
        {!loading && !error && selected ? (
          <>
            <span className={`admin-status ${selected.status.toLowerCase()}`}>
              {serverStatusLabels[selected.status]}
            </span>
            <h3>{selected.itemName}</h3>
            <dl>
              <div>
                <dt>물품 ID</dt>
                <dd>{selected.itemId}</dd>
              </div>
              <div>
                <dt>물품 종류</dt>
                <dd>{selected.itemTypeName}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p>목록에서 물품을 선택해 주세요.</p>
        )}
      </aside>
    </div>
  );
}
