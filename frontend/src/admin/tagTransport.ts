import { ServiceError } from '../shared/api';
import { normalizeUid } from '../shared/nfcUid';

// Verified against PR #10. Not wired to the mock's UUID item IDs.
// Enabling the real gateway also requires agreed create/read/auth contracts.
export async function postItemTag(itemId: number, value: string) {
  if (!Number.isSafeInteger(itemId) || itemId <= 0)
    throw new Error('서버 물품 ID를 확인해 주세요.');
  let response: Response;
  try {
    response = await fetch(`/api/items/${itemId}/tag`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: normalizeUid(value) }),
    });
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('UNKNOWN', '같은 물품과 UID로 태그 연결을 다시 시도해 주세요.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const messages: Record<string, string> = {
      TAG_ALREADY_REGISTERED: '이미 등록된 태그입니다. 다른 태그를 인식해 주세요.',
      ITEM_ALREADY_TAGGED: '이 물품에는 이미 태그가 연결되어 있습니다.',
      ITEM_NOT_FOUND: '물품을 찾을 수 없습니다. 목록을 확인해 주세요.',
      INVALID_UID_FORMAT: '태그 UID 형식을 확인해 주세요.',
      VALIDATION: '태그 UID를 확인해 주세요.',
      SESSION_REQUIRED: '관리자 로그인이 필요합니다.',
      FORBIDDEN: '태그 연결 권한이 없습니다.',
    };
    const code = body?.error?.code;
    // Unrecognized/5xx responses may follow a committed write.
    if (response.status >= 500 || !messages[code])
      throw new ServiceError('UNKNOWN', '같은 물품과 UID로 태그 연결을 다시 시도해 주세요.');
    throw new ServiceError(code, messages[code]);
  }
  const tag = body?.tag;
  if (
    ![200, 201].includes(response.status) ||
    tag?.itemId !== itemId ||
    tag?.uid !== normalizeUid(value) ||
    tag?.status !== 'ACTIVE'
  )
    throw new ServiceError(
      'UNKNOWN',
      '태그 연결 응답을 확인하지 못했습니다. 같은 물품과 UID로 다시 시도해 주세요.',
    );
  return tag as { tagId: number; uid: string; itemId: number; status: 'ACTIVE'; createdAt: string };
}
