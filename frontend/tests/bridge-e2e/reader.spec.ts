import { test, expect } from '@playwright/test';

test('return scan ignores the same tag within one second', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const sources = new Set<EventTarget>();
    class FakeSource extends EventTarget {
      constructor() { super(); sources.add(this); queueMicrotask(() => this.dispatchEvent(new MessageEvent('READER_CONNECTED'))); }
      close() { sources.delete(this); }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeSource });
    window.addEventListener('test-repeat-tag', () => {
      for (const source of sources) source.dispatchEvent(new MessageEvent('TAG_READ', {
        data: JSON.stringify({ type: 'TAG_READ', uid: '04A23B1C5D6E80' }),
      }));
    });
  });
  await page.goto('/kiosk');
  await page.getByRole('button', { name: /반납하기/ }).click();
  const scan = () => page.evaluate(() => window.dispatchEvent(new Event('test-repeat-tag')));
  await scan();
  await expect(page.getByRole('dialog')).toContainText('반납 코드를 입력해 주세요');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await scan();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(1001);
  await scan();
  await expect(page.getByRole('dialog')).toContainText('반납 코드를 입력해 주세요');
});

test('return scan receives a bridge event but never sends a request without return authentication', async ({ page }) => {
  await page.addInitScript(() => {
    const sources = new Set<EventTarget>();
    class FakeSource extends EventTarget {
      onopen: (() => void) | null = null;
      constructor() { super(); sources.add(this); queueMicrotask(() => this.dispatchEvent(new MessageEvent('READER_CONNECTED'))); }
      close() { sources.delete(this); }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeSource });
    window.addEventListener('test-return-tag', () => {
      for (const source of sources) source.dispatchEvent(new MessageEvent('TAG_READ', {
        data: JSON.stringify({ type: 'TAG_READ', uid: '04A23B1C5D6E80' }),
      }));
    });
  });
  const calls: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) calls.push(request.url()); });
  await page.goto('/kiosk');
  await page.getByRole('button', { name: /반납하기/ }).click();
  await expect(page.getByRole('heading', { name: '반납할 물품을 인식해 주세요' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('test-return-tag')));
  await expect(page.getByRole('dialog')).toContainText('반납 코드를 입력해 주세요');
  await expect(page.locator('#rental-code')).toHaveCount(0);
  expect(calls).toEqual([]);
});

test('reader outage stays dismissed across countdown renders and alerts again after recovery', async ({ page }) => {
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
      close() { sources.delete(this); }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeSource });
    window.addEventListener('test-reader-state', (event) => {
      for (const source of sources)
        source.dispatchEvent(new MessageEvent((event as CustomEvent<string>).detail));
    });
  });
  await page.route('**/api/v1/kiosk/rental-grants', (route) => route.fulfill({
    json: { token: 'test-grant', maskedPhoneNumber: '010****5678',
      expiresAt: new Date(Date.now() + 180000).toISOString() },
  }));
  await page.route('**/api/v1/item-types', (route) => route.fulfill({
    json: { itemTypes: [{ itemTypeId: '1', itemTypeName: '공용 우산' }] },
  }));
  await page.goto('/kiosk');
  await page.getByRole('button', { name: /대여하기/ }).click();
  for (const digit of '123456')
    await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: '코드 확인', exact: true }).click();
  await page.getByRole('button', { name: /공용 우산/ }).click();
  await expect(page.getByRole('heading', { name: '물품의 NFC 태그를 인식해 주세요' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = (value: string) => page.evaluate((detail) =>
    window.dispatchEvent(new CustomEvent('test-reader-state', { detail })), value);
  await state('READER_DISCONNECTED');
  await expect(page.getByRole('dialog')).toContainText('인식기 연결 복구');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await page.clock.fastForward(5000);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await state('READER_CONNECTED');
  await expect(page.getByText('NFC 인식을 기다리고 있습니다', { exact: true })).toBeVisible();
  await state('READER_DISCONNECTED');
  await expect(page.getByRole('dialog')).toContainText('인식기 연결 복구');
});
