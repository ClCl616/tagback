import { expect, type Page } from '@playwright/test';
export async function smsVerify(page: Page, phone = '01012345678') {
  await page.getByLabel('전화번호', { exact: true }).fill(phone);
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await page.getByLabel('SMS 인증번호').fill('123456');
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await expect(page.getByLabel('SMS 인증번호')).toHaveCount(0);
  const policy = page.getByRole('dialog', { name: 'PIN 설정 안내' });
  if (await policy.isVisible())
    await policy.getByRole('button', { name: '확인', exact: true }).click();
}
export async function loginMobile(page: Page, next = '/mobile/code') {
  await page.goto('/mobile/login?next=' + encodeURIComponent(next));
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await expect(page).toHaveURL(/\/mobile$/);
  if (next !== '/mobile') await page.goto(next);
}

export async function enterProfile(page: Page) {
  await page.getByLabel('이름', { exact: true }).fill('홍길동');
  await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.getByRole('button', { name: '다음', exact: true }).click();
}
