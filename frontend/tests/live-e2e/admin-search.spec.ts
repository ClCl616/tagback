import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type BrowserContext } from '@playwright/test';

function sql(statement: string): string {
  return execFileSync(process.env.TAGBACK_LIVE_PSQL!, [
    '-h', '127.0.0.1', '-p', process.env.TAGBACK_LIVE_DB_PORT!, '-U', 'postgres',
    '-d', 'tagback_live_test', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', statement,
  ], { encoding: 'utf8' }).trim();
}

async function signup(context: BrowserContext, phoneNumber: string) {
  const request = context.request;
  const sms = await request.post('/api/v1/auth/sms/requests', {
    data: { phoneNumber, purpose: 'SIGNUP' }, headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(sms.ok(), await sms.text()).toBeTruthy();
  const { requestId } = await sms.json();
  const delivered = await request.get(`/api/v1/dev/sms/requests/${requestId}`);
  expect(delivered.ok(), await delivered.text()).toBeTruthy();
  const { code } = await delivered.json();
  const verified = await request.post('/api/v1/auth/sms/verifications', { data: { requestId, code } });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const { verificationToken } = await verified.json();
  const created = await request.post('/api/v1/auth/signup', {
    data: { verificationToken, pin: '048259', profile: { name: '조회 테스트', occupation: '학생' } },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(created.status(), await created.text()).toBe(201);
}

test('실제 로그인과 PostgreSQL 데이터로 관리자 검색·필터·페이지·오류 복구를 검증한다', async ({ browser }) => {
  const admin = await browser.newContext({ baseURL: 'http://127.0.0.1:5182' });
  const member = await browser.newContext({ baseURL: 'http://127.0.0.1:5182' });
  const anonymous = await browser.newContext({ baseURL: 'http://127.0.0.1:5182' });
  try {
    await signup(admin, '01070000011');
    await signup(member, '01070000012');
    sql("update users set role = 'ADMIN' where phone_number = '+821070000011'");
    sql("insert into item_types(name) values ('Live umbrella'); " +
      "insert into items(item_type_id,item_name,status) select t.item_type_id, 'Umbrella ' || n, 'TAG_PENDING' " +
      "from item_types t cross join generate_series(1, 21) n where t.name='Live umbrella'; " +
      "insert into nfc_tags(item_id,tag_uid) select item_id,'04AABBCC' from items where item_name='Umbrella 1'; " +
      "update items set status='AVAILABLE' where item_name='Umbrella 1'");

    const page = await admin.newPage();
    await page.goto('/admin/items');
    await expect(page.getByText('검색 결과 총 22개')).toBeVisible();
    const memberPage = await member.newPage();
    await memberPage.goto('/admin/items');
    await expect(memberPage.getByRole('alert')).toContainText('관리자 권한이 필요합니다');
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto('/admin/items');
    await expect(anonymousPage.getByRole('alert')).toContainText('관리자 계정으로 로그인해 주세요');
    expect(await page.evaluate(async () => (await fetch('/api/v1/admin/items?status=invalid')).status)).toBe(400);
    expect(await memberPage.evaluate(async () => (await fetch('/api/v1/items?keyword=Umbrella')).status)).toBe(200);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByText('2 / 2페이지')).toBeVisible();
    await page.getByLabel('물품 검색').fill('04:aa');
    await page.getByLabel('물품 종류 필터').selectOption({ label: 'Live umbrella' });
    await page.getByLabel('물품 상태 필터').selectOption('AVAILABLE');
    await expect(page.getByText('검색 결과 총 1개')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Umbrella 1 상세 보기' })).toBeVisible();
    await expect(page.getByText('1 / 1페이지')).toBeVisible();
    await page.getByLabel('물품 검색').fill('결과 없음');
    await expect(page.getByText('조건에 맞는 물품이 없어요')).toBeVisible();
    await page.getByRole('button', { name: '조건 초기화' }).click();
    await expect(page.getByText('검색 결과 총 22개')).toBeVisible();

    await page.route('**/api/v1/admin/items?*', (route) => route.abort());
    await page.getByRole('button', { name: '새로고침' }).click();
    await expect(page.getByRole('alert')).toContainText('연결하지 못했습니다');
    await page.unroute('**/api/v1/admin/items?*');
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(page.getByText('검색 결과 총 22개')).toBeVisible();
  } finally {
    await admin.close();
    await member.close();
    await anonymous.close();
  }
});
