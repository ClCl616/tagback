import { MOCK } from './config';
import { ServiceError } from './serviceError';
import type { Catalog, Grant, Item, Receipt } from './types';

type Action = 'verify' | 'catalog' | 'scan' | 'rent';
const SERVER_UNAVAILABLE_MESSAGE = '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.';
export type ServerConnection = 'unknown' | 'connected' | 'disconnected';
let serverConnection: ServerConnection = 'unknown';
const connectionListeners = new Set<(status: ServerConnection) => void>();
export function subscribeServerConnection(listener: (status: ServerConnection) => void): () => void {
  connectionListeners.add(listener);
  listener(serverConnection);
  return () => { connectionListeners.delete(listener); };
}
function updateServerConnection(status: ServerConnection) {
  serverConnection = status;
  connectionListeners.forEach((listener) => listener(status));
}
function hasBackendErrorShape(data: unknown): data is { error: { code: string; message?: unknown } } {
  if (!data || typeof data !== 'object' || !('error' in data)) return false;
  const error = data.error;
  return !!error && typeof error === 'object' && 'code' in error && typeof error.code === 'string';
}
const positiveId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value) &&
  (value.length < 19 || (value.length === 19 && value <= '9223372036854775807'));
const timestamp = (value: unknown) => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw new ServiceError('UNKNOWN', '서버 응답을 확인하지 못했습니다.');
  return parsed;
};

function mapError(action: Action, status: number, code: unknown, message: unknown): never {
  const safe = typeof message === 'string' ? message : '요청을 처리하지 못했습니다.';
  if (action === 'rent' && status >= 500)
    throw new ServiceError('UNKNOWN', '처리 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해 주세요.');
  switch (code) {
    case 'RENTAL_CODE_INVALID': throw new ServiceError('CODE_INVALID', safe);
    case 'RENTAL_CODE_CONSUMED': throw new ServiceError('CODE_USED', safe);
    case 'RENTAL_CODE_EXPIRED': throw new ServiceError('CODE_EXPIRED', safe);
    case 'RENTAL_GRANT_REQUIRED':
    case 'RENTAL_GRANT_INVALID':
      throw new ServiceError('AUTH', safe);
    case 'RENTAL_GRANT_EXPIRED':
      throw new ServiceError(action === 'rent' ? 'GRANT_EXPIRED' : 'AUTH', safe);
    case 'TAG_NOT_FOUND': throw new ServiceError('TAG_UNKNOWN', '등록되지 않은 태그입니다.');
    case 'TAG_INACTIVE': throw new ServiceError('TAG_INACTIVE', '사용 중지된 태그입니다.');
    case 'ITEM_NOT_AVAILABLE': throw new ServiceError(action === 'scan' ? 'UNAVAILABLE' : 'CONFLICT', safe);
    case 'ITEM_TYPE_MISMATCH': throw new ServiceError('MISMATCH', '선택한 종류와 다른 물품입니다.');
    case 'RENTAL_ALREADY_ACTIVE': throw new ServiceError('CONFLICT', safe);
    default:
      if (status === 401) throw new ServiceError('AUTH', '대여 코드를 다시 확인해 주세요.');
      throw new ServiceError(typeof code === 'string' ? code : 'UNKNOWN', safe);
  }
}

async function request(path: string, action: Action, method = 'GET', grant?: Grant,
                       body?: unknown, key?: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'omit', // A shared kiosk must not send a user's mobile session cookie.
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(grant ? { Authorization: `Bearer ${grant.token}` } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    updateServerConnection('disconnected');
    if (action === 'rent')
      throw new ServiceError('UNKNOWN', '응답을 받지 못했습니다. 같은 요청으로 결과를 확인해 주세요.');
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new ServiceError('TIMEOUT', SERVER_UNAVAILABLE_MESSAGE);
    throw new ServiceError('NETWORK', SERVER_UNAVAILABLE_MESSAGE);
  }
  const data = await response.json().catch(() => null);
  const backendError = hasBackendErrorShape(data);
  const proxyFailure = response.status >= 500 && !backendError;
  updateServerConnection(proxyFailure ? 'disconnected' : 'connected');
  if (proxyFailure && action !== 'rent')
    throw new ServiceError('SERVER_UNAVAILABLE', SERVER_UNAVAILABLE_MESSAGE);
  if (!response.ok) mapError(action, response.status, data?.error?.code, data?.error?.message);
  if (action === 'rent' && response.status !== 200 && response.status !== 201)
    throw new ServiceError('UNKNOWN', '반출 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해 주세요.');
  if (!data || typeof data !== 'object')
    throw new ServiceError('UNKNOWN', '서버 응답을 확인하지 못했습니다.');
  return data;
}

export async function verifyRentalCode(code: string): Promise<Grant> {
  const data = await request('/api/v1/kiosk/rental-grants', 'verify', 'POST', undefined, { code });
  if (typeof data.token !== 'string' || typeof data.maskedPhoneNumber !== 'string')
    throw new ServiceError('UNKNOWN', '코드 확인 응답을 확인하지 못했습니다.');
  return { token: data.token, maskedPhone: data.maskedPhoneNumber,
    expiresAt: timestamp(data.expiresAt) };
}

export async function rentalCatalog(grant: Grant): Promise<Catalog> {
  const data = await request('/api/v1/item-types', 'catalog', 'GET', grant);
  if (!Array.isArray(data.itemTypes) || !data.itemTypes.every((row: any) =>
    positiveId(row?.itemTypeId) && typeof row?.itemTypeName === 'string'))
    throw new ServiceError('UNKNOWN', '물품 종류 목록을 확인하지 못했습니다.');
  return {
    kinds: data.itemTypes.map((row: any) => ({ id: row.itemTypeId, name: row.itemTypeName,
      category: '공용 물품', description: '', art: 'generic' as const })),
    items: [], // The type API intentionally does not expose individual inventory.
    stations: [{ id: MOCK.stationId, name: '대전대 융합과학관', location: '융합과학관 2층 학생 라운지' }],
  };
}

export async function lookupRentalTag(uid: string, grant: Grant, selectedTypeId: string): Promise<Item> {
  if (!positiveId(selectedTypeId)) throw new ServiceError('MISMATCH', '물품 종류를 다시 선택해 주세요.');
  uid = uid.replace(/[\s:-]/g, '').toUpperCase();
  if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid))
    throw new ServiceError('INVALID_UID_FORMAT', '태그 UID 형식을 확인해 주세요.');
  const data = await request(`/api/tags/${encodeURIComponent(uid)}`, 'scan', 'GET', grant);
  const row = data.item;
  if (!Number.isSafeInteger(row?.itemId) || row.itemId <= 0 || !positiveId(row.itemTypeId) ||
      typeof row.name !== 'string' || typeof row.itemTypeName !== 'string' ||
      typeof row.status !== 'string' ||
      typeof row.rentable !== 'boolean' || data.tag?.status !== 'ACTIVE' ||
      data.tag?.uid !== uid)
    throw new ServiceError('UNKNOWN', '태그 조회 응답을 확인하지 못했습니다.');
  if (row.itemTypeId !== selectedTypeId)
    throw new ServiceError('MISMATCH', '선택한 종류와 다른 물품입니다. 선택한 종류의 물품을 접촉해 주세요.');
  if (!row.rentable) throw new ServiceError('UNAVAILABLE', '현재 대여할 수 없는 물품입니다.');
  return { id: String(row.itemId), label: row.name, name: row.name,
    kindId: row.itemTypeId, stationId: MOCK.stationId, tag: uid, active: true, status: 'available' };
}

export async function checkoutRental(key: string, grant: Grant, itemId: string,
                                     itemTypeId: string): Promise<Receipt> {
  if (!positiveId(itemId) || !positiveId(itemTypeId) ||
      !/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(key))
    throw new ServiceError('INVALID_INPUT', '물품 또는 요청 정보가 올바르지 않습니다.');
  const data = await request('/api/v1/rentals', 'rent', 'POST', grant,
    { itemId, itemTypeId }, key);
  if (!positiveId(data.rentalId) || data.itemId !== itemId || data.itemTypeId !== itemTypeId ||
      data.rentalStatus !== 'RENTED' || data.itemStatus !== 'RENTED')
    throw new ServiceError('UNKNOWN', '반출 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해 주세요.');
  const rentedAt = timestamp(data.rentedAt);
  const dueAt = timestamp(data.dueAt);
  return { operationId: key, type: 'rent',
    item: { id: itemId, label: `물품 ${itemId}`, kindId: itemTypeId,
      stationId: MOCK.stationId, tag: '', active: true, status: 'rented' },
    rental: { id: data.rentalId, userId: '', itemId, stationId: MOCK.stationId, rentedAt, dueAt } };
}
