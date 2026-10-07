import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Upload,
  Trash2,
  CalendarDays,
  Wrench,
  Settings,
  ChevronDown,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { nfc } from '../shared/nfc';
import { itemName, itemNumber } from './itemIdentity';
import { api } from '../shared/api';
import { DB_KEY } from '../shared/config';
import { Brand, ErrorBox, Loading } from '../shared/ui';
import type { Catalog, Item, ItemStatus } from '../shared/types';
import { adminApi, type ItemDraft } from './adminApi';
import { ItemRegistration, normalizeUid } from './itemRegistration';
import { readItemImage } from './itemImage';
import { CategorySelect } from './CategorySelect';
import './admin.css';
import './reference.css';

const labels: Record<ItemStatus, string> = {
  available: '대여 가능',
  rented: '대여 중',
  inspection: '점검 중',
  repair: '수리 중',
};
function AssetPhoto({ large = false }: { kind?: string; large?: boolean }) {
  return (
    <div
      className={'admin-placeholder ' + (large ? 'large' : '')}
      role="img"
      aria-label="기본 물품 이미지"
    >
      <Box size={large ? 88 : 38} strokeWidth={1.3} />
    </div>
  );
}
export default function AdminApp() {
  const [menu, setMenu] = useState<string>();
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.admin-row-actions')) setMenu(undefined);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(undefined);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const [deleting, setDeleting] = useState<Item>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState<Item | null | undefined>();
  const requestVersion = useRef(0);
  const [syncError, setSyncError] = useState<unknown>();
  const [selectedId, setSelectedId] = useState<string | null | undefined>();
  useEffect(() => {
    const deselect = (event: MouseEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              node.matches('.admin-table tbody tr, .admin-detail, dialog'),
          )
      )
        return;
      setSelectedId(null);
    };
    document.addEventListener('click', deselect);
    return () => document.removeEventListener('click', deselect);
  }, []);
  const [sort, setSort] = useState<{
    key: 'name' | 'number' | 'tag' | 'status';
    direction: 'ascending' | 'descending';
  }>();
  const [section, setSection] = useState('items');
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function load(quiet = false) {
    const version = ++requestVersion.current;
    if (!quiet) {
      setLoading(true);
      setError(undefined);
    }
    try {
      const result = await api.catalog();
      if (version !== requestVersion.current) return;
      setCatalog(result);
      setError(undefined);
      setSyncError(undefined);
    } catch (e) {
      if (version !== requestVersion.current) return;
      if (quiet) setSyncError(e);
      else setError(e);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => {
      void load(true);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === DB_KEY || event.key === null) refresh();
    };
    window.addEventListener('tagback-change', refresh);
    window.addEventListener('storage', storage);
    window.addEventListener('focus', refresh);
    return () => {
      requestVersion.current++;
      window.removeEventListener('tagback-change', refresh);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const items = (catalog?.items || []).filter(
    (i) =>
      (!status || i.status === status) &&
      (section !== 'maintenance' || ['inspection', 'repair'].includes(i.status)) &&
      (!kind || catalog?.kinds.find((k) => k.id === i.kindId)?.category === kind) &&
      `${i.label} ${i.tag} ${catalog?.kinds.find((k) => k.id === i.kindId)?.name}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const priority = ['calc-1', 'calc-2', 'calc-6', 'calc-7', 'umbrella-1', 'battery-1', 'cable-1'];
  items.sort((a, b) => {
    const rank = (id: string) => (priority.includes(id) ? priority.indexOf(id) : priority.length);
    return rank(a.id) - rank(b.id);
  });
  if (sort) {
    const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
    const field = (item: Item) =>
      sort.key === 'name'
        ? itemName(item)
        : sort.key === 'number'
          ? itemNumber(item)
          : sort.key === 'status'
            ? labels[item.status]
            : item.tag;
    items.sort(
      (a, b) => collator.compare(field(a), field(b)) * (sort.direction === 'ascending' ? 1 : -1),
    );
  }
  const visibleItems = items;
  const selected =
    selectedId === null
      ? undefined
      : items.find((i) => i.id === selectedId) || (selectedId === undefined ? items[0] : undefined);
  const selectedKind = catalog?.kinds.find((k) => k.id === selected?.kindId);
  const station = catalog?.stations.find((s) => s.id === selected?.stationId);
  return (
    <div className="admin-shell has-detail">
      <aside className="admin-sidebar">
        <Brand />
        <span className="admin-workspace">관리자</span>
        <nav aria-label="관리자 메뉴">
          <button
            className={section === 'items' ? 'active' : ''}
            onClick={() => {
              setSection('items');
              setStatus('');
            }}
          >
            <Box size={20} />
            물품 관리
          </button>
          <button
            className={section === 'rentals' ? 'active' : ''}
            onClick={() => {
              setSection('rentals');
              setStatus('rented');
            }}
          >
            <CalendarDays size={23} />
            대여 현황
          </button>
          <button
            className={section === 'maintenance' ? 'active' : ''}
            onClick={() => {
              setSection('maintenance');
              setStatus('');
            }}
          >
            <Wrench size={23} />
            점검·수리
          </button>
          <hr />
          <button onClick={() => setSettingsOpen(true)}>
            <Settings size={23} />
            설정
          </button>
        </nav>
        <div className="admin-profile">
          <span>홍</span>
          <div>
            <strong>홍길동</strong>
            <small>관리자</small>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <span>운영 관리 / 물품 관리</span>
          <span>
            <MapPin size={15} />
            {catalog?.stations[0]?.name || '대여소'}
            <ChevronDown size={16} />
          </span>
        </header>
        <div className="admin-title">
          <div>
            <h1>
              {section === 'rentals'
                ? '대여 현황'
                : section === 'maintenance'
                  ? '점검·수리'
                  : '물품 관리'}
            </h1>
            <p>대여소의 물품과 상태를 관리하세요.</p>
          </div>
          <button
            className="primary"
            disabled={!catalog || loading}
            onClick={() => {
              setEditing(null);
            }}
          >
            <Plus size={18} />
            물품 등록
          </button>
        </div>
        <section className="admin-stats" aria-label="물품 현황">
          {[['', '전체 물품'], ...Object.entries(labels)].map(([value, label]) => (
            <button
              key={value}
              className={status === value ? 'selected' : ''}
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
            >
              <span>{label}</span>
              <strong>
                {catalog ? catalog.items.filter((i) => !value || i.status === value).length : '—'}
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
                placeholder="물품명 또는 태그 ID 검색"
                value={query}
                onChange={(e) => {
                  setSelectedId(null);
                  setQuery(e.target.value);
                }}
              />
            </label>
            <CategorySelect
              filter
              value={kind}
              options={catalog?.categories || [...new Set(catalog?.kinds.map((k) => k.category))]}
              onChange={(value) => {
                setSelectedId(null);
                setKind(value);
              }}
              onAdded={(name) =>
                setCatalog(
                  (c) =>
                    c && {
                      ...c,
                      categories: [
                        ...new Set([...(c.categories || c.kinds.map((k) => k.category)), name]),
                      ],
                    },
                )
              }
            />
            <select
              aria-label="물품 상태 필터"
              value={status}
              onChange={(e) => {
                setSelectedId(null);
                setStatus(e.target.value);
              }}
            >
              <option value="">전체 상태</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="admin-refresh"
              aria-label="새로고침"
              title="새로고침"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <ErrorBox error={syncError} retry={() => void load(true)} />
          <ErrorBox error={error} retry={() => void load()} />
          {loading ? (
            <Loading />
          ) : (
            !error && (
              <>
                <div className="admin-list-heading">
                  물품 목록 <span>{items.length}</span>
                </div>
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        {(
                          [
                            { key: 'name', label: '물품명' },
                            { key: 'number', label: '관리번호' },
                            { key: 'tag', label: '태그 ID' },
                            { key: 'status', label: '상태' },
                          ] as const
                        ).map((column) => (
                          <th
                            key={column.key}
                            aria-sort={sort?.key === column.key ? sort.direction : 'none'}
                          >
                            <button
                              className="admin-sort"
                              onClick={() => {
                                setSort((current) =>
                                  current?.key !== column.key
                                    ? { key: column.key, direction: 'ascending' }
                                    : current.direction === 'ascending'
                                      ? { key: column.key, direction: 'descending' }
                                      : undefined,
                                );
                              }}
                            >
                              <span className="admin-sort-label">{column.label}</span>
                              <span className="admin-sort-icon" aria-hidden="true">
                                {sort?.key === column.key
                                  ? sort.direction === 'ascending'
                                    ? '↑'
                                    : '↓'
                                  : '↕'}
                              </span>
                            </button>
                          </th>
                        ))}

                        <th aria-label="물품 작업"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((i) => (
                        <tr
                          key={i.id}
                          tabIndex={0}
                          aria-label={i.label + ' 선택'}
                          onClick={() => {
                            setSelectedId(i.id);
                            setMenu(undefined);
                          }}
                          onKeyDown={(e) => {
                            if (
                              e.target === e.currentTarget &&
                              (e.key === 'Enter' || e.key === ' ')
                            ) {
                              e.preventDefault();
                              setSelectedId(i.id);
                            }
                          }}
                          className={selected?.id === i.id ? 'is-selected' : ''}
                        >
                          <td>
                            <button
                              className="admin-item-cell"
                              aria-label={`${i.label} 상세 보기`}
                              aria-pressed={selected?.id === i.id}
                              onClick={() => setSelectedId(i.id)}
                            >
                              <span className="admin-thumbnail">
                                {i.image ? (
                                  <img
                                    className="admin-uploaded-image"
                                    src={i.image}
                                    alt={`${i.label} 이미지`}
                                  />
                                ) : (
                                  <AssetPhoto
                                    kind={
                                      catalog?.kinds.find((k) => k.id === i.kindId)?.art ||
                                      'calculator'
                                    }
                                  />
                                )}
                              </span>
                              <span>
                                <strong>{itemName(i)}</strong>
                                <small>
                                  {catalog?.kinds.find((k) => k.id === i.kindId)?.category}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td className="admin-number">{itemNumber(i) || '—'}</td>
                          <td>
                            <code>{i.tag || '태그 미등록'}</code>
                            {!!i.tag && !i.active && <small>태그 비활성</small>}
                          </td>
                          <td>
                            <span className={`admin-status ${i.status}`}>{labels[i.status]}</span>
                          </td>
                          <td>
                            <div className="admin-row-actions" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="admin-edit"
                                aria-label={i.label + ' 메뉴'}
                                aria-expanded={menu === i.id}
                                onClick={() => setMenu(menu === i.id ? undefined : i.id)}
                              >
                                ···
                              </button>
                              {menu === i.id && (
                                <div className="admin-action-menu">
                                  <button
                                    onClick={() => {
                                      setEditing(i);
                                      setMenu(undefined);
                                    }}
                                  >
                                    수정
                                  </button>
                                  <button
                                    className="danger"
                                    onClick={() => {
                                      setDeleting(i);
                                      setMenu(undefined);
                                    }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!!items.length && (
                  <footer className="admin-pagination">
                    <span>총 {items.length}개 물품</span>
                  </footer>
                )}
                {!items.length && (
                  <div className="admin-empty">
                    <Box size={34} />
                    <h2>조건에 맞는 물품이 없어요</h2>
                    <p>검색어나 필터를 변경해 보세요.</p>
                  </div>
                )}
              </>
            )
          )}
        </section>
      </main>
      <aside className="admin-detail" aria-label="물품 상세">
        <header>
          <h2>물품 상세</h2>
        </header>
        {selected ? (
          <>
            <div className="admin-detail-art">
              {selected.image ? (
                <img
                  className="admin-uploaded-image"
                  src={selected.image}
                  alt={`${selected.label} 이미지`}
                />
              ) : (
                <AssetPhoto kind={selectedKind?.art || 'calculator'} large />
              )}
            </div>
            <span className={`admin-status ${selected.status}`}>{labels[selected.status]}</span>
            <h3>{itemName(selected)}</h3>
            <p>{selectedKind?.category}</p>
            <dl>
              <div>
                <dt>관리번호</dt>
                <dd>{itemNumber(selected) || '—'}</dd>
              </div>
              <div>
                <dt>태그 ID</dt>
                <dd>{selected.tag || '태그 미등록'}</dd>
              </div>
              <div>
                <dt>대여소</dt>
                <dd>{station?.name}</dd>
              </div>
              <div>
                <dt>위치</dt>
                <dd>{station?.location}</dd>
              </div>
              {!!selected.tag && !selected.active && (
                <div>
                  <dt>태그 상태</dt>
                  <dd>비활성</dd>
                </div>
              )}
            </dl>
            <button className="primary" onClick={() => setEditing(selected)}>
              {selected.tag ? '물품 수정' : 'NFC 태그 연결 / 물품 수정'}
            </button>
            <button
              className="secondary"
              disabled={selected.status === 'rented'}
              onClick={() => setEditing(selected)}
            >
              상태 변경
            </button>
            {selected.status === 'rented' && (
              <p className="admin-help">상태 변경은 반납 후 가능합니다.</p>
            )}
          </>
        ) : (
          <div className="admin-detail-empty">
            <Box size={48} strokeWidth={1.3} />
            <p>물품을 선택해 주세요</p>
          </div>
        )}
      </aside>
      {deleting && (
        <DeleteItem
          item={deleting}
          close={() => setDeleting(undefined)}
          removed={() => {
            setDeleting(undefined);
            setSelectedId(undefined);
            void load(true);
          }}
        />
      )}
      {editing !== undefined && catalog && (
        <ItemEditor
          categoryRemoved={(name) =>
            setCatalog(
              (c) => c && { ...c, categories: (c.categories || []).filter((n) => n !== name) },
            )
          }
          original={editing}
          catalog={catalog}
          categoryAdded={(name) =>
            setCatalog(
              (c) =>
                c && {
                  ...c,
                  categories: [
                    ...new Set([...(c.categories || c.kinds.map((k) => k.category)), name]),
                  ],
                },
            )
          }
          close={() => setEditing(undefined)}
          saved={(item) => {
            setCatalog(
              (c) =>
                c && {
                  ...c,
                  items: c.items.some((i) => i.id === item.id)
                    ? c.items.map((i) => (i.id === item.id ? item : i))
                    : [...c.items, item],
                },
            );
            setSelectedId(item.id);
            if (!editing) {
              setQuery(item.label);
              setKind('');
              setStatus('');
            }
            setEditing(undefined);
            void load(true);
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          station={catalog?.stations[0]?.name || ''}
          close={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function SettingsPanel({ station, close }: { station: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="admin-dialog" aria-label="설정" onCancel={close}>
      <div className="admin-dialog-heading">
        <h2>설정</h2>
        <button aria-label="설정 닫기" onClick={close}>
          <X />
        </button>
      </div>
      <p className="admin-form-description">현재 대여소: {station}</p>
      <p className="admin-help">관리자 인증과 대여소 설정 변경은 서버 연결 후 제공됩니다.</p>
      <Link className="secondary" to="/mobile">
        사용자 화면 보기
      </Link>
    </dialog>
  );
}

function ItemEditor({
  original,
  catalog,
  close,
  saved,
  categoryAdded,
  categoryRemoved,
}: {
  original: Item | null;
  catalog: Catalog;
  close: () => void;
  saved: (item: Item) => void;
  categoryAdded: (name: string) => void;
  categoryRemoved: (name: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [registration] = useState(() => new ItemRegistration(adminApi, crypto.randomUUID()));
  const [, refreshRegistration] = useState(0);
  const submitting = useRef(false);
  const pending = registration.item;
  const checking = !!registration.checking;
  const [draft, setDraft] = useState<ItemDraft>(
    original
      ? {
          ...original,
          status: !original.tag && original.status === 'available' ? 'inspection' : original.status,
          label: itemName(original),
          inventoryNumber: itemNumber(original),
          category: catalog.kinds.find((k) => k.id === original.kindId)?.category,
        }
      : {
          category: '',
          label: '',
          inventoryNumber: '',
          kindId: '',
          stationId: catalog.stations[0]?.id || '',
          tag: '',
          status: 'inspection',
        },
  );
  const [busy, setBusy] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (original?.tag || busy || imageLoading || checking) return;
    return nfc.subscribe((value) => {
      try {
        const tag = normalizeUid(value);
        setDraft((v) => ({ ...v, tag }));
        setError(undefined);
      } catch (e) {
        setError(e);
      }
    });
  }, [original, busy, imageLoading, checking]);
  const update = (patch: Partial<ItemDraft>) => {
    setDraft((v) => ({ ...v, ...patch }));
    setError(undefined);
  };
  async function acceptImage(file?: File) {
    if (!file || busy || imageLoading || pending || checking) return;
    setImageError(undefined);
    setImageLoading(true);
    try {
      update({ image: await readItemImage(file) });
    } catch (e) {
      setImageError(e);
    } finally {
      setImageLoading(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="admin-dialog admin-item-dialog"
      aria-labelledby="editor-title"
      onCancel={(e) => {
        // File inputs emit a bubbling cancel event when their picker is dismissed.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (!busy && !imageLoading) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current || imageLoading) return;
          submitting.current = true;
          setBusy(true);
          setError(undefined);
          try {
            const item = await registration.submit(draft, original || undefined, () =>
              refreshRegistration((v) => v + 1),
            );
            if (item) saved(item);
          } catch (err) {
            setError(err);
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="admin-dialog-heading">
          <div>
            <p className="admin-eyebrow">{original ? 'EDIT ITEM' : 'NEW ITEM'}</p>
            <h2 id="editor-title">{original ? '물품 수정' : '물품 등록'}</h2>
          </div>
          <button type="button" aria-label="닫기" disabled={busy || imageLoading} onClick={close}>
            <X />
          </button>
        </div>
        <p className="admin-form-description">개별 물품 한 개를 기준으로 정보를 입력해 주세요.</p>
        <fieldset
          className="admin-editor-grid"
          disabled={busy || imageLoading || !!pending || checking}
        >
          <div className="admin-image-field">
            <span>물품 이미지</span>
            <button
              type="button"
              className={'admin-upload-card ' + (dragging ? 'dragging' : '')}
              aria-label="물품 이미지 선택"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void acceptImage(e.dataTransfer.files[0]);
              }}
            >
              {!draft.image && <AssetPhoto large />}
              {draft.image && (
                <img
                  className="admin-image-preview"
                  src={draft.image}
                  alt="선택한 물품 이미지 미리보기"
                />
              )}
              <span className="admin-upload-hint">
                <Upload size={20} />
                {draft.image ? '눌러서 이미지 변경' : '이미지를 끌어 놓거나 눌러서 추가'}
              </span>
            </button>
            <input
              ref={fileInput}
              hidden
              id="item-image"

              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void acceptImage(file);
              }}
            />
            {draft.image && (
              <button
                type="button"
                className="admin-image-remove"
                onClick={() => {
                  update({ image: '', removeDefaultImage: true });
                  setImageError(undefined);
                }}
              >
                <Trash2 size={16} /> 이미지 삭제
              </button>
            )}
            {imageLoading && <p role="status">이미지 처리 중…</p>}
            <ErrorBox error={imageError} />
          </div>
          <div className="admin-field">
            <span>카테고리</span>
            <CategorySelect
              value={draft.category || ''}
              options={catalog.categories || [...new Set(catalog.kinds.map((k) => k.category))]}
              disabled={
                original?.status === 'rented' || busy || imageLoading || !!pending || checking
              }
              onAdded={categoryAdded}
              onRemoved={categoryRemoved}
              onChange={(category) => update({ category, kindId: '' })}
            />
          </div>
          <label>
            물품명
            <input
              required
              maxLength={60}
              value={draft.label}
              placeholder="물품명을 입력해 주세요"
              onChange={(e) => update({ label: e.target.value })}
            />
          </label>
          <label>
            관리번호
            <input
              required
              maxLength={20}
              value={draft.inventoryNumber || ''}
              placeholder="예: 009"
              onChange={(e) => update({ inventoryNumber: e.target.value })}
            />
          </label>
          <label>
            대여소
            <select
              disabled={!!original}
              aria-label="대여소"
              value={draft.stationId}
              onChange={(e) => update({ stationId: e.target.value })}
            >
              {catalog.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="admin-status-options" disabled={original?.status === 'rented'}>
            <legend>물품 상태</legend>
            <div>
              {Object.entries(labels)
                .filter(([key]) => key !== 'rented' || original?.status === 'rented')
                .map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="radio"
                      name="item-status"
                      value={key}
                      disabled={key === 'available' && !original?.tag}
                      checked={draft.status === key}
                      onChange={() => update({ status: key as ItemStatus })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
            </div>
          </fieldset>
          {!original?.tag && (
            <p className="admin-help">태그 연결 후 대여 가능으로 변경할 수 있습니다.</p>
          )}
          {original?.status === 'rented' && (
            <p className="admin-help">
              대여 중인 물품은 반납 후 카테고리와 상태를 변경할 수 있습니다.
            </p>
          )}
          {!!original?.tag && !original.active && (
            <p className="admin-help">
              태그가 비활성 상태입니다. 대여 가능으로 변경해도 태그는 활성화되지 않습니다.
            </p>
          )}
        </fieldset>
        {pending && !original?.tag && !pending.tag && (
          <p className="admin-help" role="status">
            물품 정보는 저장되었지만 태그 연결은 완료되지 않았습니다. 다시 시도하면 태그만
            연결합니다.
          </p>
        )}
        <fieldset disabled={busy || imageLoading || checking} className="admin-tag-field">
          <label>
            태그 ID
            <input readOnly value={draft.tag} placeholder="NFC 태그를 리더기에 접촉해 주세요" />
          </label>
          {!original?.tag && (
            <p className="admin-help">
              {draft.tag
                ? '다른 태그를 접촉하면 입력된 UID가 변경됩니다.'
                : '태그 없이 등록한 뒤 나중에 연결할 수 있습니다.'}
            </p>
          )}
        </fieldset>
        <ErrorBox error={error} />
        <footer>
          <button
            className="secondary"
            type="button"
            disabled={busy || imageLoading}
            onClick={close}
          >
            취소
          </button>
          <button className="primary" disabled={busy || imageLoading} type="submit">
            {busy
              ? '처리 중…'
              : checking
                ? '결과 확인'
                : pending && !original?.tag
                  ? '태그 연결 재시도'
                  : original
                    ? original.tag || !draft.tag
                      ? '변경사항 저장'
                      : '태그 연결'
                    : '등록하기'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function DeleteItem({
  item,
  close,
  removed,
}: {
  item: Item;
  close: () => void;
  removed: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="admin-dialog"
      ref={ref}
      aria-label="물품 삭제"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <h2>물품을 삭제할까요?</h2>
      <p>{item.label}</p>
      <p className="admin-help">목록에서 제외하며 기존 이용 이력은 보관합니다.</p>
      <ErrorBox error={error} />
      <div className="admin-confirm-actions">
        <button disabled={busy} onClick={close}>
          취소
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await adminApi.remove(item);
              removed();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '삭제 중…' : '삭제'}
        </button>
      </div>
    </dialog>
  );
}
