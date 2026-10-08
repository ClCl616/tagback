import { test, expect, type Page } from '@playwright/test';
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

async function server(page: Page, loseSignup = false) {
  let signedIn = false,
    registered = false,
    signupCount = 0;
  const writes: { path: string; body: unknown; key: string | undefined }[] = [];
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const user = {
    userId: '12',
    name: '홍길동',
    occupation: '학생',
    role: 'USER',
    maskedPhoneNumber: '010-****-5678',
  };
  await page.route('**/api/v1/auth/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith('/session') || path.endsWith('/session/activity'))
      return signedIn
        ? reply({ authenticated: true, user, sessionExpiresAt: expiry })
        : reply(
            { error: { code: 'SESSION_REQUIRED', message: '로그인이 필요합니다.', retryAt: null } },
            401,
          );
    if (path.endsWith('/browser-registration'))
      return reply({
        registered,
        maskedPhoneNumber: registered ? user.maskedPhoneNumber : null,
        expiresAt: registered ? expiry : null,
      });
    if (req.method() === 'POST')
      writes.push({ path, body: req.postDataJSON(), key: req.headers()['idempotency-key'] });
    if (path.endsWith('/sms/requests'))
      return reply(
        { requestId: 'challenge', expiresAt: expiry, resendAvailableAt: new Date().toISOString() },
        202,
      );
    if (path.endsWith('/sms/verifications'))
      return reply({
        verificationToken: 'proof-secret',
        purpose: 'SIGNUP',
        expiresAt: expiry,
        maskedPhoneNumber: user.maskedPhoneNumber,
      });
    if (path.endsWith('/signup') || path.includes('/login/')) {
      signedIn = true;
      registered = true;
      if (path.endsWith('/signup') && loseSignup && signupCount++ === 0) return route.abort();
      return reply(
        { user, sessionExpiresAt: expiry, browserRegistrationExpiresAt: expiry },
        path.endsWith('/signup') ? 201 : 200,
      );
    }
    if (path.endsWith('/logout')) {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    throw new Error('Unexpected auth path: ' + path);
  });
  return writes;
}
async function signup(page: Page) {
  await page.goto('/mobile/signup');
  await page.getByLabel('이름', { exact: true }).fill('홍길동');
  await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await page.getByLabel('SMS 인증번호').fill('123456');
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'PIN 설정 안내' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
}
test('signup profile, session reload, account and logout use HTTP without storing credentials', async ({
  page,
}) => {
  const writes = await server(page);
  await signup(page);
  await expect(page).toHaveURL(/\/mobile$/);
  await page.goto('/mobile/code');
  const unavailable = page.getByRole('dialog', { name: '서비스 준비 중이에요' });
  await expect(unavailable).toBeVisible();
  await expect(unavailable.getByRole('button', { name: '다시 시도' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 740 });
  await page.screenshot({ path: 'test-results/service-popup.png' });
  await unavailable.getByRole('button', { name: '확인', exact: true }).click();
  await page.goto('/mobile/account');
  await expect(page.getByText('홍길동님')).toBeVisible();
  await page.reload();
  await expect(page.getByText('홍길동님')).toBeVisible();
  expect(writes.find((x) => x.path.endsWith('/signup'))?.body).toMatchObject({
    profile: { name: '홍길동', occupation: '학생' },
  });
  expect(
    await page.evaluate(() => [
      localStorage.getItem('tagback.mobile.token'),
      localStorage.getItem('tagback.mobile.registration'),
    ]),
  ).toEqual([null, null]);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('proof-secret');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('PIN 번호', { exact: true })).toBeVisible();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile$/);
  expect(writes.some((x) => x.path.endsWith('/login/registered'))).toBe(true);
});
test('phone PIN login goes to main without requesting SMS', async ({ page }) => {
  const writes = await server(page);
  await page.goto('/mobile/login');
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile$/);
  expect(writes.some((x) => x.path.endsWith('/login/phone'))).toBe(true);
  expect(writes.some((x) => x.path.includes('/sms/'))).toBe(false);
});
test('lost signup response retries the same payload and key', async ({ page }) => {
  const writes = await server(page, true);
  await signup(page);
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '처리 결과 다시 확인', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '처리 결과 다시 확인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile$/);
  const signups = writes.filter((x) => x.path.endsWith('/signup'));
  expect(signups).toHaveLength(2);
  expect(signups[1]).toEqual(signups[0]);
});

test('PIN recovery shows rules only on invalid input and header stays fixed', async ({ page }) => {
  await server(page);
  await page.route('**/api/v1/auth/sms/verifications', (route) =>
    route.fulfill({
      json: {
        verificationToken: 'reset-proof',
        purpose: 'PIN_RESET',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        maskedPhoneNumber: '010-****-5678',
      },
    }),
  );
  await page.goto('/mobile/recover');
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await page.getByLabel('SMS 인증번호').fill('123456');
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '변경할 PIN 번호를 입력해 주세요.' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.pin-guidance')).toHaveCount(0);
  await page.getByLabel('PIN 번호', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('6자리 전체가 연속');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'PIN 번호를 한 번 더 입력해 주세요.' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 704 });
  await page.goto('/mobile');
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(() => page.locator('.mobile-header').evaluate((el) => el.getBoundingClientRect().top))
    .toBe(0);
  await page.screenshot({ path: 'test-results/sticky-header.png' });
});

test('a corrected PIN uses a new operation and prevents concurrent submissions', async ({
  page,
}) => {
  await server(page);
  const attempts: { key: string; pin: string }[] = [];
  await page.route('**/api/v1/auth/login/phone', async (route) => {
    attempts.push({
      key: route.request().headers()['idempotency-key'],
      pin: route.request().postDataJSON().pin,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 401,
      json: { error: { code: 'PIN_MISMATCH', message: 'PIN이 일치하지 않습니다.', retryAt: null } },
    });
  });
  await page.goto('/mobile/login');
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '확인 중…', exact: true })).toBeDisabled();
  await expect(page.getByText('PIN이 일치하지 않습니다.', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('246802');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1].key).not.toBe(attempts[0].key);
  expect(attempts[1].pin).toBe('246802');
});

async function beginSignup(page: Page) {
  await page.goto('/mobile/signup');
  await page.getByLabel('이름', { exact: true }).fill('홍길동');
  await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
}

test('SMS challenge and cooldown survive reload, back navigation and phone switches', async ({
  page,
}) => {
  const writes = await server(page);
  let requests = 0;
  await page.route('**/api/v1/auth/sms/requests', (route) => {
    requests++;
    return route.fulfill({
      status: 202,
      json: {
        requestId: 'resumable',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        resendAvailableAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  });
  await beginSignup(page);
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await expect(page.getByRole('button', { name: /재발송까지/ })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('SMS 인증번호')).toBeVisible();
  await expect(page.getByLabel('전화번호', { exact: true })).toHaveValue('01012345678');
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await expect(page.getByLabel('이름', { exact: true })).toHaveValue('홍길동');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByLabel('SMS 인증번호')).toBeVisible();
  await page.getByLabel('전화번호', { exact: true }).fill('01099999999');
  await expect(page.getByLabel('SMS 인증번호')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '인증번호 발송', exact: true })).toBeEnabled();
  await page.getByLabel('전화번호', { exact: true }).fill('010-1234-5678');
  await expect(page.getByLabel('SMS 인증번호')).toBeVisible();
  await page.getByLabel('SMS 인증번호').fill('123456');
  await expect(page.getByRole('button', { name: '인증번호 확인', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'PIN 설정 안내' })).toBeVisible();
  expect(requests).toBe(1);
  expect(writes.find((x) => x.path.endsWith('/sms/verifications'))?.body).toMatchObject({
    requestId: 'resumable',
  });
  await page.reload();
  await expect(page.getByLabel('SMS 인증번호')).toBeDisabled();
  await expect(
    page.getByText('인증을 다시 진행해 주세요. 새 인증번호를 받아 입력해 주세요.'),
  ).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(stored).not.toContain('proof-secret');
  expect(stored).not.toContain('"code"');
});

test('lost SMS issuance retries its original key after reload without issuing twice', async ({
  page,
}) => {
  await server(page);
  const keys: string[] = [];
  await page.route('**/api/v1/auth/sms/requests', (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) return route.abort();
    return route.fulfill({
      status: 202,
      json: {
        requestId: 'same-request',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        resendAvailableAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  });
  await beginSignup(page);
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await expect(page.getByLabel('SMS 인증번호')).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('server cooldown without a local challenge survives reload and expires', async ({ page }) => {
  await page.clock.install();
  await server(page);
  let requests = 0;
  await page.route('**/api/v1/auth/sms/requests', (route) => {
    requests++;
    return route.fulfill({
      status: 429,
      json: {
        error: {
          code: 'SMS_RESEND_WAIT',
          message: '재발송까지 기다려 주세요.',
          retryAt: new Date(Date.now() + 60000).toISOString(),
        },
      },
    });
  });
  await beginSignup(page);
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('button', { name: /인증 요청까지/ })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: /인증 요청까지/ })).toBeDisabled();
  await page.clock.fastForward(61000);
  await expect(page.getByRole('button', { name: '인증번호 발송', exact: true })).toBeEnabled();
  expect(requests).toBe(1);
});

test('wrong code stays editable after reload; expired code is replaced; rapid requests send once', async ({
  page,
}) => {
  await page.clock.install();
  await server(page);
  let requests = 0;
  await page.route('**/api/v1/auth/sms/requests', async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const now = await page.evaluate(() => Date.now());
    await route.fulfill({
      status: 202,
      json: {
        requestId: 'request-' + requests,
        expiresAt: new Date(now + 120000).toISOString(),
        resendAvailableAt: new Date(now + 60000).toISOString(),
      },
    });
  });
  await page.route('**/api/v1/auth/sms/verifications', (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: {
          code: 'SMS_CODE_MISMATCH',
          message: '인증번호가 일치하지 않습니다.',
          retryAt: null,
        },
      },
    }),
  );
  await beginSignup(page);
  await page
    .getByRole('button', { name: '인증번호 발송', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByLabel('SMS 인증번호')).toBeVisible();
  expect(requests).toBe(1);
  await page.getByLabel('SMS 인증번호').fill('999999');
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('인증번호가 일치하지 않습니다.');
  await page.reload();
  await expect(page.getByLabel('SMS 인증번호')).toBeEnabled();
  await page.clock.fastForward(121000);
  await expect(page.getByRole('dialog')).toContainText('인증번호가 만료되었습니다.');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByLabel('SMS 인증번호')).toBeDisabled();
  await page.getByRole('button', { name: '인증번호 재발송', exact: true }).click();
  await expect(page.getByLabel('SMS 인증번호')).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('SMS 인증번호')).toBeEnabled();
  expect(requests).toBe(2);
});

test('existing signup number is blocked before verification and offers login', async ({ page }) => {
  const writes = await server(page);
  await page.route('**/api/v1/auth/sms/requests', (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'PHONE_NUMBER_ALREADY_REGISTERED',
          message: '이미 등록된 전화번호입니다.',
          retryAt: null,
        },
      },
    }),
  );
  await beginSignup(page);
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  const popup = page.getByRole('dialog', { name: '이미 가입된 전화번호예요' });
  await expect(popup).toBeVisible();
  await expect(page.getByLabel('SMS 인증번호')).toHaveCount(0);
  await popup.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('전화번호', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await popup.getByRole('button', { name: '로그인하기', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/login$/);
  expect(
    writes.some((x) => x.path.endsWith('/sms/verifications') || x.path.endsWith('/signup')),
  ).toBe(false);
});
