import { expect, test, type Page } from '@playwright/test';

async function mockAdminApi(page: Page, role = 'ADMIN') {
  const requests: URL[] = [];
  let fail = false;
  const items = Array.from({ length: 21 }, (_, i) => ({
    itemId: String(i + 1),
    itemName: `우산 ${i + 1}`,
    itemTypeId: '1',
    itemTypeName: '우산',
    status: i === 0 ? 'AVAILABLE' : 'TAG_PENDING',
  }));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/session'))
      return route.fulfill({
        json: {
          authenticated: true,
          user: {
            userId: '1',
            name: '운영자',
            role,
            occupation: null,
            maskedPhoneNumber: '010-****-0000',
          },
          sessionExpiresAt: '2030-01-01T00:00:00Z',
        },
      });
    if (url.pathname.endsWith('/item-types'))
      return route.fulfill({ json: { itemTypes: [{ itemTypeId: '1', itemTypeName: '우산' }] } });
    const key = url.pathname.split('/').at(-1)!;
    let rows = key === 'items' ? items : [];
    if (url.pathname === '/api/v1/admin/items') {
      requests.push(url);
      if (fail) return route.fulfill({ status: 503, json: {} });
      const q = url.searchParams.get('keyword')?.toLowerCase();
      rows = rows.filter(
        (i) =>
          (!q || (i.itemName + (i.itemId === '1' ? ' 04:a1' : '')).toLowerCase().includes(q)) &&
          (!url.searchParams.has('status') || i.status === url.searchParams.get('status')),
      );
    }
    const index = Number(url.searchParams.get('page'));
    return route.fulfill({
      json: {
        [key]: rows.slice(index * 100, (index + 1) * 100),
        page: index,
        size: 100,
        totalElements: rows.length,
        totalPages: Math.ceil(rows.length / 100),
      },
    });
  });
  return {
    requests,
    setFail(value: boolean) {
      fail = value;
    },
  };
}

test('서버 조회에서 조건을 조합하고 페이지를 초기화한다', async ({ page }) => {
  const api = await mockAdminApi(page);
  await page.goto('/admin/items');
  await expect(page.getByText('총 21개 물품')).toBeVisible();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  await page.getByLabel('물품 검색', { exact: true }).fill('04:A1');
  await page.getByLabel('물품 종류 필터').selectOption('1');
  await page.getByLabel('상태 필터').selectOption('available');
  await expect(page.getByText('총 1개 물품')).toBeVisible();
  const last = api.requests.at(-1)!.searchParams;
  expect(last.get('page')).toBe('0');
  expect(last.get('keyword')).toBe('04:A1');
  expect(last.get('itemTypeId')).toBe('1');
  expect(last.get('status')).toBe('AVAILABLE');
  expect(last.get('size')).toBe('100');
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '우산 1 상세 보기', exact: true })).toBeVisible();
  await page.getByLabel('물품 검색', { exact: true }).fill('없음');
  await expect(page.getByText('조건에 맞는 물품이 없어요')).toBeVisible();
  await page.getByLabel('물품 검색', { exact: true }).fill('');
  await page.getByLabel('상태 필터').selectOption('');
  await expect(page.getByText('총 21개 물품')).toBeVisible();
});

test('서버 오류를 표시하고 재시도한다', async ({ page }) => {
  const api = await mockAdminApi(page);
  api.setFail(true);
  await page.goto('/admin/items');
  await expect(page.getByRole('alert')).toContainText('확인하지 못했습니다');
  api.setFail(false);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('총 21개 물품')).toBeVisible();
});

test('일반 사용자에게 관리자 권한 오류를 표시한다', async ({ page }) => {
  const api = await mockAdminApi(page, 'USER');
  await page.goto('/admin/items');
  await expect(page.getByRole('alert')).toContainText('관리자 계정으로 로그인');
  expect(api.requests).toHaveLength(0);
});
