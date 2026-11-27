import { ServiceError } from './serviceError';

const base = '/api/v1/auth';
export function timestamp(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ServiceError('UNKNOWN', '서버 응답을 확인하지 못했습니다.');
  return Date.parse(value);
}
export type ServerSession = {
  authenticated: true;
  user: {
    userId: string;
    maskedPhoneNumber: string;
    role: 'USER' | 'ADMIN';
    name: string | null;
    occupation: string | null;
  };
  sessionExpiresAt: string;
};
function validUser(value: any) {
  return (
    value &&
    typeof value.userId === 'string' &&
    value.userId.length > 0 &&
    typeof value.maskedPhoneNumber === 'string' &&
    ['USER', 'ADMIN'].includes(value.role) &&
    (value.name === null || typeof value.name === 'string') &&
    (value.occupation === null || typeof value.occupation === 'string')
  );
}
export async function authRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
  expected = 200,
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(base + path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ServiceError('UNKNOWN', '응답을 받지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (
      typeof data?.error?.code !== 'string' ||
      !data.error.code ||
      typeof data.error.message !== 'string' ||
      (response.status >= 500 && data.error.code !== 'SMS_DELIVERY_FAILED')
    )
      throw new ServiceError('UNKNOWN', '처리 결과를 확인하지 못했습니다.');
    const code = data.error.code;
    const mapped = code.startsWith('SESSION_') ? 'AUTH' : code;
    throw new ServiceError(
      mapped,
      data.error.message,
      data.error.retryAt ? timestamp(data.error.retryAt) : undefined,
    );
  }
  if (response.status !== expected || (expected !== 204 && !data))
    throw new ServiceError('UNKNOWN', '서버 응답 형식을 확인하지 못했습니다.');
  return data;
}
export async function serverSession(activity = false): Promise<ServerSession> {
  const value = await authRequest(
    activity ? '/session/activity' : '/session',
    activity ? 'POST' : 'GET',
  );
  if (value.authenticated !== true || !validUser(value.user))
    throw new ServiceError('UNKNOWN', '세션 응답을 확인하지 못했습니다.');
  timestamp(value.sessionExpiresAt);
  return value;
}
export const httpAuthApi = {
  async start(next: string, switchAccount = false): Promise<string> {
    const value = await authRequest('/kakao/start', 'POST', { next, switchAccount });
    const url = new URL(value.url);
    if (url.origin !== 'https://kauth.kakao.com' || url.pathname !== '/oauth/authorize')
      throw new ServiceError('UNKNOWN', '카카오 로그인 주소를 확인하지 못했습니다.');
    return url.href;
  },
  async pending(): Promise<{
    needsSignup: boolean;
    nickname: string;
    next: string;
    userId: string | null;
  }> {
    return authRequest('/kakao/pending');
  },
  async complete(name: string, occupation: string) {
    const value = await authRequest('/kakao/complete', 'POST', { name, occupation });
    const session = await serverSession(); // Verify cookie acceptance AND expected account.
    if (session.user.userId !== value.userId)
      throw new ServiceError(
        'UNKNOWN',
        '로그인 계정이 변경되었습니다. 카카오 로그인을 다시 시작해 주세요.',
      );
    return value as { next: string };
  },
  async logout(_token?: string) {
    await authRequest('/logout', 'POST', undefined, undefined, 204);
  },
};
