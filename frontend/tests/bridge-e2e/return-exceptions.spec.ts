import { test, expect, type Page } from '@playwright/test';

async function openReturn(page: Page) {
  await page.clock.install();
  await page.addInitScript(() => {
    const sources = new Set<EventTarget>();
    class FakeSource extends EventTarget {
      onopen: (() => void) | null = null;
      constructor() {
        super();
        sources.add(this);
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('READER_CONNECTED')));
      }
      close() {
        sources.delete(this);
      }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeSource });
    window.addEventListener('fake-reader', (event) => {
      const detail = (event as CustomEvent<{ type: string; uid?: string }>).detail;
      const payload = {
        type: detail.type,
        uid: detail.uid,
        bridgeId: 'reader',
        issuedAt: Date.now(),
        nonce: crypto.randomUUID(),
        signature: 'a'.repeat(64),
      };
      for (const source of sources)
        source.dispatchEvent(new MessageEvent(detail.type, { data: JSON.stringify(payload) }));
    });
  });
  await page.route('**/api/v1/kiosk/health', (route) => route.fulfill({ json: {} }));
  await page.goto('/kiosk');
  await page.getByRole('button', { name: /반납하기/ }).click();
}
async function emit(page: Page, type: string, uid = '04A23B1C5D6E80') {
  await page.evaluate(
    ([type, uid]) =>
      window.dispatchEvent(new CustomEvent('fake-reader', { detail: { type, uid } })),
    [type, uid],
  );
}
async function scanResponse(page: Page, onScan?: () => void) {
  await page.route('**/api/v1/rentals/return/scan', async (route) => {
    onScan?.();
    await route.fulfill({
      json: {
        scanTicketId: '6fa7b810-77bd-4f49-8cf9-e9bd457f1101',
        rentalId: '9',
        itemId: '5',
        itemName: '검증 물품',
        itemTypeId: '1',
        itemTypeName: '공용 물품',
      },
    });
  });
}
async function enterCode(page: Page) {
  await page.getByRole('button', { name: /손상이 있어요/ }).click();
  await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await expect(page.getByLabel('일회성 반납 코드')).toBeVisible();
  await expect(page.getByText('시간이 지나면 물품을 다시 인식해 주세요.')).toBeVisible();
}

test('중복 스캔 억제와 제거 후 UID·선택 상태 유지 및 코드 오류 복구', async ({ page }) => {
  let calls = 0;
  await openReturn(page);
  await scanResponse(page, () => calls++);
  await page.route('**/api/v1/rentals/return', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'RETURN_CODE_INVALID', message: '코드를 확인해 주세요' } },
    }),
  );
  await page.evaluate(() => {
    const detail = { type: 'TAG_READ', uid: '04A23B1C5D6E80' };
    window.dispatchEvent(new CustomEvent('fake-reader', { detail }));
    window.dispatchEvent(new CustomEvent('fake-reader', { detail }));
  });
  await expect(page.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
  expect(calls).toBe(1);
  await emit(page, 'TAG_REMOVED');
  await enterCode(page);
  await expect(page.getByText('반납할 물품 · 손상')).toBeVisible();
  const request = page.waitForRequest((req) => req.url().endsWith('/api/v1/rentals/return'));
  await page.getByLabel('일회성 반납 코드').fill('000000');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '반납 확정', exact: true }).click();
  const sent = (await request).postDataJSON();
  expect(sent.proof.uid).toBe('04A23B1C5D6E80');
  expect(sent.condition).toBe('DAMAGED');
  await expect(page.getByText('코드를 확인해 주세요')).toBeVisible();
  await expect(page.getByLabel('일회성 반납 코드')).toBeEnabled();
  await expect(page.getByText('반납할 물품 · 손상')).toBeVisible();
});

test('뒤로가기와 취소 및 시간 초과에서 이전 입력이 초기화된다', async ({ page }) => {
  await openReturn(page);
  await scanResponse(page);
  await emit(page, 'TAG_READ');
  await enterCode(page);
  await page.getByLabel('일회성 반납 코드').fill('000000');
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await expect(page.getByLabel('일회성 반납 코드')).toHaveValue('');
  await page.getByRole('button', { name: '이용 취소' }).click();
  await page.getByRole('button', { name: '종료하고 처음으로' }).click();
  const scannedUids: string[] = [];
  const returnedUids: string[] = [];
  await page.unroute('**/api/v1/rentals/return/scan');
  await page.route('**/api/v1/rentals/return/scan', async (route) => {
    scannedUids.push(route.request().postDataJSON().proof.uid);
    await route.fulfill({
      json: {
        scanTicketId: '6fa7b810-77bd-4f49-8cf9-e9bd457f1101',
        rentalId: '9',
        itemId: '5',
        itemName: '새 물품',
        itemTypeId: '1',
        itemTypeName: '공용 물품',
      },
    });
  });
  await page.route('**/api/v1/rentals/return', async (route) => {
    returnedUids.push(route.request().postDataJSON().proof.uid);
    await route.fulfill({
      status: 401,
      json: { error: { code: 'RETURN_CODE_INVALID', message: '코드를 확인해 주세요' } },
    });
  });
  await page.getByRole('button', { name: /반납하기/ }).click();
  expect(scannedUids).toEqual([]);
  expect(returnedUids).toEqual([]);
  await emit(page, 'TAG_READ', '04A23B1C5D6E81');
  await expect(page.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
  await expect(page.getByRole('button', { name: /정상이에요/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: /손상이 있어요/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: '선택한 상태로 계속' })).toBeDisabled();
  expect(scannedUids).toEqual(['04A23B1C5D6E81']);
  await enterCode(page);
  await expect(page.getByLabel('일회성 반납 코드')).toHaveValue('');
  await page.getByLabel('일회성 반납 코드').fill('000000');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '반납 확정', exact: true }).click();
  await expect(page.getByText('코드를 확인해 주세요')).toBeVisible();
  expect(returnedUids).toEqual(['04A23B1C5D6E81']);
  await page.clock.fastForward(181000);
  await expect(page.getByRole('button', { name: /반납하기/ })).toBeVisible();
  await page.getByRole('button', { name: /반납하기/ }).click();
  await expect(page.getByRole('heading', { name: '반납할 물품을 인식해 주세요' })).toBeVisible();
});

test('상태 충돌은 관리자 문의와 처음으로 돌아가기를 표시한다', async ({ page }) => {
  await openReturn(page);
  await scanResponse(page);
  await emit(page, 'TAG_READ');
  await enterCode(page);
  await page.route('**/api/v1/rentals/return', (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: 'RENTAL_STATE_CONFLICT', message: 'conflict' } },
    }),
  );
  await page.getByLabel('일회성 반납 코드').fill('000000');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '반납 확정', exact: true }).click();
  await expect(
    page.getByText('물품 상태가 변경되었습니다. 관리자에게 문의해 주세요.'),
  ).toBeVisible();
  await page.getByRole('button', { name: '처음으로 돌아가기' }).click();
  await expect(page.getByRole('button', { name: /반납하기/ })).toBeVisible();
});

test('실패한 인식 직후 1초 내 같은 UID 재인식을 무시한다', async ({ page }) => {
  let calls = 0;
  await openReturn(page);
  await page.route('**/api/v1/rentals/return/scan', (route) => {
    calls++;
    return route.fulfill({
      status: 409,
      json: { error: { code: 'RENTAL_NOT_ACTIVE', message: 'none' } },
    });
  });
  await emit(page, 'TAG_READ');
  await expect(
    page.getByText('등록되지 않았거나 반납할 대여가 없는 태그입니다. 태그를 확인해 주세요.'),
  ).toBeVisible();
  await emit(page, 'TAG_READ');
  await page.waitForTimeout(200);
  expect(calls).toBe(1);
});

test('태그 인식 단계의 상태 충돌에서 처음 화면으로 돌아간다', async ({ page }) => {
  await openReturn(page);
  await page.route('**/api/v1/rentals/return/scan', (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: 'RENTAL_STATE_CONFLICT', message: 'conflict' } },
    }),
  );
  await emit(page, 'TAG_READ');
  await expect(
    page.getByText('물품 상태가 변경되었습니다. 관리자에게 문의해 주세요.'),
  ).toBeVisible();
  await page.getByRole('button', { name: '처음으로 돌아가기' }).click();
  await expect(page.getByRole('button', { name: /반납하기/ })).toBeVisible();
});
