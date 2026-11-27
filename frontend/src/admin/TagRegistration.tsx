import {Radio} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { kioskRequest } from '../kiosk-host/transport';
import { getKioskRuntime } from '../kiosk-host/runtime';
import { useKioskAdmin } from './KioskAdminContext';
import type { Item, NfcScanProof } from '../shared/types';
export function TagRegistration({ item, saved }: { item: Item; saved: () => void }) {
  const admin = useKioskAdmin();
  const [opened, setOpened] = useState(false),
    [proof, setProof] = useState<NfcScanProof>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{ operationId: string; proof: NfcScanProof }>();
  const [password, setPassword] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false);
  useEffect(() => {
    if (opened) dialog.current?.showModal();
    else dialog.current?.close();
  }, [opened]);
  useEffect(() => {
    if (!opened) return;
    return getKioskRuntime().reader.subscribe(
      (read) => {
        if (!lock.current && !pending && read.proof) setProof(read.proof);
      },
      { onStatus: (status) => setReady(status === 'connected') },
    );
  }, [opened, pending]);
  async function save(token = admin?.token) {
    if (!admin || lock.current || !proof) return;
    lock.current = true;
    setBusy(true);
    admin.lock(true);
    setError('');
    const write = pending || { operationId: crypto.randomUUID(), proof };
    setPending(write);
    try {
      const response = await kioskRequest({
        action: 'admin-tag',
        adminRef: token!,
        itemId: item.id,
        expectedUid: item.tag || null,
        ...write,
      });
      const result: any = await response.json();
      if (!response.ok) {
        if (!pending && response.status >= 400 && response.status < 500) {
          setPending(undefined);
          admin.lock(false);
        }
        throw Error(result?.error?.message || '연결 결과를 확인하지 못했습니다.');
      }
      if (
        result.itemId !== item.id ||
        result.uid !== write.proof.uid ||
        !['AVAILABLE', 'INSPECTION', 'REPAIR', 'NOT_APPLIED'].includes(result.status)
      )
        throw Error('연결 결과를 확인하지 못했습니다.');
      setPending(undefined);
      admin.lock(false);
      setOpened(false);
      saved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : '연결 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!admin)
    return (
      <div className="aw-notice">
        <button disabled>NFC 태그 등록</button>
        <p>키오스크에서 등록할 수 있어요.</p>
      </div>
    );
  return (
    <>
      <button
        disabled={item.status === 'rented'}
        onClick={() => {
          setProof(undefined);
          setError('');
          setOpened(true);
        }}
      >
        NFC 태그 {item.tag ? '교체' : '등록'}
      </button>
      <dialog
        ref={dialog}
        className="aw-dialog aw-tag-dialog"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy && !pending) setOpened(false);
        }}
      >
        <h2>{item.label} · 태그 등록</h2>
        <p>
          물품 #{item.id} · 현재 태그 {item.tag || '없음'}
        </p>
        <p>{ready ? '물품의 태그를 리더기에 대 주세요.' : '리더기 연결을 확인해 주세요.'}</p>
        <div className="aw-tag-scan"><Radio size={96}/><span>NFC 태그 인식</span></div>
        <p>새 태그: {proof?.uid || '인식 대기'}</p>
        {error && <p role="alert">{error}</p>}
        {pending && <p>결과가 확인될 때까지 다른 작업을 진행할 수 없습니다.</p>}
        {pending && error && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const token = await admin.reauthenticate(password);
                setPassword('');
                await save(token);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <label>
              관리자 재인증 비밀번호
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
                required
              />
            </label>
            <button disabled={busy}>재인증 후 결과 확인</button>
          </form>
        )}
        <button disabled={busy || !proof || (!pending && !ready)} onClick={() => void save()}>
          {pending ? '연결 결과 다시 확인' : '태그 연결 확정'}
        </button>
        <button disabled={busy || !!pending} onClick={() => setOpened(false)}>
          닫기
        </button>
      </dialog>
    </>
  );
}
