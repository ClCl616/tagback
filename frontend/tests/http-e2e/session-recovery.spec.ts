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
  await page.setViewportSize({ width: 390, height: 844 });
  await server(page);
  await page.route('**/api/v1/auth/session', (route) => route.abort());
  await page.goto('/mobile');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '서비스에 연결하지 못했어요' })).toBeVisible();
  await page.unroute('**/api/v1/auth/session');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '모바일 메뉴' })).toBeVisible();
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/items?**', (route) =>
    route.fulfill({ json: { items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 } }),
  );
  await page.route('**/api/v1/rentals/me?**', (route) =>
    route.fulfill({ json: { rentals: [], page: 0, size: 100, totalElements: 0, totalPages: 0 } }),
  );
});
