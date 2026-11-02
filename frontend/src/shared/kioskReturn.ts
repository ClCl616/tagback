import { ServiceError } from './serviceError';

type Transport = (path: string, init: RequestInit) => Promise<Response>;
type Credentials = () => Promise<HeadersInit | undefined>;

export function returnError(status: number, code: unknown): ServiceError {
  if (status === 401 || status === 403) return new ServiceError('AUTH_PENDING', '반납 인증 방식이 아직 정해지지 않았습니다.');
  switch (code) {
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
    if (!auth) throw new ServiceError('AUTH_PENDING', '반납 인증 방식이 아직 정해지지 않았습니다.');
    const headers = new Headers(auth);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await transport(path, { method, headers, credentials: 'omit', body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw returnError(response.status, data?.error?.code);
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
  if (!client) throw new ServiceError('AUTH_PENDING', '반납 인증 방식이 아직 정해지지 않았습니다.');
  await client.lookup(uid);
  // Even a successful lookup must not enable return confirmation until the contract is agreed.
  throw new ServiceError('UNSUPPORTED', '실서버 반납 처리는 아직 준비 중입니다.');
}
