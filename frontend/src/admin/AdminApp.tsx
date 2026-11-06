import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Users, CalendarDays, Wrench, MapPin, Plus, RefreshCw, Search, X } from 'lucide-react';
import { Brand, ErrorBox, Loading } from '../shared/ui';
import { serverSession } from '../shared/httpAuth';
import { ServiceError } from '../shared/serviceError';
import { nfc } from '../shared/nfc';
import { normalizeUid } from '../shared/nfcUid';
import type { Catalog, Item, ItemStatus } from '../shared/types';
import { adminApi, type ItemDraft } from './adminApi';
import AdminRecords from './AdminRecords';
import './admin.css';
import './reference.css';

const labels: Record<ItemStatus, string> = {
  pending: '태그 등록 대기',
  available: '대여 가능',
  rented: '대여 중',
  inspection: '점검 중',
  repair: '수리 중',
};
export default function AdminApp() {
  const [section, updateSection] = useState('items');
  const [recordFilter, setRecordFilter] = useState('');
  const setSection = (next: string, filter = '') => {
    detailRevision.current++;
    setDetailLoading(false);
    updateSection(next);
    setRecordFilter(filter);
    setSelected(undefined);
    setQuery('');
    setStatus('');
  };
  const recordsView = section === 'users' || section === 'rentals';
  const [catalog, setCatalog] = useState<Catalog>();
  const [operator, setOperator] = useState('관리자');
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [selected, setSelected] = useState<Item>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState<Item | null | undefined>();
  const [changing, setChanging] = useState<Item>();
  const [deleting, setDeleting] = useState<Item>();
  const [page, setPage] = useState(0);
  const revision = useRef(0);
  const detailRevision = useRef(0);
  async function load() {
    const seq = ++revision.current;
    setLoading(true);
    setError(undefined);
    setCatalog(undefined);
    setSelected(undefined);
    detailRevision.current++;
    setDetailLoading(false);
    try {
      const session = await serverSession();
      if (session.user.role !== 'ADMIN')
        throw new ServiceError('FORBIDDEN', '관리자 계정으로 로그인해 주세요.');
      const data = await adminApi.catalog();
      if (seq !== revision.current) return;
      setOperator(session.user.name || '관리자');
      setCatalog(data);
      setPage(0);
    } catch (e) {
      if (seq === revision.current) setError(e);
    } finally {
      if (seq === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
      detailRevision.current++;
    };
  }, []);
  useEffect(() => {
    setPage(0);
  }, [query, status, kind, section]);
  async function select(item: Item) {
    const seq = ++detailRevision.current;
    setSelected(undefined);
    setDetailLoading(true);
    setError(undefined);
    try {
      const result = await adminApi.getItem(item.id);
      if (seq === detailRevision.current) setSelected(result);
    } catch (e) {
      if (seq === detailRevision.current) setError(e);
    } finally {
      if (seq === detailRevision.current) setDetailLoading(false);
    }
  }
  const rows = (catalog?.items || []).filter(
    (i) =>
      (!status || i.status === status) &&
      (!kind || i.kindId === kind) &&
      (section !== 'maintenance' || ['inspection', 'repair'].includes(i.status)) &&
      `${i.name} ${i.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const saved = () => {
    setEditing(undefined);
    setChanging(undefined);
    setDeleting(undefined);
    void load();
  };
  return (
    <div className={`admin-shell${recordsView ? '' : ' has-detail'}`}>
      <aside className="admin-sidebar">
        <Brand />
        <span className="admin-workspace">관리자</span>
        <nav aria-label="관리자 메뉴">
          <button
            className={section === 'items' ? 'active' : ''}
            onClick={() => setSection('items')}
          >
            <Box size={20} />
            물품 관리
          </button>
          <button
            className={section === 'users' ? 'active' : ''}
            onClick={() => setSection('users')}
          >
            <Users size={20} />
            사용자 관리
          </button>
          <button
            className={section === 'rentals' ? 'active' : ''}
            onClick={() => setSection('rentals')}
          >
            <CalendarDays size={23} />
            대여 현황
          </button>
          <button
            className={section === 'maintenance' ? 'active' : ''}
            onClick={() => setSection('maintenance')}
          >
            <Wrench size={23} />
            점검·수리
          </button>
        </nav>
        <div className="admin-profile">
          <span>관</span>
          <div>
            <strong>{operator}</strong>
            <small>관리자</small>
          </div>
        </div>
        <Link className="admin-mobile-link" to="/mobile">
          사용자 화면 · 로그인
        </Link>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <span>
            운영 관리 /{' '}
            {section === 'users'
              ? '사용자 관리'
              : section === 'rentals'
                ? '대여 현황'
                : section === 'maintenance'
                  ? '점검·수리'
                  : '물품 관리'}
          </span>
          <span>
            <MapPin size={15} />
            {catalog?.stations[0]?.name || '대여소'}
          </span>
        </header>
        {recordsView ? (
          <AdminRecords
            key={section + recordFilter}
            initialFilter={recordFilter}
            section={section}
            onSection={setSection}
          />
        ) : (
          <>
            <div className="admin-title">
              <div>
                <h1>{section === 'maintenance' ? '점검·수리' : '물품 관리'}</h1>
                <p>대여소의 물품과 상태를 관리하세요.</p>
              </div>
              <button
                className="primary"
                disabled={!catalog || loading}
                onClick={() => setEditing(null)}
              >
                <Plus size={18} />
                물품 등록
              </button>
            </div>
            <section className="admin-stats" aria-label="물품 현황">
              {[['', '전체 물품'], ...Object.entries(labels)].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={status === value}
                  className={status === value ? 'selected' : ''}
                  onClick={() => setStatus(value)}
                >
                  <span>{label}</span>
                  <strong>
                    {catalog
                      ? catalog.items.filter((i) => !value || i.status === value).length
                      : '—'}
                    <small>개</small>
                  </strong>
                </button>
              ))}
            </section>
            <section className="admin-inventory">
              <div className="admin-toolbar">
                <label className="admin-search">
                  <Search size={19} />
                  <input
                    aria-label="물품 검색"
                    placeholder="물품명 또는 물품 ID 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="물품 종류 필터"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="">전체 종류</option>
                  {catalog?.kinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="상태 필터"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">전체 상태</option>
                  {Object.entries(labels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <button aria-label="새로고침" onClick={() => void load()}>
                  <RefreshCw size={18} />
                </button>
              </div>
              {loading ? (
                <Loading />
              ) : !catalog ? (
                <div className="admin-empty">
                  <p>물품을 불러오지 못했습니다.</p>
                  <button onClick={() => void load()}>다시 조회</button>
                  <Link to="/mobile/login">로그인</Link>
                </div>
              ) : (
                <>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>물품명</th>
                          <th>물품 ID</th>
                          <th>물품 종류</th>
                          <th>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(currentPage * 20, currentPage * 20 + 20).map((i) => (
                          <tr
                            key={i.id}
                            tabIndex={0}
                            className={selected?.id === i.id ? 'selected' : ''}
                            onClick={() => void select(i)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                void select(i);
                              }
                            }}
                          >
                            <td>{i.name}</td>
                            <td>{i.id}</td>
                            <td>{catalog.kinds.find((k) => k.id === i.kindId)?.name}</td>
                            <td>
                              <span className={`admin-status ${i.status}`}>{labels[i.status]}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!rows.length && (
                    <div className="admin-empty">
                      <Box size={34} />
                      <h2>조건에 맞는 물품이 없어요</h2>
                    </div>
                  )}
                  <footer className="admin-pagination">
                    <span>총 {rows.length}개 물품</span>
                    <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
                      이전
                    </button>
                    <span>
                      {currentPage + 1} / {pages}
                    </span>
                    <button
                      disabled={currentPage + 1 >= pages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      다음
                    </button>
                  </footer>
                </>
              )}
            </section>
            <ErrorBox error={error} retry={() => void load()} />
          </>
        )}
      </main>
      {!recordsView && (
        <aside className="admin-detail" aria-label="물품 상세">
          <header>
            <h2>물품 상세</h2>
          </header>
          {detailLoading ? (
            <Loading />
          ) : selected ? (
            <>
              <div className="admin-detail-art">
                <Box size={88} strokeWidth={1.3} />
              </div>
              <span className={`admin-status ${selected.status}`}>{labels[selected.status]}</span>
              <h3>{selected.name}</h3>
              <dl>
                <div>
                  <dt>물품 ID</dt>
                  <dd>{selected.id}</dd>
                </div>
                <div>
                  <dt>물품 종류</dt>
                  <dd>{catalog?.kinds.find((k) => k.id === selected.kindId)?.name}</dd>
                </div>
                <div>
                  <dt>태그 ID</dt>
                  <dd>{selected.tag || '태그 미등록'}</dd>
                </div>
              </dl>
              <button className="primary" onClick={() => setEditing(selected)}>
                물품 수정{!selected.tag ? ' / NFC 태그 연결' : ''}
              </button>
              <button
                className="secondary"
                disabled={!['available', 'inspection', 'repair'].includes(selected.status)}
                onClick={() => setChanging(selected)}
              >
                상태 변경
              </button>
              <button
                className="secondary danger"
                disabled={selected.status === 'rented'}
                onClick={() => setDeleting(selected)}
              >
                물품 삭제
              </button>
            </>
          ) : (
            <div className="admin-detail-empty">
              <Box size={48} />
              <p>물품을 선택해 주세요</p>
            </div>
          )}
        </aside>
      )}
      {editing !== undefined && catalog && (
        <ItemEditor
          original={editing}
          catalog={catalog}
          close={() => {
            setEditing(undefined);
            void load();
          }}
          saved={saved}
        />
      )}
      {changing && (
        <StatusEditor item={changing} close={() => setChanging(undefined)} saved={saved} />
      )}
      {deleting && (
        <DeleteItem item={deleting} close={() => setDeleting(undefined)} saved={saved} />
      )}
    </div>
  );
}
function Dialog({
  title,
  children,
  close,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="admin-dialog-heading">
        <h2>{title}</h2>
        <button type="button" aria-label="닫기" disabled={busy} onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ItemEditor({
  original,
  catalog,
  close,
  saved,
}: {
  original: Item | null;
  catalog: Catalog;
  close: () => void;
  saved: () => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>({
    label: original?.name || '',
    kindId: original?.kindId || '',
  });
  const [pending, setPending] = useState<Item>();
  const [uid, setUid] = useState('');
  const [retryUid, setRetryUid] = useState('');
  const [reader, setReader] = useState('connecting');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<unknown>();
  const [uncertainCreate, setUncertainCreate] = useState(false);
  useEffect(() => {
    if (original?.tag || busy || retryUid) return;
    return nfc.subscribe((r) => setUid(r.uid), { onStatus: setReader });
  }, [original?.tag, busy, retryUid]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || uncertainCreate) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    let item = pending;
    try {
      if (!item) {
        try {
          item = await adminApi.save('', draft, original || undefined);
          setPending(item);
        } catch (e) {
          if (!original && e instanceof ServiceError && e.code === 'UNKNOWN')
            setUncertainCreate(true);
          throw e;
        }
      }
      if (!item.tag && (retryUid || uid)) {
        const value = retryUid || normalizeUid(uid);
        try {
          await adminApi.attachTag(item.id, value);
          setRetryUid('');
        } catch (e) {
          if (e instanceof ServiceError && e.code === 'UNKNOWN') setRetryUid(value);
          throw e;
        }
      }
      saved();
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog title={original ? '물품 수정' : '물품 등록'} close={close} busy={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy || !!pending || uncertainCreate}>
          <label>
            물품명
            <input
              required
              maxLength={100}
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label>
            물품 종류
            <select
              required
              aria-label="물품 종류"
              value={draft.kindId}
              onChange={(e) => setDraft({ ...draft, kindId: e.target.value })}
            >
              <option value="">선택해 주세요</option>
              {catalog.kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          {!catalog.kinds.length && (
            <p role="status">등록된 물품 종류가 없습니다. 관리자에게 종류 등록을 요청해 주세요.</p>
          )}
        </fieldset>
        {!original?.tag && (
          <fieldset disabled={busy || uncertainCreate || !!retryUid}>
            <label>
              NFC 태그 UID
              <input
                aria-label="NFC 태그 UID"
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                placeholder="리더기에 태그를 대거나 UID 입력"
              />
            </label>
            <p className="admin-help">
              {reader === 'connected' ? '리더기 연결됨' : '리더기 연결을 확인해 주세요.'} 태그는
              물품 생성 후 연결됩니다.
            </p>
          </fieldset>
        )}
        {pending && (
          <p role="status">물품 ID {pending.id} 저장 완료. 다시 시도하면 태그만 연결합니다.</p>
        )}
        {uncertainCreate && (
          <p role="alert">
            생성 결과가 불명확합니다. 중복 생성을 막기 위해 다시 저장할 수 없습니다. 창을 닫고
            목록에서 생성 여부를 확인해 주세요.
          </p>
        )}
        <ErrorBox error={error} />
        <div className="admin-dialog-actions">
          <button type="button" disabled={busy} onClick={close}>
            닫기
          </button>
          <button className="primary" disabled={busy || uncertainCreate || !draft.kindId}>
            {busy
              ? '저장 중…'
              : pending
                ? '태그 연결 재시도'
                : original
                  ? '변경사항 저장'
                  : '등록하기'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function StatusEditor({
  item,
  close,
  saved,
}: {
  item: Item;
  close: () => void;
  saved: () => void;
}) {
  const [status, setStatus] = useState<ItemStatus>(item.status),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const lock = useRef(false);
  return (
    <Dialog title="상태 변경" close={close} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError(undefined);
          try {
            await adminApi.changeStatus(item.id, status, reason);
            saved();
          } catch (e) {
            setError(e);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          변경할 상태
          <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
            {['available', 'inspection', 'repair'].map((s) => (
              <option key={s} value={s}>
                {labels[s as ItemStatus]}
              </option>
            ))}
          </select>
        </label>
        <label>
          변경 사유
          <textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <button className="primary" disabled={busy}>
          상태 저장
        </button>
      </form>
    </Dialog>
  );
}
function DeleteItem({ item, close, saved }: { item: Item; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const lock = useRef(false);
  return (
    <Dialog title="물품 삭제" close={close} busy={busy}>
      <p>
        {item.name}을 삭제할까요? 태그 또는 이용·상태 변경 이력이 있는 물품은 삭제할 수 없습니다.
      </p>
      <ErrorBox error={error} />
      <button
        className="danger"
        disabled={busy}
        onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError(undefined);
          try {
            await adminApi.remove(item);
            saved();
          } catch (e) {
            setError(e);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        삭제 확인
      </button>
    </Dialog>
  );
}
