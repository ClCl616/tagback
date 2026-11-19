import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Catalog, Item, ItemStatus } from '../shared/types';
import { ServiceError } from '../shared/serviceError';
import { adminApi } from './adminApi';
import { Badge, Failure, itemLabels, useAdminError } from './AdminWeb';

function Dialog({
  title,
  children,
  close,
  busy,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-aw-autofocus]')?.focus();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        if (!dialog?.open && opener.current?.isConnected) opener.current.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="aw-dialog"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const controls = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], [tabindex="0"]',
          ) || [],
        ).filter((el) => !el.matches(':disabled') && el.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="닫기" disabled={busy} onClick={close}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function useOperation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const lock = useRef(false),
    alive = useRef(true),
    report = useAdminError();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      if (alive.current && !report(e)) setError(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return { busy, error, run, alive };
}
export function ItemEditor({ original, catalog, close, saved }: {
  original?: Item; catalog: Catalog; close: (changed?: boolean) => void; saved: (message?: string) => void;
}) {
  const [label, setLabel] = useState(original?.name || '');
  const [kindId, setKindId] = useState(original?.kindId || '');
  const [uncertain, setUncertain] = useState(false);
  const op = useOperation();
  return <Dialog title={original ? '물품 수정' : '물품 등록'} close={() => close(uncertain)} busy={op.busy}>
    <form onSubmit={e => { e.preventDefault(); if (uncertain) return; void op.run(async () => {
      try {
        await adminApi.save('', { label, kindId }, original);
        if (op.alive.current) saved(original ? '물품 정보를 수정했습니다. 태그 변경은 키오스크에서 진행하세요.' : '태그 등록 대기로 저장했습니다. 키오스크에서 태그를 연결하면 대여할 수 있습니다.');
      } catch(e) { if (op.alive.current && e instanceof ServiceError && e.code === 'UNKNOWN') setUncertain(true); throw e; }
    }); }}>
      <fieldset disabled={op.busy || uncertain}>
        <label>물품명<input aria-label="물품명" required maxLength={100} value={label} onChange={e => setLabel(e.target.value)} data-aw-autofocus /></label>
        <label>물품 종류<select aria-label="물품 종류" required value={kindId} onChange={e => setKindId(e.target.value)}>
          <option value="">선택해 주세요</option>{catalog.kinds.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select></label>
      </fieldset>
      {!catalog.kinds.length && <p className="aw-warning">등록된 물품 종류가 없어 저장할 수 없습니다.</p>}
      <p className="aw-help">{original ? '물품 정보만 수정합니다. 태그 등록·교체는 리더기가 연결된 키오스크의 관리자 모드에서 진행하세요.' : '태그 없이 등록하며 대여는 불가능합니다. 키오스크 관리자 모드에서 이 물품을 선택하고 태그를 연결해 주세요.'}</p>
      {uncertain && <p className="aw-warning">저장 결과를 확인하지 못했습니다. 중복 등록하지 말고 창을 닫아 목록을 확인해 주세요.</p>}
      <Failure error={op.error} />
      <footer><button type="button" disabled={op.busy} onClick={() => close(uncertain)}>닫기</button>
        <button className="aw-primary" disabled={op.busy || uncertain || !kindId || !label.trim()}>{op.busy ? '저장 중…' : original ? '변경사항 저장' : '등록하기'}</button></footer>
    </form>
  </Dialog>;
}
export function TagEditor({ item }: { item: Item; saved: (message?: string) => void }) {
  return <div className="aw-notice"><p>{item.tag ? '태그 교체' : '태그 등록'}는 키오스크에서 진행합니다.</p>
    <p>리더기가 연결된 키오스크 → 관리자 태그 등록 → 공통 비밀번호 로그인 → 물품 ID {item.id} 선택 → NFC 인식 → 연결 확정</p>
    <p>태그 등록 대기 물품은 연결 완료 후 대여 가능으로 전환됩니다. 점검·수리 상태는 유지됩니다.</p></div>;
}
export function StatusEditor({
  item,
  close,
  saved,
}: {
  item: Item;
  close: () => void;
  saved: (message?: string) => void;
}) {
  const [status, setStatus] = useState<ItemStatus>(item.status),
    [reason, setReason] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [verified, setVerified] = useState(false);
  const op = useOperation();
  return (
    <Dialog title="상태 변경" close={close} busy={op.busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (uncertain || verified) return;
          void op.run(async () => {
            try {
              await adminApi.changeStatus(item.id, status, reason);
              if (op.alive.current) saved();
            } catch (e) {
              if (op.alive.current && e instanceof ServiceError && e.code === 'UNKNOWN')
                setUncertain(true);
              throw e;
            }
          });
        }}
      >
        <p>{item.name}</p>
        <div className="aw-current-status">
          현재 상태 <Badge value={item.status} />
        </div>
        <fieldset disabled={op.busy || uncertain || verified}>
          <label>
            변경할 상태
            <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
              {['available', 'inspection', 'repair'].map((s) => (
                <option key={s} value={s}>
                  {itemLabels[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            변경 사유
            <textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <small className="aw-char-count">{reason.length} / 500</small>
        </fieldset>
        {uncertain && (
          <div className="aw-warning">
            <p>저장 결과를 확인하지 못했습니다. 현재 상태를 먼저 확인해 주세요.</p>
            <button
              type="button"
              disabled={op.busy}
              onClick={() =>
                void op.run(async () => {
                  const current = await adminApi.getItem(item.id);
                  if (!op.alive.current) return;
                  if (current.status === status) {
                    setVerified(true);
                    setUncertain(false);
                  } else
                    throw new ServiceError(
                      'CHANGED',
                      '현재 상태는 ' +
                        itemLabels[current.status] +
                        '입니다. 창을 닫고 최신 목록에서 다시 확인해 주세요.',
                    );
                })
              }
            >
              현재 상태 확인
            </button>
          </div>
        )}
        {verified && (
          <p className="aw-notice">
            현재 서버 상태가 선택한 상태와 같습니다. 변경 사유의 저장 여부는 이 조회만으로 확인할 수
            없습니다.
          </p>
        )}
        <Failure error={op.error} />
        <footer>
          <button
            type="button"
            disabled={op.busy}
            onClick={() =>
              verified || uncertain ? saved('현재 정보를 다시 조회합니다.') : close()
            }
          >
            {verified || uncertain ? '목록 다시 확인' : '취소'}
          </button>
          <button className="aw-primary" disabled={op.busy || uncertain || verified}>
            {op.busy ? '저장 중…' : '상태 저장'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function DeleteItem({
  item,
  close,
  saved,
}: {
  item: Item;
  close: () => void;
  saved: (message?: string) => void;
}) {
  const [uncertain, setUncertain] = useState(false);
  const op = useOperation();
  return (
    <Dialog title="물품 삭제" close={close} busy={op.busy}>
      <h3>{item.name}</h3>
      <p>물품 ID {item.id}을 삭제할까요?</p>
      <p className="aw-warning">태그 또는 이용·상태 변경 이력이 있는 물품은 삭제할 수 없습니다.</p>
      <p className="aw-help">삭제한 물품은 이 화면에서 되돌릴 수 없습니다.</p>
      {uncertain && (
        <div className="aw-warning">
          <p>삭제 결과가 불명확합니다. 다시 삭제하지 않고 현재 정보를 확인하세요.</p>
          <button
            disabled={op.busy}
            onClick={() =>
              void op.run(async () => {
                try {
                  await adminApi.getItem(item.id);
                } catch (e) {
                  if (
                    e instanceof ServiceError &&
                    ['NOT_FOUND', 'ITEM_NOT_FOUND'].includes(e.code)
                  ) {
                    if (op.alive.current) saved();
                    return;
                  }
                  throw e;
                }
                throw new ServiceError(
                  'CHANGED',
                  '현재 물품이 조회됩니다. 창을 닫고 최신 목록에서 제한 조건을 다시 확인해 주세요.',
                );
              })
            }
          >
            현재 정보 확인
          </button>
        </div>
      )}
      <Failure error={op.error} />
      <footer>
        <button
          data-aw-autofocus
          disabled={op.busy}
          onClick={() => (uncertain ? saved('현재 정보를 다시 조회합니다.') : close())}
        >
          {uncertain ? '목록 다시 확인' : '취소'}
        </button>
        <button
          className="aw-danger"
          disabled={op.busy || uncertain}
          onClick={() =>
            void op.run(async () => {
              try {
                await adminApi.remove(item);
                if (op.alive.current) saved();
              } catch (e) {
                if (op.alive.current && e instanceof ServiceError && e.code === 'UNKNOWN')
                  setUncertain(true);
                throw e;
              }
            })
          }
        >
          {op.busy ? '삭제 중…' : '삭제 확인'}
        </button>
      </footer>
    </Dialog>
  );
}
