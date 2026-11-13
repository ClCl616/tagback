import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type BrowserContext } from '@playwright/test';

function sql(statement: string): string {
  if (!process.env.TAGBACK_TEST_CONTAINER) throw new Error('Isolated test container required');
  return execFileSync(
    'docker',
    [
      'exec',
      process.env.TAGBACK_TEST_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'tagback_live_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}

async function signup(context: BrowserContext, phoneNumber: string) {
  const request = context.request;
  const sms = await request.post('/api/v1/auth/sms/requests', {
    data: { phoneNumber, purpose: 'SIGNUP' },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(sms.ok(), await sms.text()).toBeTruthy();
  const { requestId } = await sms.json();
  const delivered = await request.get(`/api/v1/dev/sms/requests/${requestId}`);
  expect(delivered.ok(), await delivered.text()).toBeTruthy();
  const { code } = await delivered.json();
  const verified = await request.post('/api/v1/auth/sms/verifications', {
    data: { requestId, code },
  });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const { verificationToken } = await verified.json();
  const created = await request.post('/api/v1/auth/signup', {
    data: {
      verificationToken,
      pin: '048259',
      profile: { name: '조회 테스트', occupation: '학생' },
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(created.status(), await created.text()).toBe(201);
}

test('실제 로그인과 PostgreSQL 데이터로 관리자 검색·필터·페이지·오류 복구를 검증한다', async ({
  browser,
}) => {
  const admin = await browser.newContext({
    baseURL: process.env.TAGBACK_LIVE_BASE_URL,
    ignoreHTTPSErrors: true,
  });
  const member = await browser.newContext({
    baseURL: process.env.TAGBACK_LIVE_BASE_URL,
    ignoreHTTPSErrors: true,
  });
  const anonymous = await browser.newContext({
    baseURL: process.env.TAGBACK_LIVE_BASE_URL,
    ignoreHTTPSErrors: true,
  });
  try {
    await signup(admin, '01070000021');
    await signup(member, '01070000022');
    sql("update users set role = 'ADMIN' where phone_number = '+821070000021'");
    sql(
      "insert into item_types(name) values ('Search umbrella'); " +
        "insert into items(item_type_id,item_name,status) select t.item_type_id, 'SearchUnit ' || n, 'TAG_PENDING' " +
        "from item_types t cross join generate_series(1, 21) n where t.name='Search umbrella'; " +
        "insert into nfc_tags(item_id,tag_uid) select item_id,'04AABBCC' from items where item_name='SearchUnit 1'; " +
        "update items set status='AVAILABLE' where item_name='SearchUnit 1'",
    );

    const login = await admin.request.post('/api/v1/auth/login/phone', {
      data: { phoneNumber: '01070000021', pin: '048259' },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    expect((await member.request.get('/api/v1/admin/items')).status()).toBe(403);
    expect((await anonymous.request.get('/api/v1/admin/items')).status()).toBe(401);
    const catalog = await anonymous.request.get('/api/v1/catalog/item-types?keyword=SearchUnit%2021');
    expect(catalog.status()).toBe(200);
    const { itemTypes } = await catalog.json();
    expect(itemTypes).toHaveLength(1);
    expect(itemTypes[0]).toEqual({
      itemTypeId: expect.any(String),
      itemTypeName: 'Search umbrella',
      totalCount: 21,
      availableCount: 1,
    });
    const detail = await anonymous.request.get(
      '/api/v1/catalog/item-types/' + itemTypes[0].itemTypeId,
    );
    expect(await detail.json()).toEqual(itemTypes[0]);
    expect(
      (await anonymous.request.get('/api/v1/catalog/item-types/9223372036854775807')).status(),
    ).toBe(404);
    const publicPage = await anonymous.newPage();
    await publicPage.goto('/mobile/items?q=SearchUnit%2021');
    await expect(publicPage.getByText('Search umbrella', { exact: true })).toBeVisible();
    await publicPage.goto('/mobile/items/' + itemTypes[0].itemTypeId);
    await expect(publicPage.getByText('1개 / 전체 21개', { exact: true })).toBeVisible();
    const page = await admin.newPage();
    await page.goto('/admin/items');
    await page.getByLabel('물품 종류 필터').selectOption({ label: 'Search umbrella' });
    await expect(page.getByText('총 21개 물품')).toBeVisible();
    const memberPage = await member.newPage();
    await memberPage.goto('/admin/items');
    await expect(memberPage.getByRole('alert')).toContainText('관리자 계정으로 로그인');
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto('/admin/items');
    await expect(anonymousPage.getByRole('alert')).toContainText('로그인이 필요합니다');
    expect(
      await page.evaluate(async () => (await fetch('/api/v1/admin/items?status=invalid')).status),
    ).toBe(400);
    expect(
      await memberPage.evaluate(async () => (await fetch('/api/v1/items?keyword=Umbrella')).status),
    ).toBe(200);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByText('2 / 2')).toBeVisible();
    await page.getByLabel('물품 검색', { exact: true }).fill('04:aa');
    await page.getByLabel('물품 종류 필터').selectOption({ label: 'Search umbrella' });
    await page.getByLabel('상태 필터').selectOption('available');
    await expect(page.getByText('총 1개 물품')).toBeVisible();
    await expect(page.getByRole('button', { name: 'SearchUnit 1 상세 보기' })).toBeVisible();
    await expect(page.getByText('1 / 1')).toBeVisible();
    await page.getByLabel('물품 검색', { exact: true }).fill('결과 없음');
    await expect(page.getByText('조건에 맞는 물품이 없어요')).toBeVisible();
    await page.getByLabel('물품 검색', { exact: true }).fill('');
    await page.getByLabel('상태 필터').selectOption('');
    await expect(page.getByText('총 21개 물품')).toBeVisible();

    await page.route('**/api/v1/admin/items?*', (route) => route.abort());
    await page.getByRole('button', { name: '새로고침' }).click();
    await expect(page.getByRole('alert')).toContainText('연결하지 못했습니다');
    await page.unroute('**/api/v1/admin/items?*');
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(page.getByText('총 21개 물품')).toBeVisible();
  } finally {
    await admin.close();
    await member.close();
    await anonymous.close();
  }
});
