import { test, expect, type Page } from '@playwright/test';

async function mockServer(page: Page, role = 'ADMIN') {
  const requests: string[] = [];
  const date = '2026-11-06T03:00:00Z';
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          userId: '1',
          name: '운영자',
          occupation: null,
          role,
          maskedPhoneNumber: '010-****-0000',
        },
        sessionExpiresAt: '2030-01-01T00:00:00Z',
      },
    }),
  );
  await page.route(/\/api\/v1\/(items|admin\/(users|rentals))\?/, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const key = url.pathname.split('/').at(-1)!;
    const index = Number(url.searchParams.get('page'));
    let rows: unknown[];
    if (key === 'items')
      rows = Array.from({ length: 105 }, (_, i) => ({
        itemId: String(i + 1),
        itemName: `물품 ${i + 1}`,
        itemTypeName: '장비',
        status: i === 104 ? 'TAG_PENDING' : 'AVAILABLE',
      }));
    else if (key === 'users')
      rows = [{ userId: '1', name: '테스트 사용자', occupation: '학생', role: 'USER' }];
    else
      rows = ['RENTED', 'OVERDUE', 'RETURNED'].map((status, i) => ({
        rentalId: String(i + 1),
        userId: '1',
        userName: '테스트 사용자',
        itemId: String(i + 1),
        itemName: `물품 ${i + 1}`,
        rentalStatus: status,
        rentedAt: date,
        dueAt: date,
        returnedAt: status === 'RETURNED' ? date : null,
        overdue: status !== 'RENTED',
      }));
    await route.fulfill({
      json: {
        [key]: rows.slice(index * 100, index * 100 + 100),
        page: index,
        size: 100,
        totalElements: rows.length,
        totalPages: Math.ceil(rows.length / 100),
      },
    });
  });
  return requests;
}
test('global search includes later server pages, filters reset pagination, and cards agree with results', async ({
  page,
}) => {
  const requests = await mockServer(page);
  await page.goto('/admin');
  await expect(page.getByText('검색 결과 105건 / 전체 105건')).toBeVisible();
  expect(requests.some((r) => r.includes('items?page=1'))).toBeTruthy();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByText('2 / 6 페이지')).toBeVisible();
  await page.getByLabel('검색', { exact: true }).fill('물품 105');
  await expect(page.getByRole('cell', { name: '물품 105', exact: true })).toBeVisible();
  await expect(page.getByText('1 / 1 페이지')).toBeVisible();
  await page.getByLabel('상태', { exact: true }).selectOption('AVAILABLE');
  await expect(page.getByText('조건에 맞는 결과가 없습니다.')).toBeVisible();
  await page.getByRole('button', { name: '조건 초기화' }).click();
  await page
    .getByRole('region', { name: '전체 현황' })
    .getByRole('button', { name: '대여 중 2' })
    .click();
  await expect(page.getByText('검색 결과 2건 / 전체 3건')).toBeVisible();
  await page.getByLabel('상태', { exact: true }).selectOption('RETURNED');
  await expect(page.getByText('연체 반납', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '관리자 메뉴' })
    .getByRole('button', { name: '사용자 관리', exact: true })
    .click();
  await expect(page.getByRole('cell', { name: '테스트 사용자', exact: true })).toBeVisible();
});
test('ordinary users never request administrator data', async ({ page }) => {
  const requests = await mockServer(page, 'USER');
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toContainText('관리자 계정으로 로그인');
  expect(requests).toEqual([]);
});
test('expired session clears displayed data and retry recovers', async ({ page }) => {
  await mockServer(page);
  await page.goto('/admin');
  await expect(page.getByText('검색 결과 105건 / 전체 105건')).toBeVisible();
  await page.route('**/api/v1/admin/users?**', (route) => route.fulfill({ status: 401, json: {} }));
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('로그인이 만료');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.unroute('**/api/v1/admin/users?**');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('검색 결과 105건 / 전체 105건')).toBeVisible();
});
test('partial responses are rejected and narrow layout stays within viewport', async ({ page }) => {
  await mockServer(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await expect(page.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/admin-records-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/admin-records-desktop.png', fullPage: true });
  await page.route('**/api/v1/items?**', (route) =>
    route.fulfill({
      json: {
        items: [],
        page: 0,
        size: 100,
        totalElements: 105,
        totalPages: 2,
      },
    }),
  );
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('조회 결과를 확인하지 못했습니다');
  await expect(page.getByRole('table')).toHaveCount(0);
});
