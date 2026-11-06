import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const state = {
    signedIn: true,
    userId: '12',
    name: '김민준',
    codes: 0,
    failItems: false,
    failCode: false,
    codeSeconds: 180,
  };
  const expires = () => new Date(Date.now() + 3600000).toISOString();
  const items = [
    {
      itemId: '1',
      itemTypeId: '1',
      itemName: '계산기 01',
      itemTypeName: '공학용 계산기',
      status: 'AVAILABLE',
    },
    {
      itemId: '2',
      itemTypeId: '1',
      itemName: '계산기 02',
      itemTypeName: '공학용 계산기',
      status: 'RENTED',
    },
    {
      itemId: '3',
      itemTypeId: '2',
      itemName: '우산 01',
      itemTypeName: '우산',
      status: 'AVAILABLE',
    },
    {
      itemId: '4',
      itemTypeId: '3',
      itemName: '배터리 01',
      itemTypeName: '보조배터리',
      status: 'REPAIR',
    },
  ];
  const rows = [
    {
      rentalId: '11',
      itemId: '2',
      itemName: '계산기 02',
      itemTypeName: '공학용 계산기',
      rentedAt: '2026-11-06T05:00:00Z',
      dueAt: '2026-11-09T05:00:00Z',
      returnedAt: null,
      overdue: false,
    },
    {
      rentalId: '12',
      itemId: '3',
      itemName: '우산 01',
      itemTypeName: '우산',
      rentedAt: '2026-10-30T05:00:00Z',
      dueAt: '2026-11-02T05:00:00Z',
      returnedAt: null,
      overdue: true,
    },
    {
      rentalId: '13',
      itemId: '1',
      itemName: '계산기 01',
      itemTypeName: '공학용 계산기',
      rentedAt: '2026-10-30T05:00:00Z',
      dueAt: '2026-11-02T05:00:00Z',
      returnedAt: '2026-11-01T05:00:00Z',
      overdue: false,
    },
  ];
  const paged = (name: string, data: unknown[]) => ({
    [name]: data,
    page: 0,
    size: 100,
    totalElements: data.length,
    totalPages: data.length ? 1 : 0,
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const user = {
      userId: state.userId,
      name: state.name,
      occupation: '학생',
      role: 'USER',
      maskedPhoneNumber: '010-****-5678',
    };
    if (url.pathname.endsWith('/browser-registration'))
      return route.fulfill({ json: { registered: false } });
    if (url.pathname.includes('/login/')) {
      state.signedIn = true;
      return route.fulfill({
        json: { user, sessionExpiresAt: expires(), browserRegistrationExpiresAt: expires() },
      });
    }
    if (url.pathname.endsWith('/logout')) {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.includes('/auth/'))
      return state.signedIn
        ? route.fulfill({ json: { authenticated: true, user, sessionExpiresAt: expires() } })
        : route.fulfill({
            status: 401,
            json: { error: { code: 'SESSION_REQUIRED', message: '로그인 필요' } },
          });
    if (url.pathname.endsWith('/items'))
      return state.failItems ? route.abort() : route.fulfill({ json: paged('items', items) });
    if (url.pathname.endsWith('/rentals/me'))
      return route.fulfill({
        json: paged(
          'rentals',
          rows.filter((r) =>
            url.searchParams.get('scope') === 'HISTORY' ? r.returnedAt : !r.returnedAt,
          ),
        ),
      });
    if (url.pathname.endsWith('/rental-codes')) {
      state.codes++;
      return state.failCode
        ? route.abort()
        : route.fulfill({
            json: {
              code: state.userId === '12' ? '482193' : '679041',
              expiresAt: new Date(Date.now() + state.codeSeconds * 1000).toISOString(),
            },
          });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  page.on('pageerror', (error) => {
    throw error;
  });
  return state;
}

test('code is explicitly issued, shared across routes and never reissued by focus or expiry', async ({
  page,
}) => {
  const state = await fixture(page);
  state.codeSeconds = 4;
  await page.goto('/mobile');
  await expect(page.getByRole('heading', { name: '안녕하세요, 김민준님!' })).toBeVisible();
  expect(state.codes).toBe(0);
  await page.getByRole('link', { name: '이용 코드 발급하기' }).click();
  expect(state.codes).toBe(0);
  await page.getByRole('button', { name: '이용 코드 발급', exact: true }).click();
  await expect(page.locator('.code-number')).toHaveText('482193');
  await page.locator('.uw-sidebar').getByRole('link', { name: '홈', exact: true }).click();
  await expect(page.locator('.code-number')).toHaveText('482193');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('유효시간이 지났어요', { exact: true })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.locator('.code-number')).not.toContainText('482193');
  expect(state.codes).toBe(1);
  state.codeSeconds = 180;
  await page.getByRole('button', { name: '새 코드 발급', exact: true }).click();
  await expect(page.locator('.code-number')).toHaveText('482193');
  expect(state.codes).toBe(2);
});

test('code response cannot leak across account changes and failure offers an explicit retry', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/mobile/code');
  state.failCode = true;
  await page.getByRole('button', { name: '이용 코드 발급', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('코드 발급 결과');
  expect(state.codes).toBe(1);
  state.failCode = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.code-number')).toHaveText('482193');
  state.userId = '99';
  state.name = '이서연';
  await page.evaluate(() => window.dispatchEvent(new Event('tagback-session')));
  await expect(page.locator('.code-number')).not.toHaveText('482193');
  expect(state.codes).toBe(2);
  await page.getByRole('button', { name: '이용 코드 발급', exact: true }).click();
  await expect(page.locator('.code-number')).toHaveText('679041');
});

test('guest login returns to the requested code screen and polling preserves typed input', async ({
  page,
}) => {
  const state = await fixture(page);
  state.signedIn = false;
  await page.goto('/mobile/code');
  await expect(page).toHaveURL(/login\?next=/);
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.evaluate(() => window.dispatchEvent(new Event('tagback-session')));
  await expect(page.getByLabel('전화번호', { exact: true })).toHaveValue('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await expect(page).toHaveURL(/\/mobile\/code$/);
  expect(state.codes).toBe(0);
});

test('catalog keeps search, distinguishes unavailable stock from request failure and opens direct details', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mobile/items');
  await page.getByLabel('물품명 검색').fill('계산기');
  await expect(page.locator('.uw-product')).toHaveCount(1);
  await page.locator('.uw-product').click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText(
    '공학용 계산기',
  );
  await page.getByRole('link', { name: '물품 상세 닫기' }).click();
  await expect(page.getByLabel('물품명 검색')).toHaveValue('계산기');
  await page.getByLabel('물품명 검색').fill('없는 물품');
  await expect(page.getByRole('heading', { name: '검색 결과가 없어요' })).toBeVisible();
  await page.getByRole('button', { name: '검색 초기화' }).click();
  await page.locator('.uw-product').filter({ hasText: '보조배터리' }).click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText(
    '현재 대여 불가',
  );
  await expect(
    page
      .getByRole('complementary', { name: '물품 상세' })
      .getByRole('link', { name: '이용 코드 발급' }),
  ).toHaveCount(0);
  state.failItems = true;
  await page.goto('/mobile/items');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('등록된 물품이 없어요')).toHaveCount(0);
  state.failItems = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.uw-product')).toHaveCount(3);
  await page.goto('/mobile/items/1');
  await expect(page.getByRole('heading', { name: '공학용 계산기' })).toBeVisible();
});

test('server overdue, direct rental history, return-month filter and logout stay consistent', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/mobile/rentals');
  await expect(page.locator('.uw-rental-row').filter({ hasText: '우산' })).toContainText(
    '반납 기한 초과',
  );
  await page.goto('/mobile/rentals/11');
  await expect(page.getByRole('complementary', { name: '대여 상세' })).toContainText(
    '반납은 키오스크에서',
  );
  await expect(page.getByRole('button', { name: '반납 확정' })).toHaveCount(0);
  await page.goto('/mobile/history/13');
  await expect(page.getByRole('complementary', { name: '대여 상세' })).toContainText('반납 완료');
  await page.getByRole('link', { name: '대여 상세 닫기' }).click();
  await page.getByLabel('반납 월').selectOption('2026-11');
  await expect(page.locator('.uw-rental-row')).toHaveCount(1);
  await page.getByLabel('물품 검색', { exact: true }).fill('없음');
  await expect(page.getByRole('heading', { name: '조건에 맞는 기록이 없어요' })).toBeVisible();
  await page.goto('/mobile/account');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '필요한 물품을 가볍게 빌려보세요' }),
  ).toBeVisible();
  await expect(page.getByText('김민준님')).toHaveCount(0);
});

test('approved screens and signup reflow without horizontal overflow from 320 to 1440 pixels', async ({
  page,
}) => {
  test.setTimeout(90000);
  const state = await fixture(page);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/mobile',
      '/mobile/items',
      '/mobile/items?item=1',
      '/mobile/rentals/11',
      '/mobile/history',
      '/mobile/account',
      '/mobile/code',
    ]) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.loading')).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${width} ${path}`,
      ).toBe(true);
      if (
        (width === 390 || width === 1440) &&
        ['/mobile', '/mobile/items', '/mobile/rentals/11', '/mobile/account'].includes(path)
      ) {
        await page.screenshot({
          path: `test-results/user-web-${width}-${path.replaceAll('/', '-')}.png`,
          fullPage: true,
        });
      }
    }
  }
  state.signedIn = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mobile/signup');
  await expect(page.getByLabel('이름', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/user-web-auth.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
