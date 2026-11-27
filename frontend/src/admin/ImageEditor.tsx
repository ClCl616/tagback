import { useState } from 'react';
import { request } from '../shared/http';
import type { Item } from '../shared/types';
export function ImageEditor({ item, saved }: { item: Item; saved: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function upload(file: File, type: boolean) {
    setBusy(true);
    setError('');
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2_000_000)
        throw Error('2MB 이하의 PNG 또는 JPG 이미지를 선택해 주세요.');
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await request(
        `/api/v1/${type ? 'item-types/' + item.kindId : 'items/' + item.id}/image`,
        'PUT',
        { data },
      );
      saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지를 등록하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy}>
      <legend>물품 이미지</legend>
      <p>개별 이미지가 없으면 종류 대표 이미지를 표시합니다. 최대 2048 × 2048px</p>
      <label>
        개별 이미지
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            if (e.target.files?.[0]) void upload(e.target.files[0], false);
          }}
        />
      </label>
      <label>
        종류 대표 이미지
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            if (e.target.files?.[0]) void upload(e.target.files[0], true);
          }}
        />
      </label>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await request(`/api/v1/items/${item.id}/image`, 'DELETE');
            saved();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        개별 이미지 제거
      </button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
