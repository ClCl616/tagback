import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
function sql(statement: string) {
  const container = process.env.TAGBACK_TEST_CONTAINER;
  if (!container)
    throw new Error('Set TAGBACK_TEST_CONTAINER to an isolated PostgreSQL test container.');
  return execFileSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'tagback_live_test',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}
test('real database: admin authorization, item CRUD, tag retry, state history, and uncertain creation', async ({
  page,
  context,
}) => {
  const phone = '010' + String(Date.now()).slice(-8);
  const request = context.request;
  const sms = await request.post('/api/v1/auth/sms/requests', {
    data: { phoneNumber: phone, purpose: 'SIGNUP' },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(sms.ok(), await sms.text()).toBeTruthy();
  const { requestId } = await sms.json();
  const delivered = await request.get(`/api/v1/dev/sms/requests/${requestId}`);
  const { code } = await delivered.json();
  const verify = await request.post('/api/v1/auth/sms/verifications', {
    data: { requestId, code },
  });
  const { verificationToken } = await verify.json();
  const signup = await request.post('/api/v1/auth/signup', {
    data: {
      verificationToken,
      pin: '048259',
      profile: { name: '실연동 검증', occupation: '학생' },
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(signup.status(), await signup.text()).toBe(201);
  expect((await request.get('/api/items/1/tag')).status()).toBe(403);
  await page.goto('/admin/items');
  await expect(page.getByRole('alert')).toContainText('관리자 계정');
  sql(`update users set role='ADMIN' where phone_number='+82${phone.slice(1)}'`);
  const typeId = sql(
    `insert into item_types(name) values ('실연동 종류-${Date.now()}') returning item_type_id`,
  ).split('\n')[0];
  const login = await request.post('/api/v1/auth/login/phone', {
    data: { phoneNumber: phone, pin: '048259' },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '물품 등록', exact: true });
  const name = '연동물품-' + Date.now();
  await dialog.getByLabel('물품명', { exact: true }).fill(name);
  await dialog.getByLabel('물품 종류', { exact: true }).selectOption(typeId);
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog).toHaveCount(0);
  const id = sql(`select item_id from items where item_name='${name}'`);
  expect(sql(`select status from items where item_id=${id}`)).toBe('TAG_PENDING');
  expect((await request.get(`/api/items/${id}/tag`)).status()).toBe(200);
  await page.getByRole('button', { name: name + ' 상세 보기', exact: true }).click();
  await page.getByRole('button', { name: /물품 수정/ }).click();
  dialog = page.getByRole('dialog', { name: '물품 수정', exact: true });
  await dialog.getByLabel('물품명', { exact: true }).fill(name + '-수정');
  const uid = '04' + Date.now().toString(16).slice(-12).padStart(12, '0').toUpperCase();
  await dialog.getByLabel('NFC 태그 UID', { exact: true }).fill(uid);
  await dialog.getByRole('button', { name: '변경사항 저장' }).click();
  await expect(dialog).toHaveCount(0);
  expect(sql(`select status from items where item_id=${id}`)).toBe('AVAILABLE');
  expect((await request.post(`/api/items/${id}/tag`, { data: { uid } })).status()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: name + '-수정 상세 보기', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText(uid);
  await page.getByRole('button', { name: '상태 변경', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '상태 변경', exact: true });
  await dialog.getByLabel('변경할 상태').selectOption('inspection');
  await dialog.getByLabel('변경 사유').fill('실연동 점검');
  await dialog.getByRole('button', { name: '상태 저장' }).click();
  await expect(dialog).toHaveCount(0);
  expect(sql(`select status from items where item_id=${id}`)).toBe('INSPECTION');
  expect(
    sql(`select count(*) from item_status_history where item_id=${id} and reason='실연동 점검'`),
  ).toBe('1');
  await page.getByRole('button', { name: name + '-수정 상세 보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '물품 삭제', exact: true })).toBeDisabled();
  expect((await request.delete('/api/v1/items/' + id)).ok()).toBeFalsy();
  const disposable = await request.post('/api/v1/items', {
    data: { itemName: name + '-삭제', itemTypeId: typeId },
  });
  const disposableId = (await disposable.json()).itemId;
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.getByRole('button', { name: name + '-삭제 상세 보기', exact: true }).click();
  await page.getByRole('button', { name: '물품 삭제', exact: true }).click();
  await page.getByRole('button', { name: '삭제 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(sql(`select count(*) from items where item_id=${disposableId}`)).toBe('0');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '물품 등록', exact: true });
  await dialog.getByLabel('물품명', { exact: true }).fill(name + '-태그재시도');
  await dialog.getByLabel('물품 종류', { exact: true }).selectOption(typeId);
  await dialog.getByLabel('NFC 태그 UID', { exact: true }).fill(uid);
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByRole('button', { name: '태그 연결 재시도' })).toBeVisible();
  await dialog.getByLabel('NFC 태그 UID', { exact: true }).fill('05' + uid.slice(2));
  await dialog.getByRole('button', { name: '태그 연결 재시도' }).click();
  await expect(dialog).toHaveCount(0);
  expect(sql(`select count(*) from items where item_name='${name}-태그재시도'`)).toBe('1');
  expect(sql(`select status from items where item_name='${name}-태그재시도'`)).toBe('AVAILABLE');
  await page.route('**/api/v1/items', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort();
  });
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '물품 등록', exact: true });
  await dialog.getByLabel('물품명', { exact: true }).fill(name + '-응답유실');
  await dialog.getByLabel('물품 종류', { exact: true }).selectOption(typeId);
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByRole('button', { name: '등록하기' })).toBeDisabled();
  expect(sql(`select count(*) from items where item_name='${name}-응답유실'`)).toBe('1');
  await page.unroute('**/api/v1/items');
  await page.reload();
  await page
    .getByRole('navigation', { name: '관리자 메뉴' })
    .getByRole('link', { name: '사용자', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '실연동 검증 상세 보기', exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-live/users.png', fullPage: true });
});
