import { useEffect, useState } from 'react';
import { api, controls, expireCodes, resetDemo, setControls } from '../shared/api';
import { authApi, simulateOtherBrowser } from '../shared/auth';
import { AUTH_DEMO, REGISTRATION_KEY } from '../shared/authPolicy';
import { transaction, notify } from '../shared/api';
import { MOCK } from '../shared/config';
import { emitTag } from '../shared/nfc';
import { ErrorBox, useResource } from '../shared/ui';
import type { DemoControls, Fault } from '../shared/types';
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
        이 화면은 서비스 UI가 아닙니다. 같은 브라우저·같은 주소의 다른 탭에서 키오스크를 열어
        주세요.
      </p>
      <div className="sim-links">
        <a href="/mobile" target="_blank" rel="noreferrer">
          모바일 열기 ↗
        </a>
        <a href="/kiosk" target="_blank" rel="noreferrer">
          키오스크 열기 ↗
        </a>
      </div>
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
          {r.data?.items.map((i) => (
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
