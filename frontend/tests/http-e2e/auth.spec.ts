import { test, expect, type Page } from '@playwright/test';

async function server(page: Page, options: { registered?: boolean; loseSignup?: boolean } = {}) {
  let signedIn = false, registered = options.registered ?? false, signupCount = 0, purpose = 'SIGNUP';
  const writes: { path: string; body: any; key?: string }[] = [];
  const expiry = new Date(Date.now() + 300000).toISOString();
  const user = { userId: '12', name: '홍길동', occupation: '학생', role: 'USER', };
  await page.route('**/api/v1/auth/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith('/session') || path.endsWith('/session/activity')) return signedIn
      ? reply({ authenticated: true, user, sessionExpiresAt: expiry })
      : reply({ error: { code: 'SESSION_REQUIRED', message: '로그인이 필요합니다.', retryAt: null } }, 401);
    if (path.endsWith('/browser-registration')) return reply({ registered, expiresAt: registered ? expiry : null });
    if (req.method() === 'POST') writes.push({ path, body: req.postDataJSON(), key: req.headers()['idempotency-key'] });
    if (path.endsWith('/kakao/challenges') && req.method() === 'POST') {
      purpose = req.postDataJSON().purpose; return reply({ id: 'challenge', code: '0123456789', expiresAt: expiry }, 201);
    }
    if (path.endsWith('/kakao/challenges/challenge') && req.method() === 'GET') return reply({ purpose, status: 'VERIFIED', expiresAt: expiry });
    if (path.endsWith('/kakao/challenges/challenge') && req.method() === 'DELETE') return route.fulfill({ status: 204 });
    if (path.endsWith('/kakao/pin/reset')) { signedIn = false; registered = false; return reply({ completed: true }); }
    if (path.endsWith('/kakao/signup') || path.endsWith('/kakao/login/new-browser') || path.endsWith('/login/registered')) {
      signedIn = true; registered = true;
      if (path.endsWith('/kakao/signup') && options.loseSignup && signupCount++ === 0) return route.abort();
      return reply({ user, sessionExpiresAt: expiry, browserRegistrationExpiresAt: expiry }, path.endsWith('/signup') ? 201 : 200);
    }
    if (path.endsWith('/logout')) { signedIn = false; return route.fulfill({ status: 204 }); }
    throw new Error('Unexpected auth path: ' + path);
  });
  return writes;
}

async function completeChallenge(page: Page) {
  await page.getByRole('button', { name: '카카오톡 인증 시작' }).click();
  await expect(page.getByLabel('인증 코드')).toHaveText('0123456789');
  await page.getByRole('button', { name: '인증 확인' }).click();
  await expect(page.getByLabel('PIN 숫자 6자리')).toBeVisible();
}
async function setupPin(page: Page) {
  await page.getByLabel('PIN 숫자 6자리').fill('048259');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByLabel('PIN 숫자 6자리').fill('048259');
  await page.getByRole('button', { name: '확인', exact: true }).click();
}

test('signup uses Kakao challenge and PIN without storing credentials', async ({ page }) => {
  const writes = await server(page);
  await page.goto('/mobile/signup');
  await page.getByLabel('이름', { exact: true }).fill('홍길동');
  await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.getByRole('button', { name: '다음' }).click();
  await completeChallenge(page); await setupPin(page);
  await expect(page).toHaveURL(/\/mobile$/);
  expect(writes.find((x) => x.path.endsWith('/kakao/signup'))?.body).toMatchObject({ challengeId: 'challenge', profile: { name: '홍길동', occupation: '학생' } });
  expect(writes.some((x) => x.path.includes('/sms/'))).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('048259');
});
test('new browser login uses Kakao verification and existing PIN', async ({ page }) => {
  const writes = await server(page); await page.goto('/mobile/login'); await completeChallenge(page);
  await page.getByLabel('PIN 숫자 6자리').fill('048259'); await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile$/);
  expect(writes.find((x) => x.path.endsWith('/kakao/login/new-browser'))?.body).toEqual({ challengeId: 'challenge', pin: '048259' });
});
test('registered browser uses PIN without a chatbot challenge', async ({ page }) => {
  const writes = await server(page, { registered: true }); await page.goto('/mobile/login');
  await page.getByLabel('PIN 숫자 6자리').fill('048259'); await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile$/);
  expect(writes.some((x) => x.path.endsWith('/login/registered'))).toBe(true);
  expect(writes.some((x) => x.path.endsWith('/kakao/challenges'))).toBe(false);
});
test('PIN reset uses chatbot challenge and offers login after success', async ({ page }) => {
  const writes = await server(page); await page.goto('/mobile/recover'); await completeChallenge(page); await setupPin(page);
  await expect(page.getByText('PIN이 재설정되었습니다.')).toBeVisible();
  expect(writes.find((x) => x.path.endsWith('/kakao/challenges'))?.body).toEqual({ purpose: 'PIN_RESET' });
  expect(writes.find((x) => x.path.endsWith('/kakao/pin/reset'))?.body).toEqual({ challengeId: 'challenge', pin: '048259' });
});
test('lost signup response retries the same key and body', async ({ page }) => {
  const writes = await server(page, { loseSignup: true }); await page.goto('/mobile/signup');
  await page.getByLabel('이름', { exact: true }).fill('홍길동'); await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.getByRole('button', { name: '다음' }).click(); await completeChallenge(page); await setupPin(page);
  await page.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await page.getByRole('button', { name: '결과 다시 확인' }).click(); await expect(page).toHaveURL(/\/mobile$/);
  const attempts = writes.filter((x) => x.path.endsWith('/kakao/signup'));
  expect(attempts).toHaveLength(2); expect(attempts[0].key).toBe(attempts[1].key); expect(attempts[0].body).toEqual(attempts[1].body);
});
test('cancelling an issued request calls the cancellation endpoint', async ({ page }) => {
  await server(page); let canceled = false;
  await page.route('**/api/v1/auth/kakao/challenges/challenge', async (route, request) => {
    if (request.method() === 'DELETE') { canceled = true; return route.fulfill({ status: 204 }); }
    return route.fallback();
  });
  await page.goto('/mobile/recover'); await page.getByRole('button', { name: '카카오톡 인증 시작' }).click();
  await page.getByRole('button', { name: '인증 취소' }).click();
  await expect(page.getByRole('button', { name: '카카오톡 인증 시작' })).toBeVisible(); expect(canceled).toBe(true);
});
test('leaving an unfinished signup cancels its challenge', async ({ page }) => {
  await server(page); let canceled = false;
  await page.route('**/api/v1/auth/kakao/challenges/challenge', async (route, request) => {
    if (request.method() === 'DELETE') { canceled = true; return route.fulfill({ status: 204 }); }
    return route.fallback();
  });
  await page.goto('/mobile/signup');
  await page.getByLabel('이름', { exact: true }).fill('홍길동'); await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.getByRole('button', { name: '다음' }).click(); await page.getByRole('button', { name: '카카오톡 인증 시작' }).click();
  await page.getByRole('link', { name: '로그인으로' }).click();
  await expect.poll(() => canceled).toBe(true);
});
