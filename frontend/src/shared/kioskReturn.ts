import { ServiceError } from './serviceError';
import { mapError, sendKioskRequest } from './kioskHttp';

type Transport = (path: string, init: RequestInit) => Promise<Response>;
type Credentials = () => Promise<HeadersInit | undefined>;

export function returnError(status: number, code: unknown, retryAt?: unknown): ServiceError {
  if (status === 401) return new ServiceError('RETURN_CODE_AUTH', '코드를 다시 입력해 주세요.');
  if (status === 403) return new ServiceError('RETURN_FORBIDDEN', '대여한 본인만 반납할 수 있어요. 대리 반납은 불가해요.');
  switch (code) {
    case 'RENTAL_GRANT_EXPIRED': return mapError('verify', status, code, '코드 인증 시간이 지났어요. 새 코드를 받아 다시 입력해 주세요.');
    case 'RENTAL_CODE_CONSUMED': return mapError('verify', status, code, '이미 사용한 코드예요. 새 코드를 받아 입력해 주세요.');
    case 'RENTAL_VERIFICATION_LIMITED': {
      const time = typeof retryAt === 'string' ? Date.parse(retryAt) : NaN;
      return new ServiceError('RENTAL_VERIFICATION_LIMITED', '잠시 후 코드를 다시 확인해 주세요.', Number.isFinite(time) ? time : undefined);
    }
    case 'TAG_NOT_FOUND': return new ServiceError('TAG_UNKNOWN', '등록되지 않은 태그입니다. 반납할 물품의 태그를 확인해 주세요.');
    case 'TAG_INACTIVE': return new ServiceError('TAG_INACTIVE', '사용 중지된 태그입니다. 관리자에게 문의해 주세요.');
    case 'INVALID_INPUT': return new ServiceError('INVALID_INPUT', '반납 요청 정보를 확인해 주세요.');
    case 'ITEM_NOT_FOUND': return new ServiceError('ITEM_NOT_FOUND', '해당 물품을 찾을 수 없습니다.');
    // After a lost response, this also cannot distinguish a successful return from no active rental.
    case 'RENTAL_NOT_ACTIVE': return new ServiceError('RENTAL_NOT_ACTIVE', '이미 반납됐거나 진행 중인 대여가 없습니다.');
    case 'RENTAL_STATE_CONFLICT': return new ServiceError('RENTAL_STATE_CONFLICT', '물품 상태가 변경되었습니다. 관리자에게 문의해 주세요.');
    default: return new ServiceError('UNKNOWN', '요청을 처리하지 못했습니다.');
  }
}

// A caller must supply both transport and authentication; production return wiring is intentionally absent.
export function createReturnClient(transport: Transport, credentials: Credentials) {
  async function request(path: string, method: string, body?: unknown) {
    const auth = await credentials();
    if (!auth) throw new ServiceError('AUTH_PENDING', '반납 코드를 입력해 주세요.');
    const headers = new Headers(auth);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const { response, data } = await sendKioskRequest(transport, path, { method, headers, credentials: 'omit', body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw returnError(response.status, data?.error?.code, data?.error?.retryAt);
    if (!data || typeof data !== 'object') throw new ServiceError('UNKNOWN', '서버 응답을 확인하지 못했습니다.');
    return data;
  }
  return {
    async lookup(raw: string) {
      const uid = raw.replace(/[\s:-]/g, '').toUpperCase();
      if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid)) throw new ServiceError('INVALID_UID_FORMAT', '태그 UID 형식을 확인해 주세요.');
      const data = await request(`/api/tags/${encodeURIComponent(uid)}`, 'GET');
      if (data?.tag?.uid !== uid || data?.tag?.status !== 'ACTIVE') throw new ServiceError('UNKNOWN', '태그 조회 응답을 확인하지 못했습니다.');
      return data;
    },
    returnItem(itemId: string) { return request('/api/v1/rentals/return', 'POST', { itemId }); },
  };
}

export async function lookupReturnTag(uid: string, client?: Pick<ReturnType<typeof createReturnClient>, 'lookup'>): Promise<never> {
  if (!client) throw new ServiceError('AUTH_PENDING', '반납 코드를 입력해 주세요.');
  await client.lookup(uid);
  // Even a successful lookup must not enable return confirmation until the contract is agreed.
  throw new ServiceError('UNSUPPORTED', '실서버 반납 처리는 아직 준비 중입니다.');
}
