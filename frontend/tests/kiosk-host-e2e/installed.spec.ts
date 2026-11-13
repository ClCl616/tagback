import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function installHost(page: Page, platform: 'windows' | 'android', loseReply = false) {
  await page.addInitScript(
    ({ platform, loseReply }) => {
      const calls: any[] = [];
      let listener: ((read: any) => void) | undefined;
      let lost = false;
      Object.assign(window, {
        fixtureCalls: calls,
        fixtureScan: () =>
          listener?.({
            uid: '04A23B1C5D6E80',
            proof: {
              bridgeId: 'fixture',
              uid: '04A23B1C5D6E80',
              issuedAt: Date.now(),
              nonce: crypto.randomUUID(),
              signature: 'a'.repeat(64),
            },
          }),
        tagbackKioskHost: {
          version: 2,
          platform,
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
            calls.push(message);
            const command = message.command;
            let data: any = {};
            switch (command.action) {
              case 'verify':
                data = {
                  grantHandle: 'native-grant-handle',
                  maskedPhoneNumber: '010****5678',
                  expiresAt: new Date(Date.now() + 180000).toISOString(),
                };
                break;
              case 'catalog':
                data = { itemTypes: [{ itemTypeId: '1', itemTypeName: '공용 우산' }] };
                break;
              case 'scan':
                data = {
                  tag: { uid: command.uid, status: 'ACTIVE' },
                  item: {
                    itemId: 5,
                    itemTypeId: '1',
                    name: '공용 우산 05',
                    itemTypeName: '공용 우산',
                    status: 'AVAILABLE',
                    rentable: true,
                  },
                };
                break;
              case 'return-scan':
                data = {
                  scanTicketId: '6fa7b810-77bd-4f49-8cf9-e9bd457f1101',
                  rentalId: '9',
                  itemId: '5',
                  itemName: '공용 우산 05',
                  itemTypeId: '1',
                  itemTypeName: '공용 우산',
                };
                break;
              case 'rent':
                if (loseReply && !lost) {
                  lost = true;
                  throw new Error('fixture lost reply');
                }
                data = {
                  rentalId: '9',
                  itemId: '5',
                  itemTypeId: '1',
                  rentalStatus: 'RENTED',
                  itemStatus: 'RENTED',
                  rentedAt: '2026-11-13T00:00:00Z',
                  dueAt: '2026-11-16T00:00:00Z',
                };
                break;
              case 'return':
                data = {
                  rentalId: '9',
                  itemId: '5',
                  rentalStatus: 'RETURNED',
                  itemStatus: command.condition === 'DAMAGED' ? 'INSPECTION' : 'AVAILABLE',
                  condition: command.condition,
                  rentedAt: '2026-11-13T00:00:00Z',
                  dueAt: '2026-11-16T00:00:00Z',
                  returnedAt: '2026-11-13T01:00:00Z',
                };
                break;
            }
            return { version: 2, requestId: message.requestId, status: 200, data };
          },
        },
      });
    },
    { platform, loseReply },
  );
}
async function enterCode(page: Page, label: string) {
  await page.getByLabel(label).fill('123456');
  await page.getByRole('button', { name: '확인', exact: true }).click();
}

test('bundle is standalone, includes its HTML hash and excludes public account routes', async ({
  page,
}) => {
  const dir = new URL('../../dist-kiosk/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('kiosk-build.json', dir), 'utf8'));
  expect(manifest.hostProtocolVersion).toBe(2);
  expect(manifest.files.some((f: any) => f.path === 'kiosk-app.html')).toBe(true);
  for (const file of manifest.files) {
    const data = readFileSync(new URL(file.path, dir));
    expect(createHash('sha256').update(data).digest('hex')).toBe(file.sha256);
  }
  expect(createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')).toBe(
    manifest.uiBuildHash,
  );
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/kiosk-app.html');
  await expect(page.getByRole('heading', { name: '키오스크 연결을 확인해 주세요' })).toBeVisible();
  await expect(page.getByRole('button', { name: /대여하기/ })).toHaveCount(0);
  expect(requests.every((url) => url.startsWith('http://127.0.0.1:5179/'))).toBe(true);
  expect(requests.some((url) => url.includes('/api/'))).toBe(false);
  expect(page.url()).toContain('/kiosk-app.html');
});

for (const candidate of [
  { version: 1 },
  { version: 3 },
  { version: 2, capabilities: { transport: 9 } },
])
  test(`incompatible host ${JSON.stringify(candidate)} blocks startup`, async ({ page }) => {
    await page.addInitScript(
      (candidate) =>
        Object.assign(window, {
          tagbackKioskHost: {
            ...candidate,
            platform: 'windows',
            reader: {
              subscribe() {
                throw new Error('must not subscribe');
              },
            },
            request() {
              throw new Error('must not request');
            },
          },
        }),
      candidate,
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/kiosk-app.html');
    await expect(
      page.getByRole('heading', { name: '키오스크 연결을 확인해 주세요' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

for (const platform of ['windows', 'android'] as const)
  test(`${platform}: bundled rental and damaged return use only host commands`, async ({
    page,
  }) => {
    await installHost(page, platform);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/kiosk-app.html');
    await page.getByRole('button', { name: /대여하기/ }).click();
    await enterCode(page, '일회성 대여 코드');
    await page.getByRole('button', { name: /공용 우산/ }).click();
    await page.evaluate(() => (window as any).fixtureScan());
    await page.getByRole('button', { name: '대여 확정', exact: true }).click();
    await expect(page.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
    await page.getByRole('button', { name: '처음으로', exact: true }).click();
    await page.getByRole('button', { name: /반납하기/ }).click();
    await page.evaluate(() => (window as any).fixtureScan());
    await page.getByRole('button', { name: /손상이 있어요/ }).click();
    await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
    await enterCode(page, '일회성 반납 코드');
    expect(
      await page.evaluate(
        () => (window as any).fixtureCalls.filter((r: any) => r.command.action === 'return').length,
      ),
    ).toBe(0);
    await page.getByRole('button', { name: '반납 확정', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '반납 · 점검 접수가 완료되었습니다' }),
    ).toBeVisible();
    const calls = await page.evaluate(() => (window as any).fixtureCalls);
    expect(calls.find((r: any) => r.command.action === 'rent').command.grantRef).toBe(
      'native-grant-handle',
    );
    expect(calls.find((r: any) => r.command.action === 'return').command.operationId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(requests.some((url) => url.includes('/api/') || url.includes(':8765'))).toBe(false);
    expect(errors).toEqual([]);
  });

test('bundled host response loss replays the same operation and never uses browser HTTP', async ({
  page,
}) => {
  await installHost(page, 'windows', true);
  await page.goto('/kiosk-app.html');
  await page.getByRole('button', { name: /대여하기/ }).click();
  await enterCode(page, '일회성 대여 코드');
  await page.getByRole('button', { name: /공용 우산/ }).click();
  await page.evaluate(() => (window as any).fixtureScan());
  await page.getByRole('button', { name: '대여 확정', exact: true }).click();
  await expect(page.getByRole('button', { name: '이용 취소' })).toBeDisabled();
  await page.getByRole('button', { name: '처리 결과 다시 확인' }).click();
  await expect(page.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
  const writes = await page.evaluate(() =>
    (window as any).fixtureCalls.filter((r: any) => r.command.action === 'rent'),
  );
  expect(writes).toHaveLength(2);
  expect(writes[0].command).toEqual(writes[1].command);
  expect(writes[0].requestId).not.toBe(writes[1].requestId);
});

for (const viewport of [{width:1280,height:720},{width:1366,height:768},{width:1920,height:1080}]) {
  test(`installed layout fits ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await installHost(page, 'windows');
    await page.goto('/kiosk-app.html');
    const fits = async (stage: string) => {
      await expect.poll(() => page.locator('.kiosk-main').evaluate(el => el.scrollHeight-el.clientHeight), {message:stage,timeout:1500}).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight-innerHeight)).toBeLessThanOrEqual(1);
      const footer=await page.locator('.kiosk-footer').boundingBox();
      expect(footer!.y+footer!.height).toBeLessThanOrEqual(viewport.height+1);
    };
    await fits('start');
    await page.getByRole('button',{name:/대여하기/}).click();
    await fits('rental code');
    await enterCode(page,'일회성 대여 코드');
    await fits('catalog');
    await page.getByRole('button',{name:/공용 우산/}).click();
    await fits('scan');
    await page.evaluate(() => (window as any).fixtureScan());
    await expect(page.getByRole('button',{name:'대여 확정',exact:true})).toBeVisible();
    await fits('rental confirm');
    await page.getByRole('button',{name:'대여 확정',exact:true}).click();
    await expect(page.getByRole('heading',{name:'대여가 완료되었습니다'})).toBeVisible();
    await fits('rental done');
    await page.getByRole('button',{name:'처음으로',exact:true}).click();
    await page.getByRole('button',{name:/반납하기/}).click();
    await page.evaluate(() => (window as any).fixtureScan());
    await fits('condition');
    await page.getByRole('button',{name:/손상이 있어요/}).click();
    await page.getByRole('button',{name:'선택한 상태로 계속'}).click();
    await fits('return code');
    await enterCode(page,'일회성 반납 코드');
    await fits('return confirm');
    await page.getByRole('button',{name:'반납 확정',exact:true}).click();
    await expect(page.getByRole('heading',{name:'반납 · 점검 접수가 완료되었습니다'})).toBeVisible();
    await fits('return done');
  });
}
