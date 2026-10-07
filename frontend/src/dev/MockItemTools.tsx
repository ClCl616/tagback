import { useRef, useState } from 'react';
import { ErrorBox } from '../shared/ui';
import { clearMockItems, generateMockItems, MAX_BATCH, MAX_ITEMS, type TagMode } from './mockItems';

export function MockItemTools({
  count,
  reload,
}: {
  count: number | undefined;
  reload: () => void;
}) {
  const [amount, setAmount] = useState('20');
  const [tagMode, setTagMode] = useState<TagMode>('mixed');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  async function run(action: () => Promise<string>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      setMessage(await action());
      reload();
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="mock-items-title">
      <h2 id="mock-items-title">물품 Mock 데이터</h2>
      <p>
        현재 물품 {count ?? '—'}개 · 한 번에 최대 {MAX_BATCH}개, 전체 최대 {MAX_ITEMS}개
      </p>
      <p>
        기존 물품에 지정한 수량을 추가합니다. 이름·분류·상태를 무작위로 정하고 이미지는 기본
        아이콘을 사용합니다. 태그 미등록 물품은 점검 중 또는 수리 중으로 생성됩니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => `${await generateMockItems(Number(amount), tagMode)}개 물품 생성 완료`,
          );
        }}
      >
        <fieldset disabled={busy} className="sim-item-fields">
          <label>
            생성 수량
            <input
              type="number"
              min="1"
              max={MAX_BATCH}
              step="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            생성할 태그 상태
            <select value={tagMode} onChange={(e) => setTagMode(e.target.value as TagMode)}>
              <option value="mixed">무작위 혼합</option>
              <option value="linked">모두 태그 연결</option>
              <option value="unlinked">모두 태그 미등록</option>
            </select>
          </label>
          <div className="sim-tags">
            <button type="submit">{busy ? '처리 중…' : '무작위 물품 생성'}</button>
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    '모든 물품과 대여 기록·처리 기록·대여 코드를 삭제하시겠습니까? 계정과 카테고리는 유지됩니다.',
                  )
                )
                  return;
                void run(async () => {
                  await clearMockItems();
                  return '물품 및 연결된 대여 데이터 삭제 완료';
                });
              }}
            >
              물품 전체 삭제
            </button>
          </div>
        </fieldset>
      </form>
      <p>
        전체 삭제 시 물품과 연결된 대여 기록·처리 기록·대여 코드도 삭제됩니다.
        계정·카테고리·대여소는 유지되며 실제 서버에는 영향을 주지 않습니다.
      </p>
      {message && <p role="status">{message}</p>}
      <ErrorBox error={error} />
    </section>
  );
}
