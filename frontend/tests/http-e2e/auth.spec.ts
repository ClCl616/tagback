import { test, expect, type Page } from '@playwright/test';
async function fixture(page: Page, lose = false) {
  const state = { signedIn: false, writes: 0, name: '카카오 별명', next: '/mobile/code' };
  const user = () => ({
    userId: '88',
    name: state.name,
    occupation: '학생',
    role: 'USER',
    maskedPhoneNumber: '',
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/kakao/start'))
      return route.fulfill({
        json: { url: 'https://kauth.kakao.com/oauth/authorize?state=fixture' },
      });
    if (path.endsWith('/kakao/pending'))
      return route.fulfill({
        json: { needsSignup: !state.signedIn, nickname: '카카오 별명', next: state.next },
      });
    if (path.endsWith('/kakao/complete')) {
      state.writes++;
      state.name = route.request().postDataJSON().name;
      if (lose && state.writes === 1) return route.abort();
      state.signedIn = true;
      return route.fulfill({ json: { next: state.next, userId: '88' } });
    }
    if (path.endsWith('/logout')) {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path.includes('/auth/'))
      return state.signedIn
        ? route.fulfill({
            json: {
              authenticated: true,
              user: user(),
              sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
            },
          })
        : route.fulfill({
            status: 401,
            json: { error: { code: 'SESSION_REQUIRED', message: '로그인 필요' } },
          });
    if (path.includes('/rentals'))
      return route.fulfill({
        json: { rentals: [], page: 0, size: 100, totalElements: 0, totalPages: 0 },
      });
    return route.fulfill({
      json: { items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 },
    });
  });
  await page.route('https://kauth.kakao.com/**', (route) =>
    route.fulfill({ status: 302, headers: { Location: 'http://localhost:5175/mobile/signup' } }),
  );
  return state;
}
test('Kakao login enters editable nickname and occupation signup without PIN or phone', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/mobile/login?next=%2Fmobile%2Fcode');
  await expect(page.getByLabel('PIN 번호')).toHaveCount(0);
  await expect(page.getByLabel('전화번호')).toHaveCount(0);
  await page.getByRole('button', { name: '카카오 로그인', exact: true }).click();
  await expect(page.getByLabel('닉네임')).toHaveValue('카카오 별명');
  await page.getByLabel('닉네임').fill('수정 별명');
  await page.getByLabel('직업').selectOption('학생');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/code$/);
  expect(state.writes).toBe(1);
  expect(state.name).toBe('수정 별명');
});
test('lost completion response preserves the same profile and offers an explicit retry', async ({
  page,
}) => {
  const state = await fixture(page, true);
  await page.goto('/mobile/signup');
  await page.getByLabel('닉네임').fill('수정 후 응답 유실');
  await page.getByLabel('직업').selectOption('학생');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByLabel('닉네임')).toBeDisabled();
  await page.getByRole('button', { name: '가입 결과 다시 확인', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/code$/);
  expect(state.writes).toBe(2);
  expect(state.name).toBe('수정 후 응답 유실');
});
test('valid session bypasses login and removed recovery routes never show PIN', async ({
  page,
}) => {
  const state = await fixture(page);
  state.signedIn = true;
  await page.goto('/mobile/login?next=%2Fmobile%2Fcode');
  await expect(page).toHaveURL(/\/mobile\/code$/);
  state.signedIn = false;
  await page.goto('/mobile/recover');
  await expect(page).toHaveURL(/\/mobile\/login$/);
  await expect(page.getByRole('button', { name: '카카오 로그인', exact: true })).toBeVisible();
  await expect(page.getByText('PIN 재설정', { exact: true })).toHaveCount(0);
});
test('cancellation and failure stay retryable, without a false signup success', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/mobile/login?oauth=cancelled');
  await expect(page.getByText('로그인을 취소했습니다.', { exact: true })).toBeVisible();
  await page.goto('/mobile/login?oauth=failed');
  await expect(page.getByRole('button', { name: '카카오 로그인', exact: true })).toBeEnabled();
  await expect(page.getByLabel('닉네임')).toHaveCount(0);
});
test('account switch sends intent and external next is sanitized', async ({ page }) => {
  await fixture(page);
  let body: any;
  await page.route('**/api/v1/auth/kakao/start', (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { url: 'https://kauth.kakao.com/oauth/authorize?state=x' } });
  });
  await page.goto('/mobile/login?next=https://evil.example');
  await page.getByRole('button', { name: '다른 카카오 계정 사용', exact: true }).click();
  await expect(page.getByLabel('닉네임')).toBeVisible();
  expect(body).toEqual({ next: '/mobile', switchAccount: true });
});

test('reload after lost session cookie resumes an existing signup without asking for profile again', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/v1/auth/kakao/pending', (route) =>
    route.fulfill({
      json: { needsSignup: false, nickname: '별명', next: '/mobile/code', userId: '88' },
    }),
  );
  await page.goto('/mobile/signup');
  await expect(page.getByLabel('직업')).toHaveCount(0);
  await page.getByRole('button', { name: '로그인 계속', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/code$/);
});
