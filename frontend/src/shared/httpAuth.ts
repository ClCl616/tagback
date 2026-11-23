import { ServiceError } from './serviceError';
import type { AuthAdapter, AuthResult, KakaoPurpose, KakaoStatus } from './authTypes';
import { COOKIE_SESSION } from './authMode';

const base = '/api/v1/auth';
export function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new ServiceError('UNKNOWN', '서버 응답을 확인하지 못했습니다.');
  return Date.parse(value);
}
export type ServerSession = { authenticated: true; user: { userId: string; role: 'USER' | 'ADMIN'; name: string | null; occupation: string | null }; sessionExpiresAt: string };
function validUser(value: any) {
  return value && typeof value.userId === 'string' && !!value.userId &&
    ['USER', 'ADMIN'].includes(value.role) && (value.name === null || typeof value.name === 'string') &&
    (value.occupation === null || typeof value.occupation === 'string');
}
export async function authRequest(path: string, method = 'GET', body?: unknown, key?: string, expected = 200): Promise<any> {
  let response: Response;
  try {
    response = await fetch(base + path, { method, credentials: 'include', cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  } catch { throw new ServiceError('UNKNOWN', '응답을 받지 못했습니다. 같은 요청으로 다시 확인해 주세요.'); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (typeof data?.error?.code !== 'string' || typeof data.error.message !== 'string' || response.status >= 500)
      throw new ServiceError('UNKNOWN', '처리 결과를 확인하지 못했습니다.');
    const code = data.error.code.startsWith('SESSION_') ? 'AUTH' : data.error.code;
    throw new ServiceError(code, data.error.message, data.error.retryAt ? timestamp(data.error.retryAt) : undefined);
  }
  if (response.status !== expected || (expected !== 204 && !data)) throw new ServiceError('UNKNOWN', '서버 응답 형식을 확인하지 못했습니다.');
  return data;
}
export async function serverSession(activity = false): Promise<ServerSession> {
  const value = await authRequest(activity ? '/session/activity' : '/session', activity ? 'POST' : 'GET');
  if (value.authenticated !== true || !validUser(value.user)) throw new ServiceError('UNKNOWN', '세션 응답을 확인하지 못했습니다.');
  timestamp(value.sessionExpiresAt); return value;
}
async function loginResult(value: any): Promise<AuthResult> {
  if (!validUser(value.user)) throw new ServiceError('UNKNOWN', '로그인 응답을 확인하지 못했습니다.');
  timestamp(value.sessionExpiresAt); timestamp(value.browserRegistrationExpiresAt);
  let session: ServerSession;
  try { session = await serverSession(); }
  catch { throw new ServiceError('UNKNOWN', '로그인 세션을 확인하지 못했습니다. 쿠키 설정을 확인한 뒤 같은 요청으로 다시 시도해 주세요.'); }
  if (session.user.userId !== value.user.userId) throw new ServiceError('UNKNOWN', '로그인 세션을 확인하지 못했습니다.');
  return { token: COOKIE_SESSION, registration: COOKIE_SESSION };
}
// Final request bodies and PINs stay in memory; retries retain the original body and key.
export function createHttpAuth(): AuthAdapter {
  const pending = new Map<string, { fingerprint: string; action: () => Promise<AuthResult> }>();
  async function write(key: string, path: string, body: unknown, expected = 200, reset = false): Promise<AuthResult> {
    const fingerprint = JSON.stringify({ path, body });
    let entry = pending.get(key);
    if (entry && entry.fingerprint !== fingerprint) throw new ServiceError('IDEMPOTENCY_KEY_CONFLICT', '같은 요청으로 다시 시도해 주세요.');
    if (!entry) {
      const frozen = JSON.parse(JSON.stringify(body));
      entry = { fingerprint, action: async () => {
        const value = await authRequest(path, 'POST', frozen, key, expected);
        if (!reset) return loginResult(value);
        if (value.completed !== true) throw new ServiceError('UNKNOWN', '변경 결과를 확인하지 못했습니다.');
        return { completed: true };
      } };
      pending.set(key, entry);
    }
    try { const result = await entry.action(); pending.delete(key); return result; }
    catch (e) { if (!(e instanceof ServiceError) || e.code !== 'UNKNOWN') pending.delete(key); throw e; }
  }
  return {
    async issue(purpose: KakaoPurpose) {
      const value = await authRequest('/kakao/challenges', 'POST', { purpose }, undefined, 201);
      if (typeof value.id !== 'string' || !value.id || typeof value.code !== 'string' || !/^\d{10}$/.test(value.code))
        throw new ServiceError('UNKNOWN', '인증 요청을 확인하지 못했습니다.');
      return { id: value.id, code: value.code, expiresAt: timestamp(value.expiresAt) };
    },
    async status(id: string): Promise<KakaoStatus> {
      const value = await authRequest('/kakao/challenges/' + encodeURIComponent(id));
      if (!['SIGNUP', 'LOGIN', 'PIN_RESET'].includes(value.purpose) || !['PENDING', 'VERIFIED', 'CONSUMED', 'CANCELED', 'EXPIRED'].includes(value.status))
        throw new ServiceError('UNKNOWN', '인증 상태를 확인하지 못했습니다.');
      return { purpose: value.purpose, status: value.status, expiresAt: timestamp(value.expiresAt) };
    },
    async cancel(id: string) { await authRequest('/kakao/challenges/' + encodeURIComponent(id), 'DELETE', undefined, undefined, 204); },
    async registration() { const value = await authRequest('/browser-registration'); if (value.registered === false) return false;
      if (value.registered !== true) throw new ServiceError('UNKNOWN', '브라우저 등록을 확인하지 못했습니다.'); return timestamp(value.expiresAt) > Date.now(); },
    registeredLogin: (key, pin) => write(key, '/login/registered', { pin }),
    newBrowserLogin: (key, challengeId, pin) => write(key, '/kakao/login/new-browser', { challengeId, pin }),
    signup: (key, challengeId, pin, profile) => write(key, '/kakao/signup', { challengeId, pin, profile }, 201),
    resetPin: (key, challengeId, pin) => write(key, '/kakao/pin/reset', { challengeId, pin }, 200, true),
    async result(key) { const entry = pending.get(key); if (!entry) throw new ServiceError('RECOVERY_UNCONFIRMED', '이전 요청의 결과를 확인할 수 없습니다. 이미 가입했다면 로그인하고, PIN을 변경했다면 새 PIN으로 로그인해 주세요.');
      try { const result = await entry.action(); pending.delete(key); return result; } catch (e) { if (e instanceof ServiceError && e.code !== 'UNKNOWN') pending.delete(key); throw e; } },
    async logout() { await authRequest('/logout', 'POST', undefined, undefined, 204); pending.clear(); },
    async unregister() { await authRequest('/browser-registration', 'DELETE', undefined, undefined, 204); pending.clear(); },
  };
}
export const httpAuthApi = createHttpAuth();
