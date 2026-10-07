import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Delete,
  Home,
  MapPin,
  PackageCheck,
  Radio,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api, controls, ServiceError } from '../shared/api';
import { MOCK } from '../shared/config';
import { nfc } from '../shared/nfc';
import {
  Badge,
  Brand,
  date,
  ErrorBox,
  Loading,
  ProductArt,
  ReaderArt,
  useResource,
} from '../shared/ui';
import type { Grant, Item, Receipt } from '../shared/types';
type Stage = 'start' | 'select' | 'code' | 'scan' | 'condition' | 'confirm' | 'done';
type Completion = {
  type: 'rent' | 'return';
  label: string;
  dueAt: number;
  condition?: 'normal' | 'damaged';
};
export default function KioskApp() {
  const [stage, setStage] = useState<Stage>('start');
  const [mode, setMode] = useState<'rent' | 'return'>('rent');
  const [kindId, setKindId] = useState('');
  const [code, setCode] = useState('');
  const [grant, setGrant] = useState<Grant>();
  const [item, setItem] = useState<Item>();
  const [condition, setCondition] = useState<'normal' | 'damaged'>();
  const [completion, setCompletion] = useState<Completion>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [banner, setBanner] = useState('');
  const [remaining, setRemaining] = useState<number>(MOCK.sessionSeconds);
  const [health, setHealth] = useState(controls);
  const [unknown, setUnknown] = useState(false);
  const locked = useRef(false);
  const epoch = useRef(0);
  const operation = useRef('');
  const lastActivity = useRef(Date.now());
  const doneAt = useRef(0);
  const scanSeen = useRef({ tag: '', at: 0 });
  const catalog = useResource(() => api.catalog(), [], true);
  const reset = useCallback((message = '') => {
    epoch.current++;
    locked.current = false;
    operation.current = '';
    scanSeen.current = { tag: '', at: 0 };
    setStage('start');
    setMode('rent');
    setKindId('');
    setCode('');
    setGrant(undefined);
    setItem(undefined);
    setCondition(undefined);
    setCompletion(undefined);
    setError(undefined);
    setBusy(false);
    setUnknown(false);
    setCancelOpen(false);
    setBanner(message);
    lastActivity.current = Date.now();
  }, []);
  useEffect(() => {
    const refresh = () => setHealth(controls());
    window.addEventListener('storage', refresh);
    window.addEventListener('tagback-controls', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('tagback-controls', refresh);
    };
  }, []);
  useEffect(() => {
    const activity = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    const timer = setInterval(() => {
      if (stage === 'start') return;
      if (stage === 'done') {
        if (Date.now() - doneAt.current >= MOCK.completionSeconds * 1000) reset();
        return;
      }
      const left = Math.max(
        0,
        health.sessionSeconds - Math.floor((Date.now() - lastActivity.current) / 1000),
      );
      setRemaining(left);
      if (left === 0) reset('이용 시간이 지나 처음 화면으로 돌아왔습니다. 다시 시작해 주세요.');
    }, 500);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, [stage, health.sessionSeconds, reset]);
  // Every async result belongs to an epoch. Cancel/timeout invalidates it before the next customer starts.
  async function run<T>(task: () => Promise<T>, success: (result: T) => void) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const seq = epoch.current;
    try {
      const result = await task();
      if (seq === epoch.current) success(result);
    } catch (e) {
      if (seq === epoch.current) {
        setError(e);
        if (e instanceof ServiceError && e.code === 'UNKNOWN') setUnknown(true);
      }
    } finally {
      if (seq === epoch.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (stage !== 'scan' || cancelOpen) return;
    return nfc.subscribe((tag) => {
      if (locked.current || !controls().reader) return;
      if (scanSeen.current.tag === tag && Date.now() - scanSeen.current.at < 1000) return;
      scanSeen.current = { tag, at: Date.now() };
      lastActivity.current = Date.now();
      void run(
        () => api.scan(tag, mode, kindId),
        (result) => {
          setItem(result.item);
          setStage(mode === 'rent' ? 'confirm' : 'condition');
        },
      );
    });
  }, [stage, mode, kindId, cancelOpen]);
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('.kiosk-main h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }, [stage]);
  useEffect(() => {
    if (!cancelOpen) return;
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCancelOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button'));
      const first = buttons[0],
        last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [cancelOpen]);
  function start(next: 'rent' | 'return') {
    reset();
    setMode(next);
    setRemaining(health.sessionSeconds);
    setStage(next === 'rent' ? 'select' : 'scan');
  }
  function back() {
    if (busy || unknown) return;
    setError(undefined);
    if (stage === 'code') {
      setCode('');
      setGrant(undefined);
      setStage('select');
    } else if (stage === 'scan') {
      setCode('');
      setGrant(undefined);
      setStage(mode === 'rent' ? 'code' : 'start');
    } else if (stage === 'condition') {
      setItem(undefined);
      setCondition(undefined);
      setStage('scan');
    } else if (stage === 'confirm') {
      if (mode === 'return') setStage('condition');
      else {
        setItem(undefined);
        setStage('scan');
      }
    }
  }
  function finish(receipt: Receipt) {
    setCompletion({
      type: receipt.type,
      label: receipt.item.label,
      dueAt: receipt.rental.dueAt,
      condition: receipt.rental.condition,
    });
    setGrant(undefined);
    setCode('');
    setKindId('');
    setItem(undefined);
    setCondition(undefined);
    setUnknown(false);
    operation.current = '';
    doneAt.current = Date.now();
    setStage('done');
    catalog.reload();
  }
  function confirm() {
    if (!item) return;
    operation.current ||= crypto.randomUUID();
    void run(
      () =>
        mode === 'rent'
          ? api.rent(operation.current, grant!, item.id, kindId)
          : api.returnItem(operation.current, item.id, condition!),
      finish,
    );
  }
  function recover() {
    void run(
      () => api.operation(operation.current),
      (receipt) => {
        if (receipt) finish(receipt);
        else {
          setUnknown(false);
          setError(new Error('저장된 처리 결과가 없습니다. 같은 요청으로 다시 확정해 주세요.'));
        }
      },
    );
  }
  const names =
    mode === 'rent'
      ? ['물품 선택', '코드 입력', 'NFC 인식', '최종 확인']
      : ['NFC 인식', '상태 확인', '최종 확인'];
  const step =
    mode === 'rent'
      ? ({ select: 0, code: 1, scan: 2, confirm: 3 } as Partial<Record<Stage, number>>)[stage]
      : ({ scan: 0, condition: 1, confirm: 2 } as Partial<Record<Stage, number>>)[stage];
  const kind = catalog.data?.kinds.find((k) => k.id === (item?.kindId || kindId));
  const stationItems = catalog.data?.items.filter((i) => i.stationId === MOCK.stationId) || [];
  const errorCode = error instanceof ServiceError ? error.code : '';
  const needsRestart = ['AUTH', 'CODE_EXPIRED', 'CODE_USED', 'CONFLICT'].includes(errorCode);
  return (
    <div className="kiosk-shell">
      <header className="kiosk-header">
        <Brand />
        <div className="kiosk-station">
          <MapPin size={20} />
          <div>
            <strong>대전대 융합과학관</strong>
            <span>융합과학관 2층 학생 라운지</span>
          </div>
        </div>
        <div className={`reader-health ${health.reader && health.service ? '' : 'offline'}`}>
          <i />
          {!health.service
            ? '서비스 연결 끊김'
            : health.reader
              ? 'NFC 리더기 연결됨'
              : '리더기 연결 끊김'}
        </div>
      </header>
      <main className={`kiosk-main ${stage === 'start' ? 'welcome-main' : ''}`}>
        {stage === 'start' ? (
          <>
            <div className="welcome-heading">
              <div className="eyebrow">BORROW. USE. BRING IT BACK.</div>
              <h1>
                필요할 때 빌리고,
                <br />
                <em>다음 사람에게 이어 주세요.</em>
              </h1>
              <p>함께 쓰는 캠퍼스, TagBack에서 시작하세요.</p>
            </div>
            {banner && (
              <div className="notice" role="status">
                {banner}
              </div>
            )}
            {(!health.reader || !health.service) && (
              <ErrorBox
                error={
                  new Error('현재 기기를 이용할 수 없습니다. 연결 복구 후 다시 시작해 주세요.')
                }
              />
            )}
            <div className="kiosk-actions">
              <button
                className="rent-action"
                onClick={() => start('rent')}
                disabled={!health.reader || !health.service}
              >
                <div className="action-symbol">
                  <ArrowRight size={45} />
                </div>
                <span className="action-english">BORROW</span>
                <h2>대여하기</h2>
                <p>모바일 웹의 대여 코드를 준비해 주세요.</p>
                <span className="action-footer">
                  물품 선택부터 시작해요
                  <ArrowRight />
                </span>
              </button>
              <button
                className="return-action"
                onClick={() => start('return')}
                disabled={!health.reader || !health.service}
              >
                <div className="action-symbol">
                  <RotateCcw size={42} />
                </div>
                <span className="action-english">RETURN</span>
                <h2>반납하기</h2>
                <p>반납할 물품을 준비해 주세요.</p>
                <span className="action-footer">
                  로그인 없이 물품으로 확인해요
                  <ArrowRight />
                </span>
              </button>
            </div>
            <div className="welcome-tip">
              <ShieldCheck size={22} />
              <span>NFC 인식 후, 정보를 확인하고 직접 확정해 주세요.</span>
            </div>
          </>
        ) : stage === 'done' ? (
          <section className="completion">
            <div className="success-circle">
              <Check size={58} />
            </div>
            <div className="eyebrow">
              {completion?.type === 'rent' ? 'READY TO GO' : 'THANK YOU FOR SHARING'}
            </div>
            <h1>
              {completion?.type === 'rent'
                ? '대여가 완료되었습니다'
                : completion?.condition === 'damaged'
                  ? '반납 · 점검 접수가 완료되었습니다'
                  : '반납이 완료되었습니다'}
            </h1>
            <p>
              {completion?.type === 'rent'
                ? '잘 사용하고, 다음 사람을 위해 돌려주세요.'
                : '함께 쓰는 물품을 돌려주셔서 감사합니다.'}
            </p>
            <div className="completion-detail">
              <PackageCheck size={30} />
              <strong>{completion?.label}</strong>
              <span>
                {completion?.type === 'rent'
                  ? `반납 예정 · ${date(completion.dueAt)}`
                  : completion?.condition === 'damaged'
                    ? '물품 상태 · 점검 중'
                    : '물품 상태 · 대여 가능'}
              </span>
            </div>
            {completion?.type === 'return' && (
              <p className="collection-note">
                반납 기록이 저장되었습니다. 물품은 대여소의 지정된 장소에 놓아 주세요.
              </p>
            )}
            <button className="primary" onClick={() => reset()}>
              <Home size={21} />
              처음으로
            </button>
            <p className="auto-return">잠시 후 자동으로 처음 화면으로 돌아갑니다.</p>
          </section>
        ) : (
          <>
            <ol className="stepper">
              {names.map((name, i) => (
                <li
                  key={name}
                  className={i === step ? 'current' : i < (step || 0) ? 'finished' : ''}
                >
                  <span>
                    {i < (step || 0) ? <Check size={16} /> : String(i + 1).padStart(2, '0')}
                  </span>
                  {name}
                  {i < names.length - 1 && <ChevronRight size={17} />}
                </li>
              ))}
            </ol>
            {stage === 'select' && (
              <>
                <div className="kiosk-title">
                  <h1>어떤 물품이 필요하세요?</h1>
                  <p>대여할 물품 종류를 선택해 주세요.</p>
                </div>
                {catalog.loading ? (
                  <Loading />
                ) : catalog.error ? (
                  <ErrorBox error={catalog.error} retry={catalog.reload} />
                ) : (
                  <div className="kiosk-product-grid">
                    {catalog.data?.kinds.map((k) => {
                      const all = stationItems.filter((i) => i.kindId === k.id);
                      const count = all.filter((i) => i.active && i.status === 'available').length;
                      return (
                        <button
                          key={k.id}
                          className="kiosk-product"
                          disabled={!count}
                          onClick={() => {
                            setKindId(k.id);
                            setStage('code');
                          }}
                        >
                          <ProductArt kind={k.art} />
                          <h2>{k.name}</h2>
                          <Badge tone={count ? 'green' : 'gray'}>
                            {count ? `${count}개 대여 가능` : '대여 가능한 물품 없음'}
                          </Badge>
                          <p>전체 {all.length}개</p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {stage === 'code' && (
              <div className="code-stage">
                <div>
                  <div className="eyebrow">YOUR ONE-TIME CODE</div>
                  <h1>
                    대여 코드를
                    <br />
                    입력해 주세요.
                  </h1>
                  <p>
                    모바일 웹에 로그인한 뒤<br />
                    <strong>‘대여 코드’</strong>에서 확인할 수 있어요.
                  </p>
                  <div className="selected-kind">
                    <ProductArt kind={kind?.art || 'calculator'} />
                    <div>
                      <span>선택한 물품</span>
                      <strong>{kind?.name}</strong>
                    </div>
                  </div>
                  <div className="note">
                    <ShieldCheck size={20} />
                    <p>코드는 본인만 사용해 주세요.</p>
                  </div>
                </div>
                <form
                  className="keypad-panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.length === MOCK.codeLength)
                      void run(
                        () => api.verifyCode(code),
                        (g) => {
                          setGrant(g);
                          setCode('');
                          setStage('scan');
                        },
                      );
                  }}
                >
                  <label htmlFor="rental-code">일회성 대여 코드</label>
                  <input
                    id="rental-code"
                    className="kiosk-code-input"
                    inputMode="numeric"
                    autoComplete="off"
                    value={code}
                    maxLength={MOCK.codeLength}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    disabled={busy}
                  />
                  <div className="keypad">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '지우기', '0', 'back'].map(
                      (key) => (
                        <button
                          type="button"
                          key={key}
                          disabled={busy}
                          aria-label={key === 'back' ? '한 자리 지우기' : key}
                          onClick={() =>
                            setCode((c) =>
                              key === 'back'
                                ? c.slice(0, -1)
                                : key === '지우기'
                                  ? ''
                                  : (c + key).slice(0, MOCK.codeLength),
                            )
                          }
                        >
                          {key === 'back' ? <Delete size={23} /> : key}
                        </button>
                      ),
                    )}
                  </div>
                  <ErrorBox error={error} />
                  <button
                    className="primary full"
                    disabled={busy || code.length !== MOCK.codeLength}
                  >
                    {busy ? '코드 확인 중…' : '코드 확인'}
                    <ArrowRight size={22} />
                  </button>
                </form>
              </div>
            )}
            {stage === 'scan' && (
              <div className="scan-stage">
                <div className="kiosk-title">
                  <h1>
                    {mode === 'rent'
                      ? '물품의 NFC 태그를 인식해 주세요'
                      : '반납할 물품을 인식해 주세요'}
                  </h1>
                  <p>실물을 리더기에 가볍게 접촉한 뒤 잠시 기다려 주세요.</p>
                </div>
                <ReaderArt />
                <div className="scan-status" role="status">
                  {busy ? (
                    <Loading text="물품 정보를 확인하고 있습니다" />
                  ) : (
                    <>
                      <Radio size={23} />
                      {health.reader ? 'NFC 인식을 기다리고 있습니다' : '인식기 연결이 끊겼습니다'}
                    </>
                  )}
                </div>
                {mode === 'rent' && (
                  <p className="scan-selection">
                    선택한 물품 <strong>{kind?.name}</strong>
                  </p>
                )}
                <div className="scan-errors">
                  <ErrorBox error={error} />
                  {!health.reader && (
                    <ErrorBox
                      error={
                        new Error(
                          '인식기 연결 복구 후 물품을 다시 접촉해 주세요. 이용을 취소할 수도 있습니다.',
                        )
                      }
                    />
                  )}
                </div>
                <p className="muted">
                  {mode === 'rent'
                    ? '인식만으로 대여되지 않습니다. 다음 화면에서 대여를 확정해 주세요.'
                    : '인식 후 물품 상태를 확인하고 반납을 확정해 주세요.'}
                </p>
                {!!error && (
                  <button
                    className="secondary"
                    onClick={() => {
                      scanSeen.current = { tag: '', at: 0 };
                      setError(undefined);
                    }}
                  >
                    다시 인식하기
                  </button>
                )}
              </div>
            )}
            {stage === 'condition' && (
              <>
                <div className="kiosk-title">
                  <h1>물품 상태를 확인해 주세요</h1>
                  <p>사용하신 물품의 상태를 직접 확인하고 선택해 주세요.</p>
                </div>
                <div className="condition-item">
                  <ProductArt kind={kind?.art || 'calculator'} />
                  <div>
                    <h2>{kind?.name}</h2>
                    <p>{item?.label} · 대전대 융합과학관</p>
                  </div>
                </div>
                <div className="condition-options">
                  <button
                    className={condition === 'normal' ? 'selected' : ''}
                    onClick={() => setCondition('normal')}
                    aria-pressed={condition === 'normal'}
                  >
                    <CircleCheck size={34} />
                    <h2>정상이에요</h2>
                    <p>손상이 없고 잘 작동해요.</p>
                  </button>
                  <button
                    className={condition === 'damaged' ? 'selected damaged' : ''}
                    onClick={() => setCondition('damaged')}
                    aria-pressed={condition === 'damaged'}
                  >
                    <ShieldCheck size={34} />
                    <h2>손상이 있어요</h2>
                    <p>파손되었거나 작동에 문제가 있어요.</p>
                  </button>
                </div>
                <p className="condition-note">
                  {condition === 'damaged'
                    ? '손상된 물품은 점검 중으로 분리되어 다음 대여가 제한됩니다.'
                    : '선택한 상태는 반납 기록에 함께 저장됩니다.'}
                </p>
                <button
                  className="primary centered"
                  disabled={!condition}
                  onClick={() => setStage('confirm')}
                >
                  선택한 상태로 계속
                  <ArrowRight size={22} />
                </button>
              </>
            )}
            {stage === 'confirm' && (
              <>
                <div className="kiosk-title">
                  <h1>
                    {mode === 'rent' ? '대여 정보를 확인해 주세요' : '반납 정보를 확인해 주세요'}
                  </h1>
                  <p>
                    {mode === 'rent'
                      ? '아래 정보가 맞으면 대여를 확정해 주세요.'
                      : '물품과 선택한 상태를 확인한 뒤 반납을 확정해 주세요.'}
                  </p>
                </div>
                <div className="confirm-panel">
                  <div className="confirm-product">
                    <ProductArt kind={kind?.art || 'calculator'} large />
                    <h2>{kind?.name}</h2>
                    <span>{item?.label}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>대여소</dt>
                      <dd>대전대 융합과학관</dd>
                    </div>
                    <div>
                      <dt>개별 물품</dt>
                      <dd>{item?.label}</dd>
                    </div>
                    {mode === 'rent' ? (
                      <>
                        <div>
                          <dt>대여자</dt>
                          <dd>{grant?.maskedPhone}</dd>
                        </div>
                        <div className="due-row">
                          <dt>반납 예정</dt>
                          <dd>
                            {date(Date.now() + MOCK.rentalMs)}
                          </dd>
                        </div>
                      </>
                    ) : (
                      <div>
                        <dt>확인한 상태</dt>
                        <dd>
                          <Badge tone={condition === 'normal' ? 'green' : 'orange'}>
                            {condition === 'normal'
                              ? '정상 · 대여 가능으로 전환'
                              : '손상 · 점검 대상으로 접수'}
                          </Badge>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
                <div className="confirm-bottom">
                  <ErrorBox error={error} />
                  {unknown ? (
                    <button className="primary full" disabled={busy} onClick={recover}>
                      {busy ? '처리 결과 확인 중…' : '처리 결과 다시 확인'}
                    </button>
                  ) : needsRestart ? (
                    <button className="primary full" onClick={() => start(mode)}>
                      {mode === 'rent' ? '물품 선택부터 다시 진행' : '물품 다시 인식하기'}
                    </button>
                  ) : (
                    <button className="primary full" disabled={busy} onClick={confirm}>
                      {busy ? '저장 중입니다…' : mode === 'rent' ? '대여 확정' : '반납 확정'}
                      <Check size={23} />
                    </button>
                  )}
                  <p>
                    <ShieldCheck size={16} />
                    {unknown
                      ? '결과 확인 전에는 다시 확정하지 마세요.'
                      : '저장이 완료된 뒤 완료 화면이 표시됩니다.'}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </main>
      <footer className="kiosk-footer">
        {stage !== 'start' && stage !== 'done' ? (
          <>
            <button
              className="footer-back"
              onClick={back}
              disabled={busy || unknown || stage === 'select'}
            >
              <ArrowLeft size={21} />
              이전
            </button>
            <span>
              <Clock3 size={16} />
              {remaining < 30
                ? `${remaining}초 후 이용이 종료됩니다`
                : '안전한 이용을 위해 일정 시간 후 자동 종료됩니다'}
            </span>
            <button className="footer-cancel" onClick={() => setCancelOpen(true)}>
              <X size={19} />
              이용 취소
            </button>
          </>
        ) : (
          <>
            <span>TagBack · 함께 쓰고, 다시 연결하다.</span>
          </>
        )}
      </footer>
      {cancelOpen && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <h2 id="cancel-title">이용을 종료할까요?</h2>
            <p>
              {busy || unknown
                ? '진행 중인 요청은 이미 저장되었을 수 있습니다. 종료 후 모바일의 내 대여 현황에서 결과를 확인해 주세요.'
                : '입력한 코드와 선택한 정보가 초기화됩니다.'}
            </p>
            <button autoFocus className="primary full" onClick={() => setCancelOpen(false)}>
              계속 이용하기
            </button>
            <button
              className="secondary full"
              onClick={() => reset('이용이 취소되었습니다. 입력 정보가 초기화되었습니다.')}
            >
              종료하고 처음으로
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
