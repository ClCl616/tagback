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
    if (url.pathname.endsWith('/kakao/pending'))
      return route.fulfill({ json: { needsSignup: true, nickname: '김민준', next: '/mobile' } });
    if (url.pathname.endsWith('/kakao/start')) {
      const next = route.request().postDataJSON().next;
      await page.route('https://kauth.kakao.com/**', async (provider) => {
        state.signedIn = true;
        await provider.fulfill({
          status: 302,
          headers: { Location: 'http://localhost:5175' + next },
        });
      });
      return route.fulfill({
        json: { url: 'https://kauth.kakao.com/oauth/authorize?state=fixture' },
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
    if (url.pathname.startsWith('/api/v1/catalog/item-types')) {
      if (state.failItems) return route.abort();
      const keyword = (url.searchParams.get('keyword') || '').toLowerCase();
      const kinds = [...new Set(items.map((i) => i.itemTypeId))]
        .map((id) => {
          const group = items.filter((i) => i.itemTypeId === id);
          return {
            itemTypeId: id,
            itemTypeName: group[0].itemTypeName,
            totalCount: group.length,
            availableCount: group.filter((i) => i.status === 'AVAILABLE').length,
          };
        })
        .filter((k) =>
          items.some(
            (i) =>
              i.itemTypeId === k.itemTypeId &&
              (i.itemName + ' ' + i.itemTypeName).toLowerCase().includes(keyword),
          ),
        );
      const id = url.pathname.split('/')[5];
      if (id) {
        const kind = kinds.find((k) => k.itemTypeId === id);
        return route.fulfill({
          status: kind ? 200 : 404,
          json: kind || { error: { code: 'ITEM_TYPE_NOT_FOUND' } },
        });
      }
      return route.fulfill({ json: paged('itemTypes', kinds) });
    }
    if (url.pathname.endsWith('/items'))
      return state.failItems
        ? route.abort()
        : route.fulfill({
            json: paged(
              'items',
              items.filter((i) =>
                (i.itemName + ' ' + i.itemTypeName).includes(url.searchParams.get('keyword') || ''),
              ),
            ),
          });
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
      if (route.request().method() === 'POST') state.codes++;
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

test('code appears automatically and polling synchronizes it without reissuing on focus', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/mobile');
  await expect(page.locator('.code-number')).toHaveText('482193');
  expect(state.codes).toBe(1);
  await expect(page.getByRole('button', { name: '이용 코드 발급', exact: true })).toHaveCount(0);
  await expect(page.getByText('남은 시간')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.code-number')).toHaveText('482193');
  expect(state.codes).toBe(1);
  await page.reload();
  await expect(page.locator('.code-number')).toHaveText('482193');
  expect(state.codes).toBe(2);
});

test('code response cannot leak across account changes and failure offers an explicit retry', async ({
  page,
}) => {
  const state = await fixture(page);
  state.failCode = true;
  await page.goto('/mobile/code');
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
  await expect(page.locator('.code-number')).toHaveText('679041');
});

test('guest login returns to the requested code screen and polling preserves typed input', async ({
  page,
}) => {
  const state = await fixture(page);
  state.signedIn = false;
  await page.goto('/mobile/code');
  await expect(page).toHaveURL(/login\?next=/);
  await page.getByRole('button', { name: '카카오 로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/code$/);
  await expect(page.locator('.code-number')).toHaveText('482193');
  expect(state.codes).toBe(1);
});

test('catalog keeps search, distinguishes unavailable stock from request failure and opens direct details', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mobile/items');
  await page.getByLabel('물품명 검색').fill('계산기');
  await expect(page.locator('.uw-product')).toHaveCount(2);
  await page.locator('.uw-product').first().click();
  await expect(page.getByRole('dialog', { name: '물품 상세' })).toContainText('공학용 계산기');
  await page.getByRole('button', { name: '물품 상세 닫기' }).click();
  await expect(page.getByLabel('물품명 검색')).toHaveValue('계산기');
  await page.getByLabel('물품명 검색').fill('없는 물품');
  await expect(page.getByRole('heading', { name: '검색 결과가 없어요' })).toBeVisible();
  await page.getByRole('button', { name: '검색 초기화' }).click();
  await page.locator('.uw-product').filter({ hasText: '배터리 01' }).click();
  await expect(page.getByRole('dialog', { name: '물품 상세' })).toContainText('수리 중');
  await expect(
    page.getByRole('dialog', { name: '물품 상세' }).getByRole('link', { name: '이용 코드 발급' }),
  ).toHaveCount(0);
  state.failItems = true;
  await page.goto('/mobile/items');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('등록된 물품이 없어요')).toHaveCount(0);
  state.failItems = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.uw-product')).toHaveCount(4);
  await page.goto('/mobile/items/1');
  await expect(page.getByRole('heading', { name: '계산기 01' })).toBeVisible();
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
  await expect(page).toHaveURL(/\/mobile\/history$/);
  await page.getByLabel('반납 월').selectOption('2026-11');
  await expect(page.locator('.uw-rental-row')).toHaveCount(1);
  await page.getByLabel('물품 검색', { exact: true }).fill('계산기');
  await page.locator('.uw-rental-row').click();
  await expect(page.getByRole('complementary', { name: '대여 상세' })).toBeVisible();
  await page.getByRole('link', { name: '대여 상세 닫기' }).click();
  await expect(page).toHaveURL(/\/mobile\/history\?/);
  await expect(page.getByRole('complementary', { name: '대여 상세' })).toHaveCount(0);
  await expect(page.getByLabel('물품 검색', { exact: true })).toHaveValue('계산기');
  await expect(page.getByLabel('반납 월')).toHaveValue('2026-11');
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
      '/mobile/rentals',
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
        [
          '/mobile',
          '/mobile/items',
          '/mobile/rentals',
          '/mobile/rentals/11',
          '/mobile/history',
          '/mobile/account',
        ].includes(path)
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
  await expect(page.getByLabel('닉네임', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/user-web-auth.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('mobile basic pages fit the viewport and lists scroll inside the frame', async ({ page }) => {
  test.setTimeout(90000);
  const state = await fixture(page);
  for (const size of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(size);
    for (const path of [
      '/mobile',
      '/mobile/code',
      '/mobile/account',
      '/mobile/items',
      '/mobile/rentals',
      '/mobile/history',
    ]) {
      await page.goto(path);
      await expect(page.locator('.loading')).toHaveCount(0);
      await expect(page.locator('h1')).toBeVisible();
      const dimensions = await page.locator('.uw-main').evaluate((el) => ({
        scroll: el.scrollHeight,
        client: el.clientHeight,
        document: document.documentElement.scrollHeight,
        viewport: innerHeight,
      }));
      expect(dimensions.document, `${size.width} ${path} document`).toBeLessThanOrEqual(
        dimensions.viewport + 1,
      );
      expect(dimensions.scroll, `${size.width} ${path} main`).toBeLessThanOrEqual(
        dimensions.client + 1,
      );
      if (size.width === 375 && ['/mobile', '/mobile/code', '/mobile/account'].includes(path))
        await page.screenshot({ path: `test-results/viewport-${path.replaceAll('/', '-')}.png` });
    }
  }
  state.signedIn = false;
  for (const path of ['/mobile', '/mobile/login', '/mobile/signup', '/mobile/recover']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    expect(
      await page.locator('.uw-main').evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      path,
    ).toBe(true);
  }
  await page.goto('/mobile/login');
  await expect(page.getByRole('button', { name: '카카오 로그인', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/viewport-oauth.png' });
  await page.setViewportSize({ width: 375, height: 360 });
  const submit = page.getByRole('button', { name: '카카오 로그인', exact: true });
  await submit.scrollIntoViewIfNeeded();
  const box = await submit.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(361);
});

test('long lists keep navigation fixed and restore the list after browser back', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/catalog/item-types?**', (route) =>
    route.fulfill({
      json: {
        itemTypes: Array.from({ length: 30 }, (_, i) => ({
          itemTypeId: String(i + 1),
          itemTypeName: `물품 ${i + 1}`,
          totalCount: 2,
          availableCount: 1,
        })),
        page: 0,
        size: 100,
        totalElements: 30,
        totalPages: 1,
      },
    }),
  );
  await page.route('**/api/v1/catalog/items?**', (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 30 }, (_, i) => ({
          itemId: String(i + 1),
          itemName: `물품 ${i + 1}`,
          itemTypeId: String(i + 1),
          itemTypeName: `물품 ${i + 1}`,
          status: 'AVAILABLE',
        })),
        page: 0,
        size: 100,
        totalElements: 30,
        totalPages: 1,
      },
    }),
  );
  await page.goto('/mobile/items');
  await expect(page.locator('.uw-product')).toHaveCount(30);
  const list = page.locator('.uw-products');
  const header = await page.locator('.uw-header').boundingBox();
  const nav = await page.locator('.uw-bottom-nav').boundingBox();
  await list.evaluate((el) => {
    el.scrollTop = 1000;
  });
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(900);
  expect(await page.locator('.uw-header').boundingBox()).toEqual(header);
  expect(await page.locator('.uw-bottom-nav').boundingBox()).toEqual(nav);
  expect(
    await page.locator('.uw-main').evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
  const link = list.locator('a').nth(10);
  await link.scrollIntoViewIfNeeded();
  // Pointer focus may scroll the link again on Linux. Restore the position at
  // navigation, not the position before the browser has dispatched the click.
  await list.evaluate((el) => {
    el.addEventListener(
      'click',
      () => sessionStorage.setItem('test-list-navigation-position', String(el.scrollTop)),
      { capture: true, once: true },
    );
  });
  await link.click();
  await expect(page.getByLabel('물품 상세', { exact: true })).toBeVisible();
  const position = Number(
    await page.evaluate(() => sessionStorage.getItem('test-list-navigation-position')),
  );
  expect(position).toBeGreaterThan(0);
  await page.goBack();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(position);
  await page.screenshot({ path: 'test-results/mobile-internal-list.png' });
});

test('rental and history lists scroll independently, with enlarged text still reachable', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route('**/api/v1/rentals/me?**', (route) => {
    const history = new URL(route.request().url()).searchParams.get('scope') === 'HISTORY';
    const rentals = Array.from({ length: 30 }, (_, i) => ({
      rentalId: String((history ? 100 : 1) + i),
      itemId: String(i + 1),
      itemName: `계산기 ${i + 1}`,
      itemTypeName: '공학용 계산기',
      overdue: false,
      rentedAt: '2026-11-01T05:00:00Z',
      dueAt: '2026-11-04T05:00:00Z',
      returnedAt: history ? '2026-11-02T05:00:00Z' : null,
    }));
    return route.fulfill({
      json: { rentals, page: 0, size: 100, totalElements: 30, totalPages: 1 },
    });
  });
  for (const path of ['/mobile/rentals', '/mobile/history']) {
    await page.goto(path);
    await expect(page.locator('.uw-rental-row')).toHaveCount(30);
    const list = page.locator('.uw-rental-list');
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(
      await page.locator('.uw-main').evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
    const last = await list.locator('a').last().boundingBox();
    const nav = await page.locator('.uw-bottom-nav').boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(nav!.y);
  }
  await page.goto('/mobile/account');
  await page.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px';
  });
  const logout = page.getByRole('button', { name: '로그아웃', exact: true });
  await logout.scrollIntoViewIfNeeded();
  const button = await logout.boundingBox();
  const nav = await page.locator('.uw-bottom-nav').boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(nav!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('catalog sheet traps focus, closes with Escape and keeps filters; desktop uses a panel', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mobile/items?q=계산기');
  const card = page.locator('.uw-product').first();
  await card.click();
  const sheet = page.getByRole('dialog', { name: '물품 상세', exact: true });
  await expect(sheet).toBeVisible();
  await expect(page.locator('.uw-products')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: 'test-results/catalog-mobile-sheet.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '물품명 검색' })).toHaveValue('계산기');
  await expect(card).toBeFocused();
  await page.goto('/mobile/items?q=계산기&item=1');
  await expect(sheet).toBeVisible();
  await page.getByRole('button', { name: '물품 상세 닫기' }).click();
  await expect(page).toHaveURL(/\/mobile\/items\?q=/);
  expect(new URL(page.url()).searchParams.has('item')).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await page.screenshot({ path: 'test-results/catalog-desktop-panel.png' });
});

test('background catalog refresh preserves the open sheet and recovers without replacing the list', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mobile/items');
  await page.locator('.uw-product').first().click();
  const sheet = page.getByRole('dialog', { name: '물품 상세', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.evaluate((el) => el.setAttribute('data-original', 'yes'));
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route('**/api/v1/catalog/item-types?**', async (route) => {
    started = true;
    await barrier;
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => started).toBe(true);
  await expect(sheet).toHaveAttribute('data-original', 'yes');
  await expect(page.locator('.uw-product')).toHaveCount(4);
  release();
  await expect(page.getByText('최신 정보를 확인하고 있어요.', { exact: true })).toHaveCount(0);
  await expect(sheet).toHaveAttribute('data-original', 'yes');
  await page.getByRole('button', { name: '물품 상세 닫기' }).click();
  await expect(sheet).toHaveCount(0);
  state.failItems = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/이전 조회 내용을 표시하고 있어요/)).toBeVisible();
  await expect(page.locator('.uw-product')).toHaveCount(4);
  state.failItems = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText(/이전 조회 내용을 표시하고 있어요/)).toHaveCount(0);
  await page.getByLabel('물품명 검색', { exact: true }).fill('없는물품');
  await expect(page.getByRole('heading', { name: '검색 결과가 없어요' })).toBeVisible();
  await expect(page.locator('.uw-product')).toHaveCount(0);
});
