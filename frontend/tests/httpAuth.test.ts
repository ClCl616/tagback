import { afterEach, expect, it, vi } from 'vitest';
import { createHttpAuth, serverSession } from '../src/shared/httpAuth';

const user = {
  userId: '12',
  maskedPhoneNumber: '010-****-5678',
  role: 'USER',
  name: '홍길동',
  occupation: '학생',
};
const expiry = '2030-01-01T00:00:00Z';
const login = { user, sessionExpiresAt: expiry, browserRegistrationExpiresAt: expiry };
const session = { authenticated: true, user, sessionExpiresAt: expiry };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

it('signup sends profile and key with cookies, then verifies server session', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json(login, 201))
    .mockResolvedValueOnce(json(session));
  vi.stubGlobal('fetch', fetch);
  const result = await createHttpAuth().signup('key', 'proof', '048259', '', {
    name: '홍길동',
    occupation: '학생',
  });
  expect(result).toEqual({ token: 'cookie-session', registration: 'cookie-session' });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/v1/auth/signup');
  expect(options.credentials).toBe('include');
  expect(options.headers['Idempotency-Key']).toBe('key');
  expect(JSON.parse(options.body)).toEqual({
    verificationToken: 'proof',
    pin: '048259',
    profile: { name: '홍길동', occupation: '학생' },
  });
});
it('lost login response retries identical POST body and key without a result endpoint', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce(json(login))
    .mockResolvedValueOnce(json(session));
  vi.stubGlobal('fetch', fetch);
  const api = createHttpAuth();
  await expect(api.loginWithPhone('key', '01012345678', '048259', '')).rejects.toMatchObject({
    code: 'UNKNOWN',
  });
  await api.result('key');
  expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe('key');
});
it('unknown SMS issuance keeps original key and prevents changing the number', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce(
      json({ requestId: 'r1', expiresAt: expiry, resendAvailableAt: expiry }, 202),
    );
  vi.stubGlobal('fetch', fetch);
  const api = createHttpAuth();
  await expect(api.requestSms('01012345678', 'access', '')).rejects.toMatchObject({
    code: 'SMS_PENDING',
  });
  await expect(api.requestSms('01099999999', 'access', '')).rejects.toMatchObject({
    code: 'SMS_PENDING',
  });
  await api.requestSms('01012345678', 'access', '');
  expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe(
    fetch.mock.calls[0][1].headers['Idempotency-Key'],
  );
  expect(JSON.parse(fetch.mock.calls[1][1].body).purpose).toBe('SIGNUP');
});
it('verification response loss requires a new SMS; no invented verification result query', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error()));
  await expect(createHttpAuth().verifySms('r1', '', '123456', 'access', '')).rejects.toMatchObject({
    code: 'SMS_RESTART',
  });
});
it('PIN errors preserve server wait time and blocked state', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        json({ error: { code: 'PIN_RETRY_WAIT', message: '대기', retryAt: expiry } }, 429),
      )
      .mockResolvedValueOnce(
        json({ error: { code: 'PIN_LOGIN_BLOCKED', message: '복구', retryAt: null } }, 403),
      ),
  );
  const api = createHttpAuth();
  await expect(api.loginWithPhone('one', '01012345678', '048259', '')).rejects.toMatchObject({
    code: 'PIN_RETRY_WAIT',
    retryAt: Date.parse(expiry),
  });
  await expect(api.loginWithPhone('two', '01012345678', '048259', '')).rejects.toMatchObject({
    code: 'PIN_LOCKED',
  });
});
it('malformed success and rejected cookies never complete login', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ ...login, user: {} }))
      .mockResolvedValueOnce(json(login))
      .mockResolvedValueOnce(
        json({ error: { code: 'SESSION_REQUIRED', message: '로그인 필요', retryAt: null } }, 401),
      ),
  );
  const api = createHttpAuth();
  await expect(api.loginWithPhone('one', '01012345678', '048259', '')).rejects.toMatchObject({
    code: 'UNKNOWN',
  });
  await expect(api.loginWithPhone('two', '01012345678', '048259', '')).rejects.toMatchObject({
    code: 'UNKNOWN',
  });
});
it('refresh recovery only checks session and never replays missing credentials', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      json({ error: { code: 'SESSION_REQUIRED', message: '로그인 필요', retryAt: null } }, 401),
    );
  vi.stubGlobal('fetch', fetch);
  expect(await createHttpAuth().result('lost-memory')).toBeNull();
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/session');
  expect(fetch.mock.calls[0][1].method).toBe('GET');
});
it('polling reads session, activity is an explicit POST and logout accepts 204', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json(session))
    .mockResolvedValueOnce(json(session))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  await serverSession();
  await serverSession(true);
  await createHttpAuth().logout('');
  expect(fetch.mock.calls.map((c) => [c[0], c[1].method])).toEqual([
    ['/api/v1/auth/session', 'GET'],
    ['/api/v1/auth/session/activity', 'POST'],
    ['/api/v1/auth/logout', 'POST'],
  ]);
});
