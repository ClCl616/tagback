import { useEffect, useState } from 'react';
import { api, controls, expireCodes, resetDemo, setControls } from '../shared/api';
import { authApi, simulateOtherBrowser } from '../shared/auth';
import { AUTH_DEMO, REGISTRATION_KEY } from '../shared/authPolicy';
import { transaction, notify } from '../shared/api';
import { MOCK } from '../shared/config';
import { emitTag } from '../shared/nfc';
import { normalizeUid } from '../shared/nfcUid';
import { ErrorBox, useResource } from '../shared/ui';
import type { DemoControls, Fault } from '../shared/types';
import { MockItemTools } from './MockItemTools';
export default function Simulator() {
  const [state, setState] = useState(controls);
  useEffect(() => {
    const refresh = () => setState(controls());
    window.addEventListener('storage', refresh);
    window.addEventListener('tagback-controls', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('tagback-controls', refresh);
    };
  }, []);
  const [authBusy, setAuthBusy] = useState(false);
  async function authDemo(action: () => Promise<unknown>) {
    if (authBusy) return;
    setAuthBusy(true);
    setError(undefined);
    try {
      await action();
      setMessage('모의 인증 상태를 변경했습니다.');
    } catch (e) {
      setError(e);
    } finally {
      setAuthBusy(false);
    }
  }
  const [message, setMessage] = useState('');
  const [uid, setUid] = useState('04A23B1C5D6E80');
  const [nfcError, setNfcError] = useState<unknown>();
  const [sentUid, setSentUid] = useState('');
  const [error, setError] = useState<unknown>();
  const r = useResource(() => api.catalog(), [], true);
  function change(p: Parameters<typeof setControls>[0]) {
    setControls(p);
    setState(controls());
  }
  return (
    <main className="simulator">
      <h1>TagBack · 개발 시뮬레이터</h1>
      <p>
        같은 브라우저·같은 주소의 다른 탭에서 관리자 또는 키오스크 화면을 열어 주세요. 실제 리더기
        없이 NFC 인식을 테스트할 수 있습니다.
      </p>
      <div className="sim-links">
        <a href="/admin/items" target="_blank" rel="noreferrer">
          관리자 열기 ↗
        </a>
        <a href="/mobile" target="_blank" rel="noreferrer">
          모바일 열기 ↗
        </a>
        <a href="/kiosk" target="_blank" rel="noreferrer">
          키오스크 열기 ↗
        </a>
      </div>
      <section aria-labelledby="nfc-test-title">
        <h2 id="nfc-test-title">NFC 인식 테스트</h2>
        <p>관리자에서 물품 등록·수정 창을 열거나, 키오스크에서 NFC 인식 대기 단계로 이동하세요.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!state.reader) return;
            setNfcError(undefined);
            setSentUid('');
            try {
              const normalized = normalizeUid(uid);
              emitTag(normalized);
              setUid(normalized);
              setSentUid(normalized);
            } catch (error) {
              setNfcError(error);
            }
          }}
        >
          <label className="sim-uid-label">
            테스트 태그 UID
            <input
              value={uid}
              maxLength={100}
              spellCheck={false}
              autoComplete="off"
              placeholder="예: 04:A2:3B:1C:5D:6E:80"
              aria-describedby="nfc-uid-help"
              onChange={(e) => {
                setUid(e.target.value);
                setNfcError(undefined);
                setSentUid('');
              }}
            />
          </label>
          <p id="nfc-uid-help">16진수 8·14·20자리. 공백, 콜론, 하이픈은 자동으로 제거됩니다.</p>
          <div className="sim-tags">
            <button type="submit" disabled={!state.reader}>
              NFC 태그 인식시키기
            </button>
            <button
              type="button"
              onClick={() => {
                const bytes = crypto.getRandomValues(new Uint8Array(6));
                setUid(
                  '04' +
                    Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
                      .join('')
                      .toUpperCase(),
                );
                setNfcError(undefined);
                setSentUid('');
              }}
            >
              새 테스트 UID 만들기
            </button>
          </div>
          {!state.reader && <p>NFC 리더기 연결 설정을 켜 주세요.</p>}
          <ErrorBox error={nfcError} />
          {sentUid && (
            <p role="status">
              인식 이벤트 전송: <code>{sentUid}</code> · 연결 결과는 대상 화면에서 확인하세요.
            </p>
          )}
        </form>
        <p>
          새 UID로 신규 연결을, 이미 연결한 UID를 다시 보내 중복 태그 오류를 테스트할 수 있습니다.
        </p>
      </section>
      <MockItemTools count={r.data?.items.length} reload={r.reload} />
      <section>
        <h2>시연 계정</h2>
        <p>
          전화번호 <code>{MOCK.demoPhone}</code> / PIN <code>{AUTH_DEMO.pin}</code>
        </p>
        <p>
          모바일에서 로그인해 생성된 코드를 키오스크에 입력합니다. NFC 대기 화면에서 아래 태그를
          전송합니다.
        </p>
      </section>
      <section>
        <h2>회원가입 문자 인증 · mock</h2>
        <p>
          실제 문자를 발송하지 않습니다. 모바일에서 인증번호를 요청한 뒤 아래 시연 번호를
          입력하세요.
        </p>
        <p>
          시연 인증번호 <code>{AUTH_DEMO.smsCode}</code> · 5분 유효 · 재요청 대기 1분
        </p>
      </section>
      <section>
        <h2>인증 상태 시뮬레이터</h2>
        <p>실제 신원 확인이나 다른 기기 연결이 아닙니다. PIN 복구는 등록 번호의 문자 인증으로 진행합니다.</p>
        <button disabled={authBusy} onClick={() => authDemo(simulateOtherBrowser)}>
          다른 브라우저 로그인 시연 (기본 계정)
        </button>
        <button
          disabled={authBusy}
          onClick={() =>
            authDemo(async () => {
              await transaction((db) => {
                const reg = db.auth?.registrations[localStorage.getItem(REGISTRATION_KEY) || ''];
                if (reg) reg.expiresAt = 0;
              });
              notify();
            })
          }
        >
          현재 브라우저 등록 만료
        </button>
        <button
          disabled={authBusy}
          onClick={() =>
            authDemo(async () => {
              await transaction((db) => {
                db.auth?.sms.forEach((s) => {
                  s.expiresAt = 0;
                  s.proofExpiresAt = 0;
                });
              });
            })
          }
        >
          SMS·인증 결과 만료
        </button>
      </section>
      <section>
        <h2>NFC 태그 이벤트</h2>
        <div className="sim-tags">
          {r.data?.items
            .filter((i) => i.tag)
            .map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  emitTag(i.tag);
                  setMessage(`${i.tag} 태그 전송`);
                }}
              >
                {i.label}
                <small>
                  {i.tag} · {i.status} {!i.active ? '· 비활성' : ''}
                </small>
              </button>
            ))}
          <button
            onClick={() => {
              emitTag('UNKNOWN');
              setMessage('미등록 태그 전송');
            }}
          >
            미등록 태그
          </button>
        </div>
      </section>
      <section>
        <h2>연결 및 다음 요청 오류</h2>
        <label>
          <input
            type="checkbox"
            checked={state.reader}
            onChange={(e) => change({ reader: e.target.checked })}
          />
          NFC 리더기 연결
        </label>
        <label>
          <input
            type="checkbox"
            checked={state.service}
            onChange={(e) => change({ service: e.target.checked })}
          />
          서비스 연결
        </label>
        <label>
          오류 적용 대상
          <select
            value={state.nextTarget}
            onChange={(e) => change({ nextTarget: e.target.value as DemoControls['nextTarget'] })}
          >
            <option value="any">다음 요청 (모든 화면)</option>
            <option value="read">모바일/재고 조회</option>
            <option value="auth">로그인·회원가입·문자 인증</option>
            <option value="verify">키오스크 코드 검증</option>
            <option value="scan">키오스크 NFC 조회</option>
            <option value="save">키오스크 저장</option>
          </select>
        </label>
        <label>
          다음 요청 오류
          <select
            value={state.nextFault}
            onChange={(e) =>
              change({
                nextFault: e.target.value as Fault,
                ...(['save', 'unknown', 'conflict'].includes(e.target.value)
                  ? {
                      nextTarget:
                        state.nextTarget === 'auth' ? ('auth' as const) : ('save' as const),
                    }
                  : {}),
              })
            }
          >
            <option value="">없음</option>
            <option value="network">네트워크 오류</option>
            <option value="timeout">요청 시간 초과 (저장 전)</option>
            <option value="save">저장 실패 (다음 확정)</option>
            <option value="unknown">저장 후 응답 유실 (다음 확정)</option>
            <option value="conflict">재고 충돌 (다음 확정)</option>
          </select>
        </label>
        <label>
          키오스크 비활성 종료 시간
          <select
            value={state.sessionSeconds}
            onChange={(e) => change({ sessionSeconds: Number(e.target.value) })}
          >
            <option value="180">180초</option>
            <option value="15">15초 (시험)</option>
            <option value="3">3초 (시험)</option>
          </select>
        </label>
        <button
          onClick={async () => {
            await expireCodes();
            setMessage('발급 코드 만료 처리');
          }}
        >
          발급 코드 만료시키기
        </button>
      </section>
      <section>
        <h2>시연 데이터 초기화</h2>
        <p>
          이 브라우저의 모의 계정·대여·코드가 초기 상태로 돌아갑니다. 실제 서버에는 영향을 주지
          않습니다.
        </p>
        <button
          onClick={async () => {
            try {
              await resetDemo();
              change({
                service: true,
                reader: true,
                nextFault: '',
                nextTarget: 'any',
                sessionSeconds: MOCK.sessionSeconds,
              });
              setMessage('시연 데이터 초기화 완료');
              r.reload();
            } catch (e) {
              setError(e);
            }
          }}
        >
          시연 데이터 초기화
        </button>
      </section>
      <p role="status">{message}</p>
      <ErrorBox error={error || r.error} retry={r.reload} />
    </main>
  );
}
