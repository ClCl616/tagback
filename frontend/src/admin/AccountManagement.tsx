import { useEffect, useState } from 'react';
import { request } from '../shared/http';
type Account = { adminNumber: string; name: string; active: boolean; mustChangePassword: boolean };
export function AccountManagement() {
  const [rows, setRows] = useState<Account[]>([]),
    [logs, setLogs] = useState<any[]>([]),
    [number, setNumber] = useState(''),
    [name, setName] = useState(''),
    [temporary, setTemporary] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    const [accounts, history] = await Promise.all([
      request('/api/v1/admin/accounts'),
      request('/api/v1/admin/access-log'),
    ]);
    setRows(accounts);
    setLogs(history);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="aw-card">
      <h2>관리자 계정</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await request('/api/v1/admin/accounts', 'POST', {
              adminNumber: number,
              name,
            });
            setTemporary(result.temporaryPassword);
            setNumber('');
            setName('');
          });
        }}
      >
        <label>
          관리자 번호
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            pattern="[0-9]{3}"
            maxLength={3}
            required
            inputMode="numeric"
          />
        </label>
        <label>
          이름
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <button disabled={busy}>관리자 추가</button>
      </form>
      {temporary && (
        <div role="status">
          <p>
            임시 비밀번호: <strong>{temporary}</strong>
          </p>
          <p>해당 관리자에게 전달해 주세요. 첫 로그인에서 변경합니다.</p>
          <button onClick={() => setTemporary('')}>확인 후 숨기기</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {rows.map((row) => (
        <div className="aw-account" key={row.adminNumber}>
          <strong>
            {row.adminNumber} · {row.name}
          </strong>
          <span>
            {row.active ? '사용 가능' : '비활성'}
            {row.mustChangePassword ? ' · 첫 로그인 대기' : ''}
          </span>
          {row.adminNumber !== '000' && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await request(`/api/v1/admin/accounts/${row.adminNumber}`, 'PATCH', {
                    ...row,
                    active: !row.active,
                  });
                })
              }
            >
              {row.active ? '비활성화' : '활성화'}
            </button>
          )}
        </div>
      ))}
      <h2>최근 접속 기록</h2>
      {logs.map((row, i) => (
        <p key={i}>
          {row.adminNumber} · {row.name} · {row.channel === 'KIOSK' ? '키오스크' : '웹'} ·{' '}
          {new Date(row.createdAt).toLocaleString('ko-KR')}
        </p>
      ))}
    </section>
  );
}
