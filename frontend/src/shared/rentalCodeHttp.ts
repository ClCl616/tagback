import { ServiceError } from './serviceError';
import type { Code } from './types';

export async function issueRentalCode(): Promise<Code> {
  let response: Response;
  try {
    response = await fetch('/api/v1/rental-codes', {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ServiceError('UNKNOWN', '코드 발급 결과를 확인하지 못했습니다. 다시 확인해 주세요.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new ServiceError('AUTH', '다시 로그인해 주세요.');
    throw new ServiceError(data?.error?.code || 'UNKNOWN',
      data?.error?.message || '코드를 발급하지 못했습니다.');
  }
  const expiresAt = typeof data?.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN;
  if (!/^[0-9]{6}$/.test(data?.code) || !Number.isFinite(expiresAt))
    throw new ServiceError('UNKNOWN', '코드 응답을 확인하지 못했습니다.');
  return { value: data.code, userId: '', expiresAt, used: false };
}
