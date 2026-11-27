import { test, expect, type Page } from '@playwright/test';

async function host(page: Page, lose = false) {
  await page.addInitScript(
    ({ lose }) => {
      let listener: ((read: any) => void) | undefined,
        lost = false;
      const calls: any[] = [];
      Object.assign(window, {
        adminCalls: calls,
        adminScan: () =>
          listener?.({
            uid: 'AABBCCDD',
            proof: {
              bridgeId: 'test',
              uid: 'AABBCCDD',
              issuedAt: Date.now(),
              nonce: crypto.randomUUID(),
              signature: 'a'.repeat(64),
            },
          }),
        tagbackKioskHost: {
          version: 2,
          platform: 'windows',
          capabilities: { transport: 1 },
          reader: {
            subscribe(next: any, options: any) {
              listener = next;
              options.onStatus('connected');
              return () => {
                listener = undefined;
              };
            },
          },
          async request(message: any) {
            const c = message.command;
            calls.push(c);
            let data: any = null,
              status = 200;
            switch (c.action) {
              case 'admin-login':
                if (c.password !== 'test-admin-password') {
                  status = 401;
                  data = { error: { message: '관리자 비밀번호가 일치하지 않습니다.' } };
                  break;
                }
                data = {
                  adminHandle: 'opaque-admin',
                  sessionId: 'shared-session',
                  expiresAt: new Date(Date.now() + 600000).toISOString(),
                  adminNumber: '000',
                  name: '대표 관리자',
                  mustChangePassword: false,
                };
                break;
              case 'admin-api': {
                const path = c.path.split('?')[0];
                const items = [
                  {
                    itemId: '1',
                    itemTypeId: '1',
                    itemName: '새 우산',
                    itemTypeName: '우산',
                    status: 'TAG_PENDING',
                  },
                  {
                    itemId: '2',
                    itemTypeId: '1',
                    itemName: '대여 중 우산',
                    itemTypeName: '우산',
                    status: 'RENTED',
                  },
                ];
                if (path.endsWith('/auth/session'))
                  data = {
                    sessionId: 'shared-session',
                    channel: 'KIOSK',
                    expiresAt: new Date(Date.now() + 600000).toISOString(),
                    adminNumber: '000',
                    name: '대표 관리자',
                    mustChangePassword: false,
                  };
                else if (path === '/api/v1/item-types')
                  data = { itemTypes: [{ itemTypeId: '1', itemTypeName: '우산' }] };
                else if (path === '/api/v1/items/1') data = items[0];
                else if (path === '/api/items/1/tag') data = { tag: null };
                else {
                  const key = path.endsWith('/users')
                    ? 'users'
                    : path.endsWith('/rentals')
                      ? 'rentals'
                      : 'items';
                  const rows = key === 'items' ? items : [];
                  data = {
                    [key]: rows,
                    page: 0,
                    size: 100,
                    totalElements: rows.length,
                    totalPages: rows.length ? 1 : 0,
                  };
                }
                break;
              }
              case 'admin-tag':
                if (lose && !lost) {
                  lost = true;
                  throw Error('lost response');
                }
                data = { itemId: c.itemId, uid: c.proof.uid, status: 'AVAILABLE' };
                break;
              case 'admin-logout':
                status = 204;
                break;
            }
            return { version: 2, requestId: message.requestId, status, data };
          },
        },
      });
    },
    { lose },
  );
  await page.goto('/kiosk-app.html');
  for (let i = 0; i < 5; i++) await page.locator('.kiosk-brand-button').click();
}
async function login(page: Page) {
  await page.getByLabel('관리자 번호').fill('000');
  await page.getByLabel('비밀번호', { exact: true }).fill('test-admin-password');
  await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '물품 대시보드' })).toBeVisible();
  await page
    .getByRole('navigation', { name: '관리자 메뉴' })
    .getByRole('link', { name: '물품 관리', exact: true })
    .click();
}
test('kiosk authenticates separately and only physical scan enables tag connection', async ({
  page,
}) => {
  await host(page);
  await expect(page.getByRole('button', { name: /대여하기/ })).toHaveCount(0);
  await page.getByLabel('관리자 번호').fill('000');
  await page.getByLabel('비밀번호', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: '관리자 로그인' }).click();
  await expect(page.getByRole('alert')).toContainText('일치하지');
  await expect(page.getByLabel('비밀번호', { exact: true })).toHaveValue('wrong');
  await login(page);
  await expect(page.getByRole('button', { name: /대여 중 우산/ })).toBeVisible();
  await page.getByRole('button', { name: /새 우산/ }).click();
  await page.getByRole('button', { name: 'NFC 태그 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '태그 연결 확정' })).toBeDisabled();
  await expect(page.getByLabel('NFC 태그 UID')).toHaveCount(0);
  await page.evaluate(() => (window as any).adminScan());
  await expect(page.getByText('새 태그: AABBCCDD')).toBeVisible();
  await page.screenshot({ path: 'test-results/kiosk-admin-tags.png', fullPage: true });
  await page.getByRole('button', { name: '태그 연결 확정' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '이용 화면으로' }).click();
  await expect(page.getByRole('button', { name: /대여하기/ })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).adminCalls);
  const write = calls.find((c: any) => c.action === 'admin-tag');
  expect(write.adminRef).toBe('opaque-admin');
  expect(write.proof.uid).toBe('AABBCCDD');
  expect(calls.filter((c: any) => c.action === 'admin-logout')).toHaveLength(1);
});
test('unknown tag reply keeps exact operation and proof and blocks leaving admin mode', async ({
  page,
}) => {
  await host(page, true);
  await login(page);
  await page.getByRole('button', { name: /새 우산/ }).click();
  await page.getByRole('button', { name: 'NFC 태그 등록', exact: true }).click();
  await page.evaluate(() => (window as any).adminScan());
  await page.getByRole('button', { name: '태그 연결 확정' }).click();
  await expect(
    page.getByText('결과가 확인될 때까지 다른 작업을 진행할 수 없습니다.'),
  ).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: '닫기' })).toBeDisabled();
  await page.getByRole('button', { name: '연결 결과 다시 확인' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const writes = await page.evaluate(() =>
    (window as any).adminCalls.filter((c: any) => c.action === 'admin-tag'),
  );
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
});
test('inactivity leaves admin mode and logs out without affecting customer flow', async ({
  page,
}) => {
  await page.clock.install();
  await host(page);
  await login(page);
  await page.clock.fastForward(301000);
  await expect(page.getByRole('button', { name: /대여하기/ })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).adminCalls.some((c: any) => c.action === 'admin-logout'),
    ),
  ).toBe(true);
});
