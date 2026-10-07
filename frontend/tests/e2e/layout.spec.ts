import { loginMobile } from './auth-helpers';
import { test, expect } from '@playwright/test';

test('모바일 전체 화면 320px 레이아웃과 키오스크 확인 화면', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await loginMobile(page);
  await expect(page.locator('.code-number')).toHaveText(/\d{6}/);
  const code = (await page.locator('.code-number').textContent())!;
  for (const path of ['code', 'items/calc', 'rentals', 'history', 'signup', 'account']) {
    await page.goto(`/mobile/${path}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      path,
    ).toBe(true);
  }
  await page.goto('/mobile/code');
  await expect(page.locator('.code-number')).toHaveText(code);
  await page.screenshot({ path: 'test-results/mobile-code.png', fullPage: true });
  const kiosk = await context.newPage();
  await kiosk.setViewportSize({ width: 1280, height: 900 });
  await kiosk.goto('/kiosk');
  await kiosk.getByRole('button', { name: /대여하기/ }).click();
  await kiosk.getByRole('button', { name: /공학용 계산기/ }).click();
  await kiosk.screenshot({ path: 'test-results/kiosk-code.png', fullPage: true });
  await kiosk.getByLabel('일회성 대여 코드').fill(code);
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(
    kiosk.getByRole('heading', { name: '물품의 NFC 태그를 인식해 주세요' }),
  ).toBeVisible();
  await page.evaluate(() => {
    const c = new BroadcastChannel('tagback-nfc');
    c.postMessage({ tag: 'CALC-1' });
    c.close();
  });
  await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
  await kiosk.screenshot({ path: 'test-results/kiosk-confirm.png', fullPage: true });
  expect(await kiosk.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await kiosk.getByRole('button', { name: '이용 취소' }).click();
  await expect(kiosk.getByRole('button', { name: '계속 이용하기' })).toBeFocused();
  await kiosk.keyboard.press('Shift+Tab');
  await expect(kiosk.getByRole('button', { name: '종료하고 처음으로' })).toBeFocused();
  await kiosk.keyboard.press('Tab');
  await expect(kiosk.getByRole('button', { name: '계속 이용하기' })).toBeFocused();
});
