import { afterEach, expect, it, vi } from 'vitest';
import { createHttpAuth, serverSession } from '../src/shared/httpAuth';

const user = { userId: '12', role: 'USER', name: '홍길동', occupation: '학생' };
const expiry = '2030-01-01T00:00:00Z';
const login = { user, sessionExpiresAt: expiry, browserRegistrationExpiresAt: expiry };
const session = { authenticated: true, user, sessionExpiresAt: expiry };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

it('issues and checks a purpose-bound Kakao challenge with browser cookies', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'id-1', code: '0123456789', expiresAt: expiry }, 201))
    .mockResolvedValueOnce(json({ purpose: 'SIGNUP', status: 'VERIFIED', expiresAt: expiry }));
  vi.stubGlobal('fetch', fetch);
  const api = createHttpAuth();
  expect(await api.issue('SIGNUP')).toEqual({ id: 'id-1', code: '0123456789', expiresAt: Date.parse(expiry) });
  expect((await api.status('id-1')).status).toBe('VERIFIED');
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/kakao/challenges');
  expect(fetch.mock.calls[0][1].credentials).toBe('include');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ purpose: 'SIGNUP' });
});
it('signup sends Kakao challenge and key then verifies server session', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json(login, 201)).mockResolvedValueOnce(json(session)); vi.stubGlobal('fetch', fetch);
  const result = await createHttpAuth().signup('key', 'challenge', '048259', { name: '홍길동', occupation: '학생' });
  expect(result).toEqual({ token: 'cookie-session', registration: 'cookie-session' });
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/kakao/signup');
  expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('key');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ challengeId: 'challenge', pin: '048259', profile: { name: '홍길동', occupation: '학생' } });
});
it('lost response retries the identical Kakao login body and key', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(json(login)).mockResolvedValueOnce(json(session)); vi.stubGlobal('fetch', fetch);
  const api = createHttpAuth();
  await expect(api.newBrowserLogin('key', 'challenge', '048259')).rejects.toMatchObject({ code: 'UNKNOWN' });
  await api.result('key');
  expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe('key');
});
it('PIN errors preserve server wait time and recovery block', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: { code: 'PIN_RETRY_WAIT', message: '대기', retryAt: expiry } }, 429))
    .mockResolvedValueOnce(json({ error: { code: 'PIN_LOGIN_BLOCKED', message: '복구', retryAt: null } }, 403)));
  const api = createHttpAuth();
  await expect(api.registeredLogin('one', '048259')).rejects.toMatchObject({ code: 'PIN_RETRY_WAIT', retryAt: Date.parse(expiry) });
  await expect(api.registeredLogin('two', '048259')).rejects.toMatchObject({ code: 'PIN_LOGIN_BLOCKED' });
});
it('reset and cancellation use the Kakao API without SMS', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ completed: true })).mockResolvedValueOnce(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
  const api = createHttpAuth(); await api.resetPin('reset-key', 'c1', '048259'); await api.cancel('c2');
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/kakao/pin/reset');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ challengeId: 'c1', pin: '048259' });
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/kakao/challenges/c2');
  expect(fetch.mock.calls[1][1].method).toBe('DELETE');
});
it('reload never infers completion from an unrelated session', async () => {
  const fetch = vi.fn().mockResolvedValue(json(session)); vi.stubGlobal('fetch', fetch);
  await expect(createHttpAuth().result('lost-memory')).rejects.toMatchObject({ code: 'RECOVERY_UNCONFIRMED' });
  expect(fetch).not.toHaveBeenCalled();
});
it('polling, activity, and logout keep their session boundaries', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
  await serverSession(); await serverSession(true); await createHttpAuth().logout();
  expect(fetch.mock.calls.map((c) => [c[0], c[1].method])).toEqual([['/api/v1/auth/session', 'GET'], ['/api/v1/auth/session/activity', 'POST'], ['/api/v1/auth/logout', 'POST']]);
});
