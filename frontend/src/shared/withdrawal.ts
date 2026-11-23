import { request } from './http';
import { ServiceError } from './serviceError';

export async function outstandingRentals(): Promise<boolean> {
  const result = await request('/api/v1/account/outstanding-rentals');
  if (typeof result.hasOutstandingRentals !== 'boolean')
    throw new ServiceError('UNKNOWN', '대여 상태를 확인하지 못했습니다.');
  return result.hasOutstandingRentals;
}

export async function withdrawAccount(expectedUserId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/v1/account', { method: 'DELETE', credentials: 'include', cache: 'no-store', headers: { 'X-Expected-User-Id': expectedUserId }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ServiceError('UNKNOWN', '탈퇴 처리 결과를 확인하지 못했습니다.');
  }
  if (response.status === 204) return;
  const body = await response.json().catch(() => null);
  if (response.status === 409 && body?.error?.code === 'OUTSTANDING_RENTALS')
    throw new ServiceError('OUTSTANDING_RENTALS', '반납하지 않은 물품이 있어 탈퇴할 수 없습니다.');
  if (response.status === 401) throw new ServiceError('AUTH', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  if (response.status >= 400 && response.status < 500 && typeof body?.error?.code === 'string')
    throw new ServiceError(body.error.code, body.error.message || '요청을 처리하지 못했습니다.');
  throw new ServiceError('UNKNOWN', '탈퇴 처리 결과를 확인하지 못했습니다.');
}
