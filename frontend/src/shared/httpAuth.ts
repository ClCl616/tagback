import { ServiceError } from './serviceError';
import type { AuthAdapter, AuthResult } from './authTypes';
import { COOKIE_SESSION } from './authMode';
import { readDraft, writeDraft, clearDraft } from './authDraft';

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
    const mapped = code.startsWith('SESSION_')
      ? 'AUTH'
      : code === 'PIN_LOGIN_BLOCKED'
        ? 'PIN_LOCKED'
        : code === 'BROWSER_REGISTRATION_INVALID'
          ? 'REGISTRATION'
          : code.startsWith('VERIFICATION_')
            ? 'SMS_REQUIRED'
            : code;
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
async function loginResult(value: any): Promise<AuthResult> {
  if (!validUser(value.user))
    throw new ServiceError('UNKNOWN', '로그인 응답을 확인하지 못했습니다.');
  timestamp(value.sessionExpiresAt);
  timestamp(value.browserRegistrationExpiresAt);
  // A successful body is insufficient if the browser rejected Secure cookies.
  let session: ServerSession;
  try {
    session = await serverSession();
  } catch {
    throw new ServiceError(
      'UNKNOWN',
      '로그인 세션을 확인하지 못했습니다. 쿠키 설정을 확인한 뒤 같은 요청으로 다시 시도해 주세요.',
    );
  }
  if (session.user.userId !== value.user.userId)
    throw new ServiceError('UNKNOWN', '로그인 세션을 확인하지 못했습니다.');
  return { token: COOKIE_SESSION, registration: COOKIE_SESSION };
}
// Retry bodies live only in memory. PIN/SMS/proof never enter browser storage.
export function createHttpAuth(): AuthAdapter {
  const pending = new Map<string, () => Promise<AuthResult>>();
  const smsPending = new Map<string, string>();
  async function write(
    id: string,
    path: string,
    body: unknown,
    expected = 200,
    reset = false,
  ): Promise<AuthResult> {
    let action = pending.get(id);
    if (!action) {
      const frozen = JSON.parse(JSON.stringify(body));
      action = async () => {
        const value = await authRequest(path, 'POST', frozen, id, expected);
        if (!reset) return loginResult(value);
        if (value.completed !== true)
          throw new ServiceError('UNKNOWN', '변경 결과를 확인하지 못했습니다.');
        return { completed: true };
      };
      pending.set(id, action);
    }
    try {
      const result = await action();
      pending.delete(id);
      return result;
    } catch (e) {
      if (!(e instanceof ServiceError) || e.code !== 'UNKNOWN') pending.delete(id);
      throw e;
    }
  }
  const unsupported = async (): Promise<never> => {
    throw new ServiceError('UNSUPPORTED', '전화번호 변경은 아직 지원하지 않습니다.');
  };
  return {
    async requestSms(phone, purpose) {
      if (purpose === 'change') return unsupported();
      const body = {
        phoneNumber: phone.replace(/[\s-]/g, ''),
        purpose: purpose === 'reset' ? 'PIN_RESET' : 'SIGNUP',
      };
      const fingerprint = JSON.stringify(body);
      const storageKey = 'request.' + fingerprint;
      const saved = readDraft<{ key: string }>(storageKey);
      const key =
        smsPending.get(fingerprint) ||
        (typeof saved?.key === 'string' ? saved.key : crypto.randomUUID());
      smsPending.set(fingerprint, key);
      writeDraft(storageKey, { key });
      try {
        const value = await authRequest('/sms/requests', 'POST', body, key, 202);
        if (typeof value.requestId !== 'string' || !value.requestId)
          throw new ServiceError('UNKNOWN', '인증 요청을 확인하지 못했습니다.');
        const result = {
          id: value.requestId,
          expiresAt: timestamp(value.expiresAt),
          resendAt: timestamp(value.resendAvailableAt),
        };
        smsPending.delete(fingerprint);
        clearDraft(storageKey);
        return result;
      } catch (e) {
        if (e instanceof ServiceError && e.code === 'UNKNOWN')
          throw new ServiceError(
            'SMS_PENDING',
            '발송 결과가 불명확합니다. 같은 전화번호로 다시 발송을 눌러 확인해 주세요.',
          );
        smsPending.delete(fingerprint);
        clearDraft(storageKey);
        throw e;
      }
    },
    async verifySms(id, _phone, code, purpose) {
      try {
        const value = await authRequest('/sms/verifications', 'POST', { requestId: id, code });
        if (
          typeof value.verificationToken !== 'string' ||
          !value.verificationToken ||
          typeof value.maskedPhoneNumber !== 'string' ||
          value.purpose !== (purpose === 'reset' ? 'PIN_RESET' : 'SIGNUP')
        )
          throw new ServiceError('UNKNOWN', '인증 응답을 확인하지 못했습니다.');
        return {
          proof: value.verificationToken,
          expiresAt: timestamp(value.expiresAt),
          maskedPhone: value.maskedPhoneNumber,
          existing: false,
          canReset: true,
          needsPin: false,
        };
      } catch (e) {
        if (
          e instanceof ServiceError &&
          (e.code === 'UNKNOWN' || e.code === 'SMS_ALREADY_VERIFIED')
        )
          throw new ServiceError(
            'SMS_RESTART',
            '인증 결과를 받지 못했습니다. 재발송 대기 후 새 인증번호로 확인해 주세요.',
          );
        throw e;
      }
    },
    async registration() {
      const value = await authRequest('/browser-registration');
      if (value.registered === false) return null;
      if (value.registered !== true || typeof value.maskedPhoneNumber !== 'string')
        throw new ServiceError('UNKNOWN', '브라우저 등록을 확인하지 못했습니다.');
      if (timestamp(value.expiresAt) <= Date.now()) return null;
      return { maskedPhone: value.maskedPhoneNumber, retryAt: 0, locked: false };
    },
    login: (id, _credential, pin, registered) =>
      registered ? write(id, '/login/registered', { pin }) : unsupported(),
    loginWithPhone: (id, phone, pin) =>
      write(id, '/login/phone', { phoneNumber: phone.replace(/[\s-]/g, ''), pin }),
    signup: (id, proof, pin, _source, profile) =>
      write(id, '/signup', { verificationToken: proof, pin, profile }, 201),
    resetPin: (id, proof, pin) =>
      write(id, '/pin/reset', { verificationToken: proof, pin }, 200, true),
    reauthenticate: unsupported,
    changePhone: unsupported,
    async result(id) {
      const action = pending.get(id);
      if (action) {
        try {
          const result = await action();
          pending.delete(id);
          return result;
        } catch (e) {
          if (e instanceof ServiceError && e.code !== 'UNKNOWN') pending.delete(id);
          throw e;
        }
      }
      // A session may predate this operation and cannot prove its outcome.
      throw new ServiceError(
        'RECOVERY_UNCONFIRMED',
        '이전 요청의 완료 여부를 확인할 수 없습니다. 가입했다면 로그인하고, PIN을 변경했다면 새 PIN으로 로그인해 주세요.',
      );
    },
    async logout() {
      await authRequest('/logout', 'POST', undefined, undefined, 204);
      pending.clear();
    },
    async unregister() {
      await authRequest('/browser-registration', 'DELETE', undefined, undefined, 204);
      pending.clear();
    },
  };
}
export const httpAuthApi = createHttpAuth();
