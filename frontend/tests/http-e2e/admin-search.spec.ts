import { expect, test, type Page } from '@playwright/test';

async function mockAdminApi(page: Page) {
  const requests: URL[] = [];
  let fail = false;
  await page.route('**/api/v1/item-types', (route) =>
    route.fulfill({
      json: {
        itemTypes: [
          { itemTypeId: '1', itemTypeName: '우산' },
          { itemTypeId: '2', itemTypeName: '계산기' },
        ],
      },
    }),
  );
  await page.route('**/api/v1/admin/items?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (fail) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } });
    const pageNumber = Number(url.searchParams.get('page'));
    const filtered =
      url.searchParams.has('keyword') ||
      url.searchParams.has('status') ||
      url.searchParams.has('itemTypeId');
    const items =
      url.searchParams.get('keyword') === '없음'
        ? []
        : [
            {
              itemId: pageNumber ? '1' : '21',
              itemName: pageNumber ? '우산 1' : '우산 21',
              itemTypeId: '1',
              itemTypeName: '우산',
              status: 'TAG_PENDING',
              createdAt: '2026-11-06T00:00:00Z',
            },
          ];
    const total = items.length ? (filtered ? 1 : 21) : 0;
    return route.fulfill({
      json: {
        items,
        page: pageNumber,
        size: 20,
        totalElements: total,
        totalPages: Math.ceil(total / 20),
      },
    });
  });
  return {
    requests,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

test('서버 조회에서 조건을 조합하고 페이지를 초기화한다', async ({ page }) => {
  const api = await mockAdminApi(page);
  await page.goto('/admin/items');
  await expect(page.getByText('검색 결과 총 21개')).toBeVisible();
  await expect(page.getByRole('cell', { name: '태그 연결 대기' })).toBeVisible();
  await page.getByRole('button', { name: '우산 21 상세 보기' }).click();
  await expect(page.getByLabel('물품 상세').getByText('21', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('button', { name: '우산 1 상세 보기' })).toBeVisible();
  await page.getByLabel('물품 검색').fill('04:A1');
  await page.getByLabel('물품 종류 필터').selectOption('1');
  await page.getByLabel('물품 상태 필터').selectOption('AVAILABLE');
  await expect
    .poll(() => api.requests.at(-1)?.searchParams.toString())
    .toContain('status=AVAILABLE');
  const last = api.requests.at(-1)!.searchParams;
  expect(last.get('page')).toBe('0');
  expect(last.get('keyword')).toBe('04:A1');
  expect(last.get('itemTypeId')).toBe('1');
  expect(last.get('size')).toBe('20');
  await expect(page.getByText('검색 결과 총 1개')).toBeVisible();
  await expect(page.getByRole('button', { name: '다음', exact: true })).toBeDisabled();
  await page.getByLabel('물품 검색').fill('없음');
  await expect(page.getByText('조건에 맞는 물품이 없어요')).toBeVisible();
  await expect(page.getByText('검색 결과 총 0개')).toBeVisible();
  await page.getByRole('button', { name: '조건 초기화' }).click();
  await expect(page.getByText('검색 결과 총 21개')).toBeVisible();
  expect(api.requests.at(-1)!.searchParams.toString()).toBe('page=0&size=20');
  await page.setViewportSize({ width: 390, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('서버 오류를 표시하고 재시도한다', async ({ page }) => {
  const api = await mockAdminApi(page);
  api.setFail(true);
  await page.goto('/admin/items');
  await expect(page.getByRole('alert')).toContainText('불러오지 못했습니다');
  api.setFail(false);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('검색 결과 총 21개')).toBeVisible();
});

test('일반 사용자에게 관리자 권한 오류를 표시한다', async ({ page }) => {
  await page.route('**/api/v1/item-types', (route) => route.fulfill({ json: { itemTypes: [] } }));
  await page.route('**/api/v1/admin/items?*', (route) => route.fulfill({ status: 403, json: {} }));
  await page.goto('/admin/items');
  await expect(page.getByRole('alert')).toContainText('관리자 권한이 필요합니다');
});
