import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Home,
  MapPin,
  PackageCheck,
  Radio,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { kioskApi as api } from '../shared/kioskApi';
import { ServiceError } from '../shared/serviceError';
import { KIOSK } from '../shared/config';
import {
  probeServerConnection,
  subscribeServerConnection,
  type ServerConnection,
} from '../shared/kioskHttp';
import { type ReaderStatus } from '../shared/nfc';
import { Badge, Brand, date, ErrorBox, Loading, ProductArt, useResource } from '../shared/ui';
import { getKioskPlatform } from './platform';
import './kiosk-redesign.css';
import type { Catalog, Grant, Item, NfcScanProof, NfcRead, Receipt } from '../shared/types';
type Stage = 'start' | 'select' | 'code' | 'scan' | 'condition' | 'confirm' | 'done';
type Completion = {
  type: 'rent' | 'return';
  label: string;
  dueAt: number;
  condition?: 'normal' | 'damaged';
  recovered?: boolean;
};
export default function KioskApp() {
  const platform = useMemo(getKioskPlatform, []);
  const pendingWrite = useRef<(() => Promise<Receipt>) | undefined>(undefined);
  const [now, setNow] = useState(Date.now());
  const [stage, setStage] = useState<Stage>('start');
  const [mode, setMode] = useState<'rent' | 'return'>('rent');
  const [kindId, setKindId] = useState('');
  const [code, setCode] = useState('');
  const [grant, setGrant] = useState<Grant>();
  const [item, setItem] = useState<Item>();
  const [returnRentalId, setReturnRentalId] = useState('');
  const [scannedTagUid, setScannedTagUid] = useState('');
  const [returnScanTicketId, setReturnScanTicketId] = useState('');
  const [returnScanProof, setReturnScanProof] = useState<NfcScanProof>();
  const [condition, setCondition] = useState<'normal' | 'damaged'>();
  const [completion, setCompletion] = useState<Completion>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [banner, setBanner] = useState('');
  const [remaining, setRemaining] = useState<number>(KIOSK.sessionSeconds);
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>('connecting');
  const [serverStatus, setServerStatus] = useState<ServerConnection>('unknown');
  const [unknown, setUnknown] = useState(false);
  const locked = useRef(false);
  const epoch = useRef(0);
  const operation = useRef('');
  const lastActivity = useRef(Date.now());
  const doneAt = useRef(0);
  const scanSeen = useRef({ tag: '', at: 0 });
  const catalog = useResource(
    () =>
      !grant
        ? Promise.resolve({ kinds: [], items: [], stations: [] } as Catalog)
        : api.catalog(grant),
    [grant?.token],
    false,
  );
  const readerReady = readerStatus === 'connected';
  const serviceReady = serverStatus === 'connected';
  const readerDisconnected = readerStatus === 'disconnected';
  const deviceUnavailable = !readerReady || !serviceReady;
  const deviceError = useMemo(
    () =>
      deviceUnavailable
        ? new Error('현재 기기를 이용할 수 없습니다. 연결 복구 후 다시 시작해 주세요.')
        : undefined,
    [deviceUnavailable],
  );
  const readerError = useMemo(
    () =>
      readerDisconnected
        ? new Error('인식기 연결 복구 후 물품을 다시 접촉해 주세요. 이용을 취소할 수도 있습니다.')
        : undefined,
    [readerDisconnected],
  );
  useEffect(() => subscribeServerConnection(setServerStatus), []);
  useEffect(() => {
    void probeServerConnection();
    const timer = window.setInterval(() => {
      void probeServerConnection();
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);
  const reset = useCallback((message = '') => {
    if (pendingWrite.current) return;
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
    setReturnRentalId('');
    setScannedTagUid('');
    setReturnScanTicketId('');
    setReturnScanProof(undefined);
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
    const activity = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    const timer = setInterval(() => {
      setNow(Date.now());
      if (pendingWrite.current || stage === 'start') return;
      if (stage === 'done') {
        if (Date.now() - doneAt.current >= KIOSK.completionSeconds * 1000) reset();
        return;
      }
      const left = Math.max(
        0,
        KIOSK.sessionSeconds - Math.floor((Date.now() - lastActivity.current) / 1000),
      );
      setRemaining(left);
      if (left === 0) reset('이용 시간이 지나 처음 화면으로 돌아왔습니다. 다시 시작해 주세요.');
    }, 500);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, [stage, KIOSK.sessionSeconds, reset, unknown]);
  // Every async result belongs to an epoch. Cancel/timeout invalidates it before the next customer starts.
  async function run<T>(task: () => Promise<T>, success: (result: T) => void) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const seq = epoch.current;
    const writing = !!pendingWrite.current;
    try {
      const result = await task();
      if (seq === epoch.current) success(result);
    } catch (e) {
      if (seq === epoch.current) {
        setError(e);
        if (writing && e instanceof ServiceError && e.code === 'UNKNOWN') setUnknown(true);
        else if (
          writing &&
          (!unknown || (e instanceof ServiceError && e.code === 'RETURN_CODE_INVALID'))
        ) {
          pendingWrite.current = undefined;
          operation.current = '';
          setUnknown(false);
          if (e instanceof ServiceError && e.code === 'RETURN_CODE_INVALID') {
            setCode('');
            setStage('code');
          }
        }
      }
    } finally {
      if (seq === epoch.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  const onRead = useRef<(read: NfcRead) => void>(() => {});
  onRead.current = (read) => {
    const tag = read.uid;
    if (stage !== 'scan' || cancelOpen || locked.current || pendingWrite.current) return;
    if (mode === 'rent' && grant && Date.now() >= grant.expiresAt) return;
    if (scanSeen.current.tag === tag && Date.now() - scanSeen.current.at < 1000) return;
    scanSeen.current = { tag, at: Date.now() };
    lastActivity.current = Date.now();
    void run(
      () => api.scan(tag, mode, kindId, grant, read.proof),
      (result) => {
        setItem(result.item);
        setReturnRentalId(mode === 'return' ? result.rental?.id || '' : '');
        setScannedTagUid(tag);
        setReturnScanTicketId(mode === 'return' ? result.returnScanTicketId || '' : '');
        setReturnScanProof(mode === 'return' ? result.returnScanProof : undefined);
        setStage(mode === 'rent' ? 'confirm' : 'condition');
      },
    );
  };
  useEffect(
    () =>
      platform.reader.subscribe((read) => onRead.current(read), {
        onStatus: setReaderStatus,
        onRemoved: () => {
          scanSeen.current = { tag: '', at: 0 };
        },
      }),
    [platform],
  );
  const onBack = useRef(() => {});
  onBack.current = back;
  useEffect(() => platform.host?.subscribeBack?.(() => onBack.current()), [platform]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pendingWrite.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const resume = () => {
      setNow(Date.now());
      void probeServerConnection();
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('.kiosk-main h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }, [stage]);
  useEffect(() => {
    if (!cancelOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    cancelDialog.current?.showModal();
    cancelDialog.current?.querySelector('button')?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
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
    return () => {
      document.removeEventListener('keydown', trap);
      cancelDialog.current?.close();
      opener?.focus();
    };
  }, [cancelOpen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !cancelOpen &&
        stage !== 'start' &&
        stage !== 'done' &&
        !pendingWrite.current &&
        !busy
      ) {
        event.preventDefault();
        setCancelOpen(true);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [stage, busy, cancelOpen]);
  function start(next: 'rent' | 'return') {
    reset();
    setMode(next);
    setRemaining(KIOSK.sessionSeconds);
    setStage(next === 'rent' ? 'code' : 'scan');
  }
  function back() {
    if (busy || unknown || pendingWrite.current) return;
    setError(undefined);
    if (stage === 'code') {
      setCode('');
      if (mode === 'return') setStage('condition');
      else {
        setGrant(undefined);
        setStage('start');
      }
    } else if (stage === 'select') {
      setGrant(undefined);
      setStage('code');
    } else if (stage === 'scan') {
      setStage(mode === 'rent' ? 'select' : 'start');
    } else if (stage === 'condition') {
      setItem(undefined);
      setReturnRentalId('');
      setScannedTagUid('');
      setReturnScanTicketId('');
      setReturnScanProof(undefined);
      setCondition(undefined);
      setStage('scan');
    } else if (stage === 'confirm') {
      if (mode === 'return') {
        setCode('');
        setStage('code');
      } else {
        setItem(undefined);
        setStage('scan');
      }
    }
  }
  function finish(receipt: Receipt, recovered = false) {
    setCompletion({
      type: receipt.type,
      label: item ? item.label : receipt.item.label,
      dueAt: receipt.rental.dueAt,
      condition: receipt.rental.condition,
      recovered,
    });
    pendingWrite.current = undefined;
    setReturnRentalId('');
    setScannedTagUid('');
    setReturnScanTicketId('');
    setReturnScanProof(undefined);
    setGrant(undefined);
    setCode('');
    setKindId('');
    setItem(undefined);
    setCondition(undefined);
    setUnknown(false);
    operation.current = '';
    doneAt.current = Date.now();
    setStage('done');
  }
  function confirm() {
    if (!item || locked.current || pendingWrite.current) return;
    if (mode === 'rent' && (!grant || Date.now() >= grant.expiresAt)) return;
    if (mode === 'return' && (!condition || code.length !== KIOSK.codeLength)) return;
    const key = crypto.randomUUID();
    operation.current = key;
    // Freeze the exact credentials, proof, body and request key until the result is known.
    pendingWrite.current =
      mode === 'rent'
        ? () => api.rent(key, grant!, item.id, kindId)
        : () =>
            api.returnItem(
              key,
              item.id,
              returnRentalId,
              scannedTagUid,
              returnScanTicketId,
              returnScanProof,
              condition!,
              code,
            );
    void run(pendingWrite.current, finish);
  }
  function recover() {
    if (pendingWrite.current) void run(pendingWrite.current, (receipt) => finish(receipt, true));
  }
  const names =
    mode === 'rent'
      ? ['코드 입력', '물품 선택', 'NFC 인식', '최종 확인']
      : ['NFC 인식', '상태 확인', '반납 코드', '최종 확인'];
  const steps: Partial<Record<Stage, number>> =
    mode === 'return'
      ? { scan: 0, condition: 1, code: 2, confirm: 3 }
      : { code: 0, select: 1, scan: 2, confirm: 3 };
  const step = steps[stage];
  const kind = catalog.data?.kinds.find((k) => k.id === (item?.kindId || kindId));
  const errorCode = error instanceof ServiceError ? error.code : '';
  const returnNeedsRescan =
    mode === 'return' &&
    ['NFC_SCAN_REQUIRED', 'RENTAL_CHANGED', 'RENTAL_NOT_ACTIVE'].includes(errorCode);
  const needsRestart = ['AUTH', 'GRANT_EXPIRED', 'CODE_EXPIRED', 'CODE_USED', 'CONFLICT'].includes(
    errorCode,
  );
  const recoveryNeedsManualCheck =
    unknown &&
    ![
      'UNKNOWN',
      'NETWORK',
      'TIMEOUT',
      'SERVER_UNAVAILABLE',
      'RENTAL_VERIFICATION_LIMITED',
    ].includes(errorCode);
  const grantExpired = !!grant && now >= grant.expiresAt;
  const retryAt = error instanceof ServiceError ? error.retryAt : undefined;
  const rateLimited = !!retryAt && now < retryAt;
  return (
    <div
      className={`kiosk-shell kiosk-v2 ${platform.tablet ? 'kiosk-tablet' : 'kiosk-desktop'}`}
      data-platform={platform.tablet ? 'tablet' : 'desktop'}
    >
      <header className="kiosk-header">
        <Brand />
        <div className="kiosk-station">
          <MapPin size={20} />
          <div>
            <strong>대전대 융합과학관</strong>
            <span>융합과학관 2층 학생 라운지</span>
          </div>
        </div>
        <div className={`reader-health ${readerReady && serviceReady ? '' : 'offline'}`}>
          <i />
          <span>
            {readerReady
              ? '외장 리더기 연결됨'
              : readerStatus === 'connecting'
                ? '리더기 확인 중'
                : '리더기 연결 끊김'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {serviceReady
              ? '서버 연결됨'
              : serverStatus === 'unknown'
                ? '서버 확인 중'
                : '서버 연결 끊김'}
          </span>
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
            <InlineError error={deviceError} />
            <InlineError error={error} />
            {serverStatus === 'disconnected' && (
              <p className="notice" role="alert">
                서버에 연결할 수 없습니다. 잠시 후 코드 확인을 다시 시도해 주세요.
              </p>
            )}
            <div className="kiosk-actions">
              <button
                className="rent-action"
                onClick={() => start('rent')}
                disabled={!readerReady || !serviceReady}
              >
                <div className="action-symbol">
                  <ArrowRight size={45} />
                </div>
                <span className="action-english">BORROW</span>
                <h2>대여하기</h2>
                <p>사용자 웹의 이용 코드를 준비해 주세요.</p>
                <span className="action-footer">
                  {'코드 입력부터 시작해요'}
                  <ArrowRight />
                </span>
              </button>
              <button
                className="return-action"
                onClick={() => start('return')}
                disabled={!readerReady || !serviceReady}
              >
                <div className="action-symbol">
                  <RotateCcw size={42} />
                </div>
                <span className="action-english">RETURN</span>
                <h2>반납하기</h2>
                <p>반납할 물품을 준비해 주세요.</p>
                <span className="action-footer">
                  {'실물 태그를 인식해 반납해요'}
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
                : completion?.recovered
                  ? '이미 반납이 완료됐어요'
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
                반납 기록이 저장되었습니다. 물품은 대전대 융합과학관 2층 학생 라운지 내 안내된 반납
                장소에 놓아 주세요.
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
                  <p>대여할 물품 종류를 선택해 주세요. 대여 가능 여부는 실물 인식 후 확인합니다.</p>
                </div>
                {catalog.loading ? (
                  <Loading />
                ) : catalog.error ? (
                  <ErrorBox error={catalog.error} retry={catalog.reload} />
                ) : (
                  <div className="kiosk-product-grid">
                    {!catalog.data?.kinds.length && (
                      <p role="status">등록된 물품 종류가 없습니다. 관리자에게 문의해 주세요.</p>
                    )}
                    {catalog.data?.kinds.map((k) => {
                      return (
                        <button
                          key={k.id}
                          className="kiosk-product"
                          disabled={grantExpired}
                          onClick={() => {
                            setKindId(k.id);
                            setStage('scan');
                          }}
                        >
                          <ProductArt kind={k.art} />
                          <h2>{k.name}</h2>
                          <Badge tone={'green'}>{'NFC 인식 후 확인'}</Badge>
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
                    {mode === 'return' ? '반납 코드를 ' : '대여 코드를 '}
                    <br />
                    입력해 주세요.
                  </h1>
                  <p>
                    모바일 웹에 로그인한 뒤<br />
                    <strong>‘이용 코드’</strong>에서 확인할 수 있어요.
                  </p>
                  {mode === 'return' && <p>시간이 지나면 물품을 다시 인식해 주세요.</p>}
                  {mode === 'return' && (
                    <div className="selected-kind">
                      <ProductArt kind={kind?.art || 'generic'} />
                      <div>
                        <span>반납할 물품 · {condition === 'damaged' ? '손상' : '정상'}</span>
                        <strong>{item?.label}</strong>
                      </div>
                    </div>
                  )}

                  {mode === 'rent' && <p>코드를 확인한 뒤 물품 종류를 선택합니다.</p>}
                  <div className="note">
                    <ShieldCheck size={20} />
                    <p>코드는 본인만 사용해 주세요.</p>
                  </div>
                </div>
                <form
                  className="keypad-panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.length !== KIOSK.codeLength || unknown) return;
                    if (busy || rateLimited) return;
                    if (mode === 'return') setStage('confirm');
                    else
                      void run(
                        () => api.verifyCode(code),
                        (g) => {
                          setGrant(g);
                          setCode('');
                          setStage('select');
                        },
                      );
                  }}
                >
                  <label htmlFor="rental-code">
                    일회성 {mode === 'return' ? '반납' : '대여'} 코드
                  </label>
                  <input
                    id="rental-code"
                    className="kiosk-code-input"
                    inputMode={platform.tablet ? 'none' : 'numeric'}
                    autoComplete="off"
                    value={code}
                    maxLength={KIOSK.codeLength}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    disabled={busy || unknown}
                  />
                  <div className="keypad">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '지우기', '0', '확인'].map(
                      (key) => (
                        <button
                          type={key === '확인' ? 'submit' : 'button'}
                          key={key}
                          disabled={
                            busy ||
                            unknown ||
                            (key === '확인' && (code.length !== KIOSK.codeLength || rateLimited))
                          }
                          aria-label={key}
                          onClick={() =>
                            setCode((c) =>
                              key === '지우기'
                                ? c.slice(0, -1)
                                : key === '확인'
                                  ? c
                                  : (c + key).slice(0, KIOSK.codeLength),
                            )
                          }
                        >
                          {key}
                        </button>
                      ),
                    )}
                  </div>
                  <InlineError error={error} />
                  {rateLimited && <p role="status">잠시 후 코드를 다시 확인해 주세요.</p>}
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
                  <p>물품의 태그를 외장 리더기에 대 주세요.</p>
                </div>
                <div
                  className="kw-reader-illustration"
                  aria-label="물품에 부착된 NFC 태그를 외장 리더기에 접촉"
                >
                  <div className="kw-tagged-item">
                    <PackageCheck size={64} />
                    <span>물품의 NFC 태그</span>
                    <Radio size={28} />
                  </div>
                  <div className="kw-reader">
                    <Radio size={44} />
                    <strong>외장 NFC 리더기</strong>
                  </div>
                </div>
                <div className="scan-status" role="status">
                  {busy ? (
                    <Loading text="물품 정보를 확인하고 있습니다" />
                  ) : (
                    <>
                      <Radio size={23} />
                      {readerReady ? 'NFC 인식을 기다리고 있습니다' : '인식기 연결이 끊겼습니다'}
                    </>
                  )}
                </div>
                {mode === 'rent' && (
                  <p className="scan-selection">
                    선택한 물품 <strong>{kind?.name}</strong>
                  </p>
                )}
                <div className="scan-errors">
                  <InlineError error={error} />
                  <InlineError error={readerError} />
                </div>
                <p className="muted">
                  {mode === 'rent'
                    ? '인식만으로 대여되지 않습니다. 다음 화면에서 대여를 확정해 주세요.'
                    : '인식 후 물품 상태를 확인하고 반납을 확정해 주세요.'}
                </p>
                {mode === 'return' && errorCode === 'RENTAL_STATE_CONFLICT' && (
                  <button className="secondary" onClick={() => reset()}>
                    처음으로 돌아가기
                  </button>
                )}
                {!!error && errorCode !== 'RENTAL_STATE_CONFLICT' && (
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
                  <ProductArt kind={kind?.art || 'generic'} />
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
                  onClick={() => setStage('code')}
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
                    <ProductArt kind={kind?.art || 'generic'} large />
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
                          <dd>{'대여 완료 후 안내'}</dd>
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
                  <InlineError error={error} />
                  {recoveryNeedsManualCheck ? (
                    <p className="notice" role="alert">
                      처리 결과를 확인할 수 없습니다. 새 요청을 시작하지 말고 관리자에게 문의해
                      주세요.
                    </p>
                  ) : unknown ? (
                    <button
                      className="primary full"
                      disabled={busy || rateLimited || !serviceReady}
                      onClick={recover}
                    >
                      {busy
                        ? '처리 결과 확인 중…'
                        : mode === 'return'
                          ? '반납 결과 다시 확인'
                          : '처리 결과 다시 확인'}
                    </button>
                  ) : errorCode === 'RENTAL_STATE_CONFLICT' ? (
                    <button className="primary full" onClick={() => reset()}>
                      처음으로 돌아가기
                    </button>
                  ) : returnNeedsRescan || needsRestart || grantExpired ? (
                    <button className="primary full" onClick={() => start(mode)}>
                      {mode === 'rent' ? '코드 입력부터 다시 진행' : '물품 다시 인식하기'}
                    </button>
                  ) : (
                    <button
                      className="primary full"
                      disabled={busy || rateLimited || !serviceReady}
                      onClick={confirm}
                    >
                      {busy ? '저장 중입니다…' : mode === 'rent' ? '대여 확정' : '반납 확정'}
                      <Check size={23} />
                    </button>
                  )}
                  <p>
                    <ShieldCheck size={16} />
                    {unknown
                      ? recoveryNeedsManualCheck
                        ? '결과가 확인되기 전에는 이 물품으로 새 반출을 시도하지 마세요.'
                        : '결과 확인 전에는 다시 확정하지 마세요.'
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
            <button className="footer-back" onClick={back} disabled={busy || unknown}>
              <ArrowLeft size={21} />
              이전
            </button>
            <span>
              <Clock3 size={16} />
              {busy || unknown
                ? '처리 결과를 확인하고 있습니다. 잠시 기다려 주세요.'
                : remaining < 30
                  ? `${remaining}초 후 이용이 종료됩니다`
                  : '안전한 이용을 위해 일정 시간 후 자동 종료됩니다'}
            </span>
            <button
              className="footer-cancel"
              disabled={busy || unknown}
              onClick={() => setCancelOpen(true)}
            >
              <X size={19} />
              이용 취소
            </button>
          </>
        ) : (
          <>
            <span>TagBack · 함께 쓰고, 다시 연결하다.</span>
            {stage === 'start' && platform.host?.openOperatorPanel && (
              <button
                className="footer-cancel"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => platform.host!.openOperatorPanel!(),
                    () => {},
                  )
                }
              >
                관리자 운영
              </button>
            )}
          </>
        )}
      </footer>
      {!busy &&
        !unknown &&
        stage !== 'start' &&
        stage !== 'done' &&
        remaining <= KIOSK.warningSeconds && (
          <div className="kiosk-idle-warning" role="alert">
            <strong>이용 시간이 곧 종료됩니다.</strong>
            <button
              className="secondary"
              onClick={() => {
                lastActivity.current = Date.now();
                setRemaining(KIOSK.sessionSeconds);
              }}
            >
              계속 이용하기
            </button>
          </div>
        )}
      {grantExpired &&
        !unknown &&
        !busy &&
        stage !== 'start' &&
        stage !== 'done' &&
        stage !== 'confirm' && (
          <div className="kiosk-idle-warning" role="alert">
            인증 시간이 지났습니다.
            <button className="secondary" onClick={() => start('rent')}>
              코드 입력부터 다시 진행
            </button>
          </div>
        )}
      {cancelOpen && (
        <dialog
          ref={cancelDialog}
          className="modal kw-cancel"
          aria-labelledby="cancel-title"
          onCancel={() => setCancelOpen(false)}
        >
          <h2 id="cancel-title">이용을 종료할까요?</h2>
          <p>
            {busy || unknown
              ? '요청이 이미 저장되었을 수 있습니다. 새 코드로 다시 대여하지 말고 관리자에게 결과를 문의해 주세요.'
              : '입력한 코드와 선택한 정보가 초기화됩니다.'}
          </p>
          <button autoFocus className="primary full" onClick={() => setCancelOpen(false)}>
            계속 이용하기
          </button>
          <button
            className="secondary full"
            disabled={busy || unknown}
            onClick={() => reset('이용이 취소되었습니다. 입력 정보가 초기화되었습니다.')}
          >
            종료하고 처음으로
          </button>
        </dialog>
      )}
    </div>
  );
}

function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="kiosk-inline-error" role="alert">
      {error instanceof Error ? error.message : '처리하지 못했습니다. 다시 확인해 주세요.'}
    </p>
  );
}
