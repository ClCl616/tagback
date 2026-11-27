import { afterEach, expect, it, vi } from 'vitest';
import { httpAuthApi, serverSession } from '../src/shared/httpAuth';
const user = {
  userId: '12',
  maskedPhoneNumber: '',
  role: 'USER',
  name: '별명',
  occupation: '학생',
};
const session = { authenticated: true, user, sessionExpiresAt: '2030-01-01T00:00:00Z' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
it('completes with only nickname and occupation and confirms the cookie session', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ next: '/mobile', userId: '12' }))
    .mockResolvedValueOnce(json(session));
  vi.stubGlobal('fetch', fetch);
  await httpAuthApi.complete('별명', '학생');
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/kakao/complete');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: '별명', occupation: '학생' });
  expect(fetch.mock.calls[0][1].credentials).toBe('include');
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/session');
});
it('rejects a success response when the browser has no session', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ next: '/mobile', userId: '12' }))
      .mockResolvedValueOnce(
        json({ error: { code: 'SESSION_REQUIRED', message: '로그인 필요' } }, 401),
      ),
  );
  await expect(httpAuthApi.complete('별명', '학생')).rejects.toMatchObject({ code: 'AUTH' });
});
it('never follows an arbitrary authorization URL', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ url: 'https://evil.example/login' })));
  await expect(httpAuthApi.start('/mobile')).rejects.toMatchObject({ code: 'UNKNOWN' });
});
it('sends account-switch intent and accepts only Kakao authorization', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(json({ url: 'https://kauth.kakao.com/oauth/authorize?state=test' }));
  vi.stubGlobal('fetch', fetch);
  await httpAuthApi.start('/mobile/code', true);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    next: '/mobile/code',
    switchAccount: true,
  });
});
it('session accepts no phone number and rejects malformed identity', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(session))
      .mockResolvedValueOnce(json({ ...session, user: { ...user, userId: '' } })),
  );
  expect((await serverSession()).user.name).toBe('별명');
  await expect(serverSession()).rejects.toMatchObject({ code: 'UNKNOWN' });
});
