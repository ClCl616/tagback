import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, tablet = false) {
  await page.clock.install();
  await page.addInitScript(
    ({ tablet }) => {
      const host = {
        version: 1,
        platform: tablet ? 'android' : 'windows',
        reader: {
          subscribe(
            listener: (read: unknown) => void,
            options: { onStatus?: (status: string) => void },
          ) {
            options.onStatus?.('connected');
            const scan = () =>
              listener({
                uid: '04A23B1C5D6E80',
                proof: {
                  uid: '04A23B1C5D6E80',
                  bridgeId: 'fixture',
                  issuedAt: Date.now(),
                  nonce: crypto.randomUUID(),
                  signature: 'a'.repeat(64),
                },
              });
            window.addEventListener('fixture-scan', scan);
            return () => window.removeEventListener('fixture-scan', scan);
          },
        },
        subscribeBack(listener: () => void) {
          window.addEventListener('fixture-back', listener);
          return () => window.removeEventListener('fixture-back', listener);
        },
      };
      Object.assign(window, { tagbackKioskHost: host });
    },
    { tablet },
  );
  await page.route('**/api/v1/kiosk/health', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/v1/kiosk/rental-grants', (r) =>
    r.fulfill({
      json: {
        token: 'fixture-grant',
        maskedPhoneNumber: '010****5678',
        expiresAt: new Date(Date.now() + 180000).toISOString(),
      },
    }),
  );
  await page.route('**/api/v1/item-types', (r) =>
    r.fulfill({ json: { itemTypes: [{ itemTypeId: '1', itemTypeName: '공용 우산' }] } }),
  );
  await page.route('**/api/tags/*', (r) =>
    r.fulfill({
      json: {
        tag: { uid: '04A23B1C5D6E80', status: 'ACTIVE' },
        item: {
          itemId: 5,
          itemTypeId: '1',
          name: '캠퍼스 우산 05',
          itemTypeName: '공용 우산',
          status: 'AVAILABLE',
          rentable: true,
        },
      },
    }),
  );
  await page.route('**/api/v1/rentals/return/scan', (r) =>
    r.fulfill({
      json: {
        scanTicketId: '6fa7b810-77bd-4f49-8cf9-e9bd457f1101',
        rentalId: '9',
        itemId: '5',
        itemName: '캠퍼스 우산 05',
        itemTypeId: '1',
        itemTypeName: '공용 우산',
      },
    }),
  );
  await page.goto('/kiosk');
  await expect(page.getByRole('button', { name: /대여하기/ })).toBeEnabled();
}
const scan = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('fixture-scan')));
async function code(page: Page) {
  for (const digit of '123456')
    await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
}
async function returnConfirm(page: Page, damaged = false) {
  await page.getByRole('button', { name: /반납하기/ }).click();
  await scan(page);
  await page.getByRole('button', { name: damaged ? /손상이 있어요/ : /정상이에요/ }).click();
  await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await code(page);
  await expect(page.getByRole('heading', { name: '반납 정보를 확인해 주세요' })).toBeVisible();
}
const times = {
  rentedAt: '2026-11-06T00:00:00Z',
  dueAt: '2026-11-09T07:30:00Z',
  returnedAt: '2026-11-06T01:00:00Z',
};
for (const damaged of [false, true])
  test(`반납 최종 확인 이전 저장 없음 / ${damaged ? '손상' : '정상'} 완료`, async ({ page }) => {
    await setup(page, true);
    let writes = 0;
    await page.route('**/api/v1/rentals/return', (r) => {
      writes++;
      expect(r.request().postDataJSON().condition).toBe(damaged ? 'DAMAGED' : 'NORMAL');
      return r.fulfill({
        json: {
          ...times,
          rentalId: '9',
          itemId: '5',
          rentalStatus: 'RETURNED',
          itemStatus: damaged ? 'INSPECTION' : 'AVAILABLE',
          condition: damaged ? 'DAMAGED' : 'NORMAL',
        },
      });
    });
    await returnConfirm(page, damaged);
    expect(writes).toBe(0);
    await page.screenshot({path:test.info().outputPath('return-confirm.png'),fullPage:true});
    await page.getByRole('button', { name: '반납 확정', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: damaged ? '반납 · 점검 접수가 완료되었습니다' : '반납이 완료되었습니다',
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toBe(1);
    await page.screenshot({path:test.info().outputPath('return-done.png'),fullPage:true});
    await page.clock.fastForward(13000);
    await expect(page.getByRole('button', { name: /반납하기/ })).toBeVisible();
  });

test('반납 응답 유실은 유휴·호스트 뒤로가기 후에도 같은 proof와 코드로 복구', async ({ page }) => {
  await setup(page, true);
  const bodies: unknown[] = [];
  await page.route('**/api/v1/rentals/return', (r) => {
    bodies.push(r.request().postDataJSON());
    return bodies.length === 1
      ? r.abort()
      : r.fulfill({
          json: {
            ...times,
            rentalId: '9',
            itemId: '5',
            rentalStatus: 'RETURNED',
            itemStatus: 'AVAILABLE',
            condition: 'NORMAL',
          },
        });
  });
  await returnConfirm(page);
  await page.getByRole('button', { name: '반납 확정', exact: true }).click();
  await expect(page.getByRole('button', { name: '반납 결과 다시 확인' })).toBeVisible();
  await page.clock.fastForward(181000);
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-back')));
  await expect(page.getByRole('button', { name: '이용 취소' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '이전', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /대여하기/ })).toHaveCount(0);
  await page.getByRole('button', { name: '반납 결과 다시 확인' }).click();
  await expect(page.getByRole('heading', { name: '이미 반납이 완료됐어요' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test('대여 응답 유실 후 같은 인증·멱등키·본문으로 복구하고 서버 예정일 표시', async ({ page }) => {
  await setup(page);
  const writes: { body: unknown; key: string; auth: string }[] = [];
  await page.route('**/api/v1/rentals', (r) => {
    const req = r.request();
    writes.push({
      body: req.postDataJSON(),
      key: req.headers()['idempotency-key'],
      auth: req.headers()['authorization'],
    });
    return writes.length === 1
      ? r.abort()
      : r.fulfill({
          json: {
            ...times,
            rentalId: '9',
            itemId: '5',
            itemTypeId: '1',
            rentalStatus: 'RENTED',
            itemStatus: 'RENTED',
          },
        });
  });
  await page.getByRole('button', { name: /대여하기/ }).click();
  await code(page);
  await page.getByRole('button', { name: /공용 우산/ }).click();
  await scan(page);
  await expect(page.getByText('대여 완료 후 안내')).toBeVisible();
  await page.getByRole('button', { name: '대여 확정', exact: true }).click();
  await expect(page.getByRole('button', { name: '처리 결과 다시 확인' })).toBeVisible();
  await page.clock.fastForward(181000);
  await page.getByRole('button', { name: '처리 결과 다시 확인' }).click();
  await expect(page.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0].key).toBeTruthy();
  expect(writes[1]).toEqual(writes[0]);
  await expect(page.getByText(/반납 예정 ·/)).toContainText('11월 9일');
});

test('키패드 한 자리 삭제·유휴 경고 연장·취소 포커스', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /대여하기/ }).click();
  for (const d of '123') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(page.getByLabel('일회성 대여 코드')).toHaveValue('12');
  await expect(page.getByRole('button', { name: '확인', exact: true })).toBeDisabled();
  await page.clock.fastForward(161000);
  await expect(page.getByText('이용 시간이 곧 종료됩니다.')).toBeVisible();
  await page.getByRole('button', { name: '계속 이용하기' }).click();
  await page.clock.fastForward(21000);
  await expect(page.getByLabel('일회성 대여 코드')).toHaveValue('12');
  await page.getByRole('button', { name: '이용 취소' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이용 취소' })).toBeFocused();
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 800, height: 1280 },
])
  test(`레이아웃 ${size.width}x${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await setup(page, size.height >= 800);
    await page.screenshot({ path: info.outputPath('home.png'), fullPage: true });
    await page.getByRole('button', { name: /대여하기/ }).click();
    await expect(page.getByRole('button', { name: '확인', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const button = await page.getByRole('button', { name: '1', exact: true }).boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(64);
    await page.screenshot({ path: info.outputPath('code.png'), fullPage: true });
  });

test('유실된 반납 거부 결과를 확인하면 코드 수정 가능, 만료 티켓은 재인식', async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route('**/api/v1/rentals/return', (route) => {
    writes++;
    if (writes === 1) return route.abort();
    return route.fulfill({
      status: writes === 2 ? 401 : 409,
      json: {
        error: {
          code: writes === 2 ? 'RETURN_CODE_INVALID' : 'NFC_SCAN_REQUIRED',
          message: 'fixture',
        },
      },
    });
  });
  await returnConfirm(page);
  await page.getByRole('button', { name: '반납 확정', exact: true }).click();
  await page.getByRole('button', { name: '반납 결과 다시 확인' }).click();
  await expect(page.getByLabel('일회성 반납 코드')).toBeEnabled();
  await expect(page.getByLabel('일회성 반납 코드')).toHaveValue('');
  await code(page);
  await page.getByRole('button', { name: '반납 확정', exact: true }).click();
  await page.getByRole('button', { name: '물품 다시 인식하기' }).click();
  await scan(page);
  await expect(page.getByRole('button', { name: /정상이에요/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: '선택한 상태로 계속' })).toBeDisabled();
});
