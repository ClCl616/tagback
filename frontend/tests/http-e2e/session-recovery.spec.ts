import { test, expect } from '@playwright/test';

async function server(page: import('@playwright/test').Page) {
  let signedIn = false;
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const user = {
    userId: '12',
    name: '홍길동',
    occupation: '학생',
    role: 'USER',
    maskedPhoneNumber: '010-****-5678',
  };
  await page.route('**/api/v1/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/browser-registration'))
      return route.fulfill({ json: { registered: false } });
    if (path.includes('/login/')) {
      signedIn = true;
      return route.fulfill({
        json: { user, sessionExpiresAt: expiry, browserRegistrationExpiresAt: expiry },
      });
    }
    return signedIn
      ? route.fulfill({ json: { authenticated: true, user, sessionExpiresAt: expiry } })
      : route.fulfill({
          status: 401,
          json: { error: { code: 'SESSION_REQUIRED', message: '로그인 필요' } },
        });
  });
}

test('initial connection failure remains recoverable after closing popup', async ({ page }) => {
  await server(page);
  await page.route('**/api/v1/auth/session', (route) => route.abort());
  await page.goto('/mobile');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '서비스에 연결하지 못했어요' })).toBeVisible();
  await page.unroute('**/api/v1/auth/session');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '모바일 메뉴' })).toBeVisible();
});

test('a delayed pre-login session response cannot erase successful login', async ({ page }) => {
  await server(page);
  await page.goto('/mobile/login');
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  let captured: import('@playwright/test').Route | undefined;
  await page.route('**/api/v1/auth/session', async (route) => {
    if (!captured) {
      captured = route;
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('tagback-session')));
  await expect.poll(() => !!captured).toBe(true);
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await expect(page).toHaveURL(/\/mobile$/);
  await captured!.fulfill({
    status: 401,
    json: { error: { code: 'SESSION_REQUIRED', message: '로그인 필요' } },
  });
  await page.getByRole('link', { name: '내 계정', exact: true }).click();
  await expect(page.getByText('홍길동님')).toBeVisible();
  await expect(page.getByRole('heading', { name: '로그인이 필요해요' })).toHaveCount(0);
});

test('an existing session does not prove a lost PIN reset completed after reload', async ({
  page,
}) => {
  await server(page);
  await page.goto('/mobile/login');
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await expect(page).toHaveURL(/\/mobile$/);
  await page.evaluate(() =>
    sessionStorage.setItem(
      'tagback.http.pending-auth',
      JSON.stringify({ id: 'lost-reset', mode: 'reset' }),
    ),
  );
  await page.goto('/mobile/recover');
  await page.getByRole('button', { name: '처리 결과 다시 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '이전 요청의 완료 여부를 확인할 수 없습니다.',
  );
  await expect(page).toHaveURL(/\/mobile\/recover$/);
  await expect(page.getByRole('heading', { name: 'PIN이 재설정되었습니다.' })).toHaveCount(0);
});
