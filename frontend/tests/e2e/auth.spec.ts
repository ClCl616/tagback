import { test, expect } from '@playwright/test';
import { loginMobile, smsVerify, enterProfile } from './auth-helpers';

test('PIN 정책·재입력·등록 자동화·로그아웃 후 PIN 진입', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/mobile/signup?next=%2Fmobile%2Faccount');
  await enterProfile(page);
  await smsVerify(page, '01077776666');
  await page.getByLabel('PIN 번호').fill('123456');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('전체가 연속');
  await expect(page.getByRole('alert')).not.toContainText('3번');
  await page.getByLabel('PIN 번호').fill('041888');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('같은 숫자를 3번');
  await expect(page.getByRole('alert')).not.toContainText('6자리 전체');
  await page.screenshot({ path: 'test-results/pin-policy-320.png', fullPage: true });
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await page.getByLabel('PIN 번호').fill('246802');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('일치하지');
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page.getByRole('heading', { name: '마이페이지' })).toBeVisible();
  await expect(page.locator('.auth-success')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이 브라우저 등록 해제' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/mypage-320.png', fullPage: true });
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PIN 번호를 입력해 주세요.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/pin-login-320.png', fullPage: true });
  await expect(page.getByRole('button', { name: '다른 계정으로 로그인' })).toHaveCount(0);
  await page.getByRole('button', { name: '0', exact: true }).click();
  await page.getByRole('button', { name: '4', exact: true }).click();
  await page.getByRole('button', { name: '한 자리 지우기' }).click();
  await expect(page.getByLabel('PIN 번호')).toHaveValue('0');
  await expect(page.getByRole('button', { name: '이 브라우저 등록 해제' })).toHaveCount(0);
});

test('SMS 오류·만료·번호 변경, 기존 회원 가입 경로는 PIN 로그인', async ({ page }) => {
  await page.clock.install();
  await page.goto('/mobile/signup');
  await enterProfile(page);
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await page.getByLabel('SMS 인증번호').fill('000000');
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('일치하지');
  await page.clock.fastForward(301000);
  await expect(
    page.getByText('인증번호가 만료되었습니다. 다시 발송해 주세요.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '인증번호 재발송', exact: true }).click();
  await page.getByLabel('전화번호', { exact: true }).fill('01088887777');
  await expect(page.getByLabel('SMS 인증번호')).toHaveCount(0);
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.clock.fastForward(61000);
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await page.getByLabel('SMS 인증번호').fill('123456');
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PIN 번호를 입력해 주세요.' })).toBeVisible();
  await expect(page.getByText('기존 계정을 확인했습니다.', { exact: false })).toBeVisible();
});

test('PIN 5회 대기·새로고침 제한 유지·성공 복구', async ({ page }) => {
  await page.clock.install();
  await loginMobile(page, '/mobile/account');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('PIN 번호').fill('246802');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: '확인 중…', exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('alert')).toContainText('남은 시간:');
  await page.reload();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeDisabled();
  await page.clock.fastForward(31000);
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile$/);
});

test('다른 브라우저 로그인 시뮬레이션으로 세션·등록 폐기', async ({ page, context }) => {
  await loginMobile(page, '/mobile/account');
  // Advance only resend eligibility in shared mock storage; the second client has separate credentials.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tagback.mock.v1')!);
    db.auth.sms.forEach((s: any) => (s.resendAt = 0));
    localStorage.setItem('tagback.mock.v1', JSON.stringify(db));
  });
  const sim = await context.newPage();
  await sim.goto('/dev/simulator');
  await sim.getByRole('button', { name: '다른 브라우저 로그인 시연 (기본 계정)' }).click();
  await expect(page.getByRole('alert')).toContainText('다른 브라우저');
  await expect(page.getByLabel('전화번호', { exact: true })).toBeVisible();
});

test('PIN 복구 보류와 승인된 복구, 자동 로그인 없음', async ({ page, context }) => {
  await page.goto('/mobile/recover');
  await smsVerify(page);
  await expect(page.getByRole('heading', { name: '추가 확인이 필요해요.' })).toBeVisible();
  const sim = await context.newPage();
  await sim.goto('/dev/simulator');
  await sim.getByRole('button', { name: '이 번호 복구 승인 시연' }).click();
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tagback.mock.v1')!);
    db.auth.sms.forEach((s: any) => (s.resendAt = 0));
    localStorage.setItem('tagback.mock.v1', JSON.stringify(db));
  });
  await page.reload();
  await smsVerify(page);
  await page.getByLabel('PIN 번호').fill('246802');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await page.getByLabel('PIN 번호').fill('246802');
  await page.getByRole('button', { name: 'PIN 재설정', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PIN이 재설정되었습니다.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tagback.mobile.token'))).toBeNull();
});

test('전화번호 변경 후 기록 보존·인증 해제', async ({ page }) => {
  await loginMobile(page, '/mobile/account');
  await page.getByRole('link', { name: '전화번호 변경', exact: true }).click();
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '계정 확인', exact: true }).click();
  await smsVerify(page, '01055554444');
  await page.getByRole('button', { name: '전화번호 변경 확정' }).click();
  await expect(page.getByRole('heading', { name: '전화번호가 변경되었습니다.' })).toBeVisible();
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('tagback.mock.v1')!));
  expect(db.users.find((u: any) => u.id === 'demo').phone).toBe('01055554444');
  expect(db.rentals).toHaveLength(3);
});

test('가입 저장 실패 및 응답 유실은 확인 전 완료 금지', async ({ page }) => {
  await page.goto('/mobile/signup');
  await enterProfile(page);
  await smsVerify(page, '01077778888');
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await page.getByLabel('PIN 번호').fill('048259');
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ nextTarget: 'auth', nextFault: 'save' }),
    ),
  );
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('저장하지 못');
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ nextTarget: 'auth', nextFault: 'unknown' }),
    ),
  );
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page.getByRole('heading', { name: '처리 결과를 확인해 주세요.' })).toBeVisible();
  await page.reload();
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ nextTarget: 'auth', nextFault: 'network' }),
    ),
  );
  await page.getByRole('button', { name: '처리 결과 다시 확인' }).click();
  await expect(page.getByRole('alert')).toContainText('네트워크');
  await page.reload();
  await page.getByRole('button', { name: '처리 결과 다시 확인' }).click();
  await expect(page.getByRole('heading', { name: '마이페이지' })).toBeVisible();
});

test('로그인 SMS 생략과 가입 SMS 배치·오류 안의 재발송 타이머', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.clock.install();
  await page.goto('/mobile/login');
  await expect(page.getByRole('heading', { name: '전화번호를 입력해 주세요.' })).toBeVisible();
  await expect(page.getByRole('button', { name: '인증번호 발송', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/phone-login-320.png', fullPage: true });
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByLabel('PIN 번호')).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('tagback.mock.v1')!)?.auth?.sms?.length || 0,
    ),
  ).toBe(0);
  await page.getByRole('link', { name: '회원가입' }).click();
  await enterProfile(page);
  await page.getByLabel('전화번호', { exact: true }).fill('01077775555');
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  const sms = await page.getByLabel('SMS 인증번호').boundingBox();
  const confirm = await page
    .getByRole('button', { name: '인증번호 확인', exact: true })
    .boundingBox();
  const resend = await page
    .getByRole('button', { name: '인증번호 재발송', exact: true })
    .boundingBox();
  expect(sms!.y).toBeLessThan(confirm!.y);
  expect(confirm!.y).toBeLessThan(resend!.y);
  await page.getByRole('button', { name: '인증번호 재발송', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    '인증번호 재발송을 잠시 기다려 주세요. 남은 시간:',
  );
  await page.clock.fastForward(61000);
  await expect(page.getByRole('alert')).toContainText('남은 시간: 0초');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText(/시연 인증번호가|모의 인증|로그인하면 현재 브라우저/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/signup-sms-320.png', fullPage: true });
});

test('개인정보 필수 입력과 가입 후 마이페이지 이름·직업 저장', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/mobile/signup?next=%2Fmobile%2Faccount');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('이름과 직업');
  await page.getByLabel('이름', { exact: true }).fill('홍길동');
  await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.screenshot({ path: 'test-results/signup-profile-320.png', fullPage: true });
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await smsVerify(page, '01044443333');
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await page.getByLabel('PIN 번호').fill('048259');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page.getByRole('heading', { name: '홍길동님' })).toBeVisible();
  await expect(page.getByText('학생', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '홍길동님' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: /대여 중/ }).click();
  await expect(page).toHaveURL(/mobile\/rentals$/);
});

test('대여 코드 3분 만료 후 자동 갱신', async ({ page }) => {
  await page.clock.install();
  await loginMobile(page);
  await expect(page.locator('.code-number')).toHaveText(/\d{6}/);
  const original = await page.locator('.code-number').textContent();
  await expect(page.getByRole('button', { name: '새 코드 확인하기' })).toHaveCount(0);
  await expect(page.locator('.code-card')).toContainText(/0[23]:[0-5][0-9] 남음/);
  await page.clock.fastForward(181000);
  await expect(page.locator('.code-number')).toHaveText(/\d{6}/);
  await expect(page.locator('.code-number')).not.toHaveText(original!);
});
