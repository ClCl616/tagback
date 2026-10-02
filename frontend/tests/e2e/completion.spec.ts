import { expect, test } from '@playwright/test';

test('반납 완료 자동 종료와 다음 이용자 초기 상태', async ({ page, context }) => {
  await page.goto('/kiosk');
  await page.getByRole('button', { name: /반납하기/ }).click();
  const simulator = await context.newPage();
  await simulator.goto('/dev/simulator');
  await simulator.getByRole('button', { name: /계산기 006/ }).click();
  await page.getByRole('button', { name: /정상이에요/ }).click();
  await page.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await page.getByRole('button', { name: '반납 확정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '반납이 완료되었습니다' })).toBeVisible();
  await expect(page.getByRole('button', { name: /대여하기/ })).toBeVisible({ timeout: 16000 });
  await expect(page.getByText('계산기 006')).not.toBeVisible();
  await page.getByRole('button', { name: /대여하기/ }).click();
  await page.getByRole('button', { name: /공학용 계산기/ }).click();
  await expect(page.getByLabel('일회성 대여 코드')).toHaveValue('');
});
