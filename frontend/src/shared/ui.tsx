import { ArrowUpRight, Box, Check, CircleAlert, LoaderCircle, Radio } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ServiceError } from './api';
export const date = (n: number) =>
  new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(n);
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <ArrowUpRight size={24} />
      </span>
      TagBack<span className="brand-dot">.</span>
    </span>
  );
}
export function MessagePopup({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="message-popup"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="message-popup-content">{children}</div>
      <button autoFocus className="primary full" onClick={onClose}>
        확인
      </button>
    </dialog>
  );
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const [dismissed, setDismissed] = useState<unknown>();
  if (!error || dismissed === error) return null;
  return (
    <MessagePopup title="확인해 주세요" onClose={() => setDismissed(error)}>
      <div role="alert">
        <CircleAlert size={22} />
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
      {retry && (
        <button
          className="secondary full"
          onClick={() => {
            setDismissed(error);
            retry();
          }}
        >
          다시 시도
        </button>
      )}
    </MessagePopup>
  );
}
export function Loading({ text = '불러오는 중이에요' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={25} />
      {text}
    </div>
  );
}
export function Badge({ children, tone = 'green' }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      {tone === 'green' && <Check size={12} />} {children}
    </span>
  );
}
export function ReaderArt() {
  return (
    <div className="reader-art">
      <div className="reader-rings" />
      <div className="reader-tag">
        <Radio size={58} />
        <span>TagBack</span>
      </div>
      <div className="reader-base">
        <Radio size={38} />
        <i />
      </div>
    </div>
  );
}
export function ProductArt({ kind, large = false }: { kind: string; large?: boolean }) {
  return (
    <div className={`product-art ${kind} ${large ? 'large' : ''}`} aria-hidden="true">
      {kind === 'generic' ? (
        <Box size={64} strokeWidth={1.25} />
      ) : kind === 'calculator' ? (
        <div className="calc-body">
          <span className="calc-brand">SCIENTIFIC</span>
          <div className="calc-screen">1.23456789</div>
          <div className="calc-solar" />
          <div className="calc-keys">
            {Array.from({ length: 30 }, (_, i) => (
              <i key={i} className={i > 25 ? 'mint' : ''} />
            ))}
          </div>
          <span className="asset-label">TAGBACK · 001</span>
        </div>
      ) : kind === 'umbrella' ? (
        <div className="umbrella-body">
          <div className="umbrella-canopy" />
          <div className="umbrella-stick" />
        </div>
      ) : kind === 'battery' ? (
        <div className="battery-body">
          <span>••••</span>
          <b>10 000</b>
          <small>POWER BANK</small>
          <i />
        </div>
      ) : (
        <div className="cable-body">
          <div />
          <i />
          <b />
        </div>
      )}
    </div>
  );
}
export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = [], live = false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const request = useRef<{ key: string; promise: Promise<T> } | undefined>(undefined);
  useEffect(() => {
    const seq = ++generation.current;
    setLoading(true);
    setError(undefined);
    setData(undefined);
    // Reuse the same request during StrictMode's effect replay; only explicit refresh/dependency changes refetch.
    const key = JSON.stringify([...deps, version]);
    if (!request.current || request.current.key !== key) {
      request.current = { key, promise: Promise.resolve().then(loader) };
    }
    request.current.promise
      .then((d) => {
        if (seq === generation.current) setData(d);
      })
      .catch((e) => {
        if (seq === generation.current) setError(e);
      })
      .finally(() => {
        if (seq === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [...deps, version]); // eslint-disable-line
  useEffect(() => {
    if (!live) return;
    const refresh = () => setVersion((v) => v + 1);
    const storage = (e: StorageEvent) => {
      if (e.key === 'tagback.mock.v1') refresh();
    };
    window.addEventListener('storage', storage);
    window.addEventListener('tagback-change', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('tagback-change', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [live]);
  return {
    data,
    error,
    loading,
    reload: () => setVersion((v) => v + 1),
    authError: error instanceof ServiceError && error.code === 'AUTH',
  };
}
