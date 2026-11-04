import { test, expect } from '@playwright/test';

test('return scan keeps UID after removal, verifies code, and keeps the selection on expiry', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const sources = new Set<EventTarget>();
    class FakeSource extends EventTarget {
      constructor() { super(); sources.add(this); queueMicrotask(() => this.dispatchEvent(new MessageEvent('READER_CONNECTED'))); }
      close() { sources.delete(this); }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeSource });
    window.addEventListener('test-repeat-tag', (event) => {
      const type = (event as CustomEvent<string>).detail;
      for (const source of sources) source.dispatchEvent(new MessageEvent(type, {
        data: JSON.stringify({ type, ...(type === 'TAG_READ' ? { uid: '04A23B1C5D6E80' } : {}) }),
      }));
    });
  });
  let lookups = 0;
  let returns = 0;
  await page.route('**/api/v1/kiosk/rental-grants', route => route.fulfill({ status: 201,
    json: { token: crypto.randomUUID(), maskedPhoneNumber: '', expiresAt: new Date(Date.now() + 180000).toISOString() } }));
  await page.route('**/api/tags/**', route => {
    lookups++;
    expect(route.request().url()).toContain('/api/tags/04A23B1C5D6E80');
    expect(route.request().headers().authorization?.startsWith('Bearer ')).toBe(true);
    return lookups === 1 ? route.fulfill({ status: 410, json: { error: { code: 'RENTAL_GRANT_EXPIRED' } } })
      : route.fulfill({ json: { tag: { uid: '04A23B1C5D6E80', status: 'ACTIVE' } } });
  });
  await page.route('**/api/v1/rentals/return', route => { returns++; return route.abort(); });
  await page.goto('/kiosk');
  await page.getByRole('button', { name: /반납하기/ }).click();
  const emit = (type: string) => page.evaluate(value => window.dispatchEvent(new CustomEvent('test-repeat-tag', { detail: value })), type);
  await page.evaluate(() => { for (let n = 0; n < 2; n++) window.dispatchEvent(new CustomEvent('test-repeat-tag', { detail: 'TAG_READ' })); });
  await expect(page.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await emit('TAG_READ');
  await expect(page.getByRole('heading', { name: '반납할 물품을 인식해 주세요' })).toBeVisible();
  await page.clock.fastForward(1001);
  await emit('TAG_READ');
  await expect(page.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
  await emit('TAG_REMOVED');
  await page.getByRole('button', { name: /정상이에요/ }).click();
  await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await expect(page.getByLabel('일회성 반납 코드')).toBeVisible();
  await page.getByLabel('일회성 반납 코드').fill('123456');
  await page.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('코드 인증 시간이 지났어요');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByLabel('일회성 반납 코드')).toBeVisible();
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await expect(page.getByRole('button', { name: /정상이에요/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await page.getByLabel('일회성 반납 코드').fill('123456');
  await page.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('실서버 반납 처리는 아직 준비 중입니다');
  expect(lookups).toBe(2);
  expect(returns).toBe(0);
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
  await expect(page.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
  await page.getByRole('button', { name: /손상이 있어요/ }).click();
  await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await expect(page.getByLabel('일회성 반납 코드')).toBeVisible();
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
