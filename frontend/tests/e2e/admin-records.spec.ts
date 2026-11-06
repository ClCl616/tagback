import { expect, test } from '@playwright/test';
test('existing admin navigation opens users and rental records without leaving admin', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '물품 관리', exact: true })).toBeVisible();
  const menu = page.getByRole('navigation', { name: '관리자 메뉴' });
  await menu.getByRole('button', { name: '사용자 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '사용자 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await menu.getByRole('button', { name: '대여 현황', exact: true }).click();
  await page.getByLabel('상태', { exact: true }).selectOption('RETURNED');
  await expect(page.getByRole('cell', { name: '반납 완료', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: '물품 관리', exact: true }).click();
  await expect(page.getByRole('button', { name: '물품 등록', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
});
