import { loginMobile, smsVerify, enterProfile } from './auth-helpers';
import { test, expect, type Page } from '@playwright/test';

test('조회 실패·네트워크 오류 재시도 및 개발 시뮬레이터 연결', async ({ page, context }) => {
  await page.goto('/dev/simulator');
  await expect(page.getByRole('heading', { name: 'TagBack · 개발 시뮬레이터' })).toBeVisible();
  await expect(page.getByRole('button', { name: /계산기 006/ })).toBeVisible();
  await page.getByLabel('다음 요청 오류').selectOption('network');
  const mobile = await context.newPage();
  await mobile.goto('/mobile');
  await expect(mobile.getByRole('alert')).toContainText('네트워크 연결이 끊겼습니다');
  await mobile.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(mobile.getByRole('heading', { name: '공학용 계산기', exact: true })).toBeVisible();
  await expect(mobile.getByLabel('대여소 선택').locator('option')).toHaveCount(1);
  await mobile.getByLabel('대여소 선택').selectOption('engineering');
  await expect(mobile.locator('.product-card')).toHaveCount(4);
  const kiosk = await context.newPage();
  await kiosk.goto('/kiosk');
  await page.getByLabel('서비스 연결', { exact: true }).uncheck();
  await expect(kiosk.getByRole('button', { name: /대여하기/ })).toBeDisabled();
  await page.getByLabel('서비스 연결', { exact: true }).check();
  await expect(kiosk.getByRole('button', { name: /반납하기/ })).toBeEnabled();
  await kiosk.getByRole('button', { name: /반납하기/ }).click();
  await page.getByRole('button', { name: /계산기 006/ }).click();
  await expect(kiosk.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
});

test('중복 태그·버튼 연타와 이미 사용한 코드 거절', async ({ page, context }) => {
  const code = await login(page);
  const kiosk = await context.newPage();
  await enterRent(kiosk, code);
  await scan(page, 'CALC-1');
  await scan(page, 'CALC-1');
  await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
  await kiosk
    .getByRole('button', { name: '대여 확정', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
  await kiosk.getByRole('button', { name: '처음으로', exact: true }).click();
  await kiosk.getByRole('button', { name: /대여하기/ }).click();
  await kiosk.getByRole('button', { name: /공학용 계산기/ }).click();
  await kiosk.getByLabel('일회성 대여 코드').fill(code);
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(kiosk.getByRole('alert')).toContainText('이미 사용한 코드');
  const rows = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tagback.mock.v1')!).rentals.filter(
      (r: any) => r.itemId === 'calc-1',
    ),
  );
  expect(rows).toHaveLength(1);
});

test('저장 중 종료한 뒤 늦은 응답은 다음 이용자 화면에 표시하지 않음', async ({
  page,
  context,
}) => {
  const code = await login(page);
  const kiosk = await context.newPage();
  await enterRent(kiosk, code);
  await scan(page, 'CALC-1');
  await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
  await kiosk.getByRole('button', { name: '대여 확정', exact: true }).click();
  await kiosk.getByRole('button', { name: '이용 취소' }).click();
  await expect(kiosk.getByRole('dialog')).toContainText('이미 저장되었을 수 있습니다');
  await kiosk.getByRole('button', { name: '종료하고 처음으로' }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('tagback.mock.v1')!).rentals.filter(
            (r: any) => r.itemId === 'calc-1',
          ).length,
      ),
    )
    .toBe(1);
  await expect(kiosk.getByRole('button', { name: /대여하기/ })).toBeVisible();
  await expect(kiosk.getByText('010-****-5678')).not.toBeVisible();
  await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).not.toBeVisible();
});
async function login(page: Page) {
  await loginMobile(page);
  await expect(page.locator('.code-number')).toHaveText(/\d{6}/);
  return (await page.locator('.code-number').textContent())!;
}
async function scan(page: Page, tag: string) {
  await page.evaluate((tag) => {
    const c = new BroadcastChannel('tagback-nfc');
    c.postMessage({ tag });
    c.close();
  }, tag);
}
async function fault(page: Page, value: string) {
  await page.evaluate(
    (value) =>
      localStorage.setItem(
        'tagback.mock.controls',
        JSON.stringify({
          nextFault: value,
          nextTarget: value === 'timeout' ? 'verify' : 'save',
          reader: true,
          service: true,
          sessionSeconds: 180,
        }),
      ),
    value,
  );
}
async function enterRent(kiosk: Page, code: string) {
  await kiosk.goto('/kiosk');
  await kiosk.getByRole('button', { name: /대여하기/ }).click();
  await kiosk.getByRole('button', { name: /공학용 계산기/ }).click();
  await kiosk.getByLabel('일회성 대여 코드').fill(code);
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(
    kiosk.getByRole('heading', { name: '물품의 NFC 태그를 인식해 주세요' }),
  ).toBeVisible();
}
test('비회원 탐색, 재고 없음, 320px 넘침 없음', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/mobile');
  await expect(page.getByRole('heading', { name: '공학용 계산기', exact: true })).toBeVisible();
  await expect(page.locator('.product-card').first()).toContainText('5개');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('물품명 검색').fill('없는물품');
  await expect(page.getByText('찾으시는 물품이 없어요')).toBeVisible();
  await page.getByRole('button', { name: '검색 초기화' }).click();
  await page.getByRole('heading', { name: '보조배터리', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '지금은 대여 가능한 물품이 없어요' }),
  ).toBeDisabled();
  await page.goto('/mobile/rentals');
  await expect(page.getByRole('button', { name: '다음', exact: true })).toBeVisible();
});
test('가입 후 원래 목적지 복귀와 개인 기록', async ({ page }) => {
  await page.goto('/mobile/signup?next=%2Fmobile%2Fhistory');
  await enterProfile(page);
  await smsVerify(page, '01099998888');
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page).toHaveURL(/history/);
  await expect(page.getByText('아직 이용 기록이 없어요')).toBeVisible();
});
test('전체 대여 → 정상 반납 → 손상 반납, 모바일 동기화', async ({ page, context }) => {
  const code = await login(page);
  const kiosk = await context.newPage();
  await enterRent(kiosk, code);
  await scan(page, 'CALC-1');
  await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
  await kiosk.getByRole('button', { name: '대여 확정', exact: true }).click();
  await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
  await expect(page.locator('.code-number')).not.toHaveText(code);
  await expect(page.locator('.code-number')).toHaveText(/\d{6}/);
  await page.goto('/mobile');
  await expect(page.locator('.product-card').first()).toContainText('4개');
  await page.goto('/mobile/rentals');
  await expect(page.getByText('계산기 001', { exact: true })).toBeVisible();
  await kiosk.getByRole('button', { name: '처음으로', exact: true }).click();
  await kiosk.getByRole('button', { name: /반납하기/ }).click();
  await scan(page, 'CALC-1');
  await expect(kiosk.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
  await expect(kiosk.getByRole('button', { name: '선택한 상태로 계속' })).toBeDisabled();
  await kiosk.getByRole('button', { name: /정상이에요/ }).click();
  await kiosk.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await kiosk.getByRole('button', { name: '반납 확정', exact: true }).click();
  await expect(kiosk.getByRole('heading', { name: '반납이 완료되었습니다' })).toBeVisible();
  await page.goto('/mobile');
  await expect(page.locator('.product-card').first()).toContainText('5개');
  await kiosk.getByRole('button', { name: '처음으로', exact: true }).click();
  await kiosk.getByRole('button', { name: /반납하기/ }).click();
  await scan(page, 'CALC-6');
  await kiosk.getByRole('button', { name: /손상이 있어요/ }).click();
  await kiosk.getByRole('button', { name: '선택한 상태로 계속' }).click();
  await kiosk.getByRole('button', { name: '반납 확정', exact: true }).click();
  await expect(
    kiosk.getByRole('heading', { name: '반납 · 점검 접수가 완료되었습니다' }),
  ).toBeVisible();
  await page.goto('/mobile/history');
  await expect(page.getByText('반납 완료 · 점검 접수')).toBeVisible();
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('tagback.mock.v1')!));
  expect(db.items.find((i: any) => i.id === 'calc-6').status).toBe('inspection');
  expect(db.rentals.filter((r: any) => r.itemId === 'calc-1' && !r.returnedAt)).toHaveLength(0);
});
test('잘못된 코드, 미등록/비활성/불일치 태그, 저장 실패와 응답 유실 복구', async ({
  page,
  context,
}) => {
  const code = await login(page);
  const kiosk = await context.newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByRole('button', { name: /대여하기/ }).click();
  await kiosk.getByRole('button', { name: /공학용 계산기/ }).click();
  await kiosk.getByLabel('일회성 대여 코드').fill(code === '999999' ? '000000' : '999999');
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(kiosk.getByRole('alert')).toContainText('코드가 일치하지');
  await kiosk.getByLabel('일회성 대여 코드').fill(code);
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(
    kiosk.getByRole('heading', { name: '물품의 NFC 태그를 인식해 주세요' }),
  ).toBeVisible();
  for (const [tag, message] of [
    ['UNKNOWN', '등록되지 않은'],
    ['CALC-8', '사용 중지된'],
    ['UMBRELLA-1', '다른 물품'],
    ['CALC-6', '대여 중이거나'],
  ]) {
    await scan(page, tag);
    await expect(kiosk.getByRole('alert')).toContainText(message);
  }
  await scan(page, 'CALC-1');
  await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
  await fault(page, 'save');
  await kiosk.getByRole('button', { name: '대여 확정', exact: true }).click();
  await expect(kiosk.getByRole('alert')).toContainText('저장하지 못했습니다');
  await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).not.toBeVisible();
  await fault(page, 'unknown');
  await kiosk.getByRole('button', { name: '대여 확정', exact: true }).click();
  await expect(kiosk.getByRole('button', { name: '처리 결과 다시 확인' })).toBeVisible();
  await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).not.toBeVisible();
  await kiosk.getByRole('button', { name: '처리 결과 다시 확인' }).click();
  await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
  const count = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('tagback.mock.v1')!).rentals.filter(
        (r: any) => r.itemId === 'calc-1',
      ).length,
  );
  expect(count).toBe(1);
});
test('취소 및 시간 초과 시 코드·개인 정보 초기화', async ({ page, context }) => {
  const code = await login(page);
  const kiosk = await context.newPage();
  await enterRent(kiosk, code);
  await scan(page, 'CALC-1');
  await expect(kiosk.getByText('010-****-5678')).toBeVisible();
  await kiosk.getByRole('button', { name: '이용 취소' }).click();
  await kiosk.getByRole('button', { name: '종료하고 처음으로' }).click();
  await expect(kiosk.getByText('010-****-5678')).not.toBeVisible();
  await kiosk.getByRole('button', { name: /대여하기/ }).click();
  await kiosk.getByRole('button', { name: /공학용 계산기/ }).click();
  await expect(kiosk.getByLabel('일회성 대여 코드')).toHaveValue('');
  await kiosk.getByLabel('일회성 대여 코드').fill(code);
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ reader: true, service: true, sessionSeconds: 3, nextFault: '' }),
    ),
  );
  await expect(kiosk.getByRole('button', { name: /대여하기/ })).toBeVisible({ timeout: 7000 });
  await expect(
    kiosk.getByText('이용 시간이 지나 처음 화면으로 돌아왔습니다. 다시 시작해 주세요.'),
  ).toBeVisible();
  await expect(kiosk.locator('input')).toHaveCount(0);
});
test('만료 코드, 재고 충돌, 연결 끊김, 요청 시간 초과 복구', async ({ page, context }) => {
  let code = await login(page);
  const kiosk = await context.newPage();
  await enterRent(kiosk, code);
  await scan(page, 'CALC-1');
  await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
  await fault(page, 'conflict');
  await kiosk.getByRole('button', { name: '대여 확정', exact: true }).click();
  await expect(kiosk.getByRole('button', { name: '물품 선택부터 다시 진행' })).toBeVisible();
  await kiosk.getByRole('button', { name: '물품 선택부터 다시 진행' }).click();
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tagback.mock.v1')!);
    db.codes.forEach((c: any) => (c.expiresAt = Date.now() - 1));
    localStorage.setItem('tagback.mock.v1', JSON.stringify(db));
  });
  await kiosk.getByRole('button', { name: /공학용 계산기/ }).click();
  await kiosk.getByLabel('일회성 대여 코드').fill(code);
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(kiosk.getByRole('alert')).toContainText('만료된 코드');
  await page.reload();
  await expect(page.locator('.code-number')).toHaveText(/\d{6}/);
  await expect(page.locator('.code-number')).toHaveText(/\d{6}/);
  code = (await page.locator('.code-number').textContent())!;
  await kiosk.getByLabel('일회성 대여 코드').fill(code);
  await fault(page, 'timeout');
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(kiosk.getByRole('alert')).toContainText('시간이 초과');
  await kiosk.getByRole('button', { name: '코드 확인', exact: true }).click();
  await expect(
    kiosk.getByRole('heading', { name: '물품의 NFC 태그를 인식해 주세요' }),
  ).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ reader: false, service: true, nextFault: '', sessionSeconds: 180 }),
    ),
  );
  await expect(kiosk.getByRole('alert')).toContainText('인식기 연결 복구');
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ reader: true, service: true, nextFault: '', sessionSeconds: 180 }),
    ),
  );
  await scan(page, 'CALC-1');
  await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
});
test('디자인 캡처', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/mobile');
  await expect(page.getByRole('heading', { name: '공학용 계산기', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/kiosk');
  await page.screenshot({ path: 'test-results/kiosk.png', fullPage: true });
});
