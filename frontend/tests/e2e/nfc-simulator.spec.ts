import { test, expect } from '@playwright/test';

test('시뮬레이터 UID 인식 → 관리자 등록 및 중복 태그 안내', async ({ page, context }) => {
  await page.goto('/admin/items');
  const simulator = await context.newPage();
  await simulator.goto('/dev/simulator');
  const panel = simulator.getByRole('region', { name: 'NFC 인식 테스트' });
  const uid = panel.getByLabel('테스트 태그 UID');
  const send = panel.getByRole('button', { name: 'NFC 태그 인식시키기' });
  const dialog = page.getByRole('dialog', { name: /물품 등록|물품 수정/ });
  async function openItem(number: string) {
    await page.getByRole('button', { name: '물품 등록', exact: true }).click();
    await dialog.getByLabel('카테고리', { exact: true }).fill('학습 용품');
    await dialog.getByRole('button', { name: '학습 용품', exact: true }).click();
    await dialog.getByLabel('물품명', { exact: true }).fill('시뮬레이터 테스트');
    await dialog.getByLabel('관리번호', { exact: true }).fill(number);
    await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
    await expect(dialog.getByRole('button', { name: '등록하기', exact: true })).toBeEnabled();
  }
  await openItem('901');
  await uid.fill('잘못된 UID');
  await send.click();
  await expect(panel.getByRole('alert')).toContainText('16진수');
  await simulator
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await expect(dialog.getByLabel('태그 ID', { exact: true })).toHaveValue('');
  await uid.fill('04:a2-3b 1c:5d:6e:80');
  await send.click();
  await expect(dialog.getByLabel('태그 ID', { exact: true })).toHaveValue('04A23B1C5D6E80');
  await expect(panel.getByRole('status')).toContainText('인식 이벤트 전송');
  await dialog.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText(
    '04A23B1C5D6E80',
  );
  await openItem('902');
  await send.click();
  await expect(dialog.getByLabel('태그 ID', { exact: true })).toHaveValue('04A23B1C5D6E80');
  await dialog.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('이미 등록된 태그');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await panel.getByRole('button', { name: '새 테스트 UID 만들기' }).click();
  const newUid = await uid.inputValue();
  expect(newUid).toMatch(/^04[0-9A-F]{12}$/);
  expect(newUid).not.toBe('04A23B1C5D6E80');
  await send.click();
  await expect(dialog.getByLabel('태그 ID', { exact: true })).toHaveValue(newUid);
  await dialog.getByRole('button', { name: '태그 연결 재시도', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await simulator.getByLabel('NFC 리더기 연결', { exact: true }).uncheck();
  await expect(send).toBeDisabled();
  await expect(panel).toContainText('연결 설정을 켜');
});
