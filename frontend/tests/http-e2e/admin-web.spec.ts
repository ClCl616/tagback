import { test, expect, type Page } from '@playwright/test';

async function server(page: Page) {
  const state = {
    role: 'ADMIN',
    userId: '1',
    signedIn: true,
    creates: 0,
    attaches: 0,
    deletes: 0,
    statusWrites: 0,
    failTag: false,
    loseCreate: false,
    loseStatus: false,
    failRefresh: false,
    loseTag: false,
  };
  const items = [
    {
      itemId: '101',
      itemName: '공학용 계산기',
      itemTypeId: '1',
      itemTypeName: '공용 물품',
      status: 'AVAILABLE',
    },
    {
      itemId: '102',
      itemName: '우산',
      itemTypeId: '1',
      itemTypeName: '공용 물품',
      status: 'TAG_PENDING',
    },
    {
      itemId: '103',
      itemName: '보조배터리',
      itemTypeId: '1',
      itemTypeName: '공용 물품',
      status: 'RENTED',
    },
    {
      itemId: '104',
      itemName: '긴 이름의 점검용 물품입니다'.repeat(3),
      itemTypeId: '1',
      itemTypeName: '공용 물품',
      status: 'INSPECTION',
    },
  ];
  const tags: Record<string, string> = { '101': '04A210BC', '103': '04A210BE', '104': '04A210BF' };
  const rentals = [
    {
      rentalId: '301',
      userId: '2',
      userName: '김민준',
      itemId: '103',
      itemName: '보조배터리',
      rentalStatus: 'RENTED',
      rentedAt: '2026-11-05T03:00:00Z',
      dueAt: '2026-11-08T03:00:00Z',
      returnedAt: null,
      overdue: false,
    },
    {
      rentalId: '302',
      userId: '3',
      userName: '김민준',
      itemId: '101',
      itemName: '공학용 계산기',
      rentalStatus: 'OVERDUE',
      rentedAt: '2026-11-01T03:00:00Z',
      dueAt: '2026-11-04T03:00:00Z',
      returnedAt: null,
      overdue: true,
    },
    {
      rentalId: '299',
      userId: '2',
      userName: '김민준',
      itemId: '102',
      itemName: '우산',
      rentalStatus: 'RETURNED',
      rentedAt: '2026-10-28T03:00:00Z',
      dueAt: '2026-10-29T03:00:00Z',
      returnedAt: '2026-10-30T03:00:00Z',
      overdue: true,
    },
  ];
  const users = [
    { userId: '2', name: '김민준', occupation: '학생', role: 'USER' },
    { userId: '3', name: '김민준', occupation: '직장인', role: 'USER' },
  ];
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    const ok = (json: unknown, status = 200) => route.fulfill({ status, json });
    const fail = (status: number, code: string, message: string) =>
      ok({ error: { code, message } }, status);
    const session = () => ({
      authenticated: true,
      user: {
        userId: state.userId,
        name: state.userId === '1' ? '운영자' : '다른 관리자',
        occupation: '직원',
        role: state.role,
        maskedPhoneNumber: '010-****-1234',
      },
      sessionExpiresAt: '2030-01-01T00:00:00Z',
    });
    if (path.endsWith('/auth/session'))
      return state.signedIn ? ok(session()) : fail(401, 'SESSION_EXPIRED', '로그인이 필요합니다.');
    if (path.endsWith('/auth/browser-registration')) return ok({ registered: false });
    if (path.endsWith('/auth/logout')) {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/auth/login/phone')) {
      state.signedIn = true;
      return ok({
        user: session().user,
        sessionExpiresAt: '2030-01-01T00:00:00Z',
        browserRegistrationExpiresAt: '2030-01-01T00:00:00Z',
      });
    }
    if (path.endsWith('/item-types'))
      return ok({ itemTypes: [{ itemTypeId: '1', itemTypeName: '공용 물품' }] });
    if (path === '/api/v1/items' && method === 'POST') {
      state.creates++;
      const body = req.postDataJSON();
      const item = {
        itemId: String(200 + state.creates),
        itemName: body.itemName,
        itemTypeId: body.itemTypeId,
        itemTypeName: '공용 물품',
        status: 'TAG_PENDING',
      };
      items.push(item);
      if (state.loseCreate) return route.abort();
      return ok(item, 201);
    }
    const tagMatch = path.match(/^\/api\/items\/(\d+)\/tag$/);
    if (tagMatch) {
      const id = tagMatch[1];
      if (method === 'POST') {
        state.attaches++;
        if (state.failTag) return fail(409, 'TAG_ALREADY_ASSIGNED', '이미 연결된 태그입니다.');
        tags[id] = req.postDataJSON().uid;
        const item = items.find((i) => i.itemId === id);
        if (item) item.status = 'AVAILABLE';
        if (state.loseTag) return route.abort();
      }
      return ok({ tag: tags[id] ? { itemId: Number(id), uid: tags[id], status: 'ACTIVE' } : null });
    }
    const itemMatch = path.match(/^\/api\/v1\/items\/(\d+)(\/status)?$/);
    if (itemMatch) {
      const item = items.find((i) => i.itemId === itemMatch[1]);
      if (!item) return fail(404, 'ITEM_NOT_FOUND', '물품을 찾을 수 없습니다.');
      if (method === 'PATCH') {
        const body = req.postDataJSON();
        if (itemMatch[2]) {
          state.statusWrites++;
          item.status = body.status;
          if (state.loseStatus) return route.abort();
        } else {
          item.itemName = body.itemName;
          item.itemTypeId = body.itemTypeId;
        }
      }
      if (method === 'DELETE') {
        state.deletes++;
        items.splice(items.indexOf(item), 1);
        return route.fulfill({ status: 204 });
      }
      return ok(item);
    }
    if (['/api/v1/items', '/api/v1/admin/users', '/api/v1/admin/rentals'].includes(path)) {
      if (state.failRefresh) return fail(503, 'UNAVAILABLE', '연결 실패');
      const key = path.split('/').at(-1)!;
      const rows = key === 'items' ? items : key === 'users' ? users : rentals;
      const index = Number(url.searchParams.get('page') || 0);
      return ok({
        [key]: rows.slice(index * 100, index * 100 + 100),
        page: index,
        size: 100,
        totalElements: rows.length,
        totalPages: Math.ceil(rows.length / 100),
      });
    }
    return fail(404, 'NOT_FOUND', path);
  });
  return state;
}
test('admin login preserves its requested destination and does not offer administrator signup', async ({
  page,
}) => {
  const state = await server(page);
  state.signedIn = false;
  await page.goto('/admin/tags?selected=102');
  await page.getByRole('link', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('link', { name: '회원가입' })).toHaveCount(0);
  await page.getByLabel('전화번호', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await expect(page).toHaveURL(/\/admin\/tags\?selected=102$/);
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText('우산');
});
test('overview links, direct details, history and same-name users preserve identity and navigation', async ({
  page,
}) => {
  await server(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '현황', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '전체 현황' })).toContainText('등록 물품4');
  await page.goto('/admin/users?selected=2');
  const detail = page.getByRole('complementary', { name: '사용자 상세' });
  await expect(detail).toContainText('학생');
  await expect(detail).toContainText('보조배터리');
  await expect(detail).not.toContainText('공학용 계산기');
  await detail.getByRole('link', { name: '이용 이력 보기' }).click();
  await expect(page).toHaveURL(/user=2/);
  await page.getByRole('button', { name: '우산 상세 보기' }).click();
  await expect(page.getByRole('complementary', { name: '대여 상세' })).toContainText(
    '반납 기한을 넘겨',
  );
  await expect(page.getByRole('button', { name: '반납 확정' })).toHaveCount(0);
  await page.goto('/admin/items?q=우산&selected=102');
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText('태그 미등록');
  await page.getByRole('button', { name: '물품 상세 닫기' }).click();
  await expect(page.getByLabel('물품 검색', { exact: true })).toHaveValue('우산');
  await page.reload();
  await expect(page.getByLabel('물품 검색', { exact: true })).toHaveValue('우산');
});
test('create succeeds once, tag failure retries only linking and reader outage allows manual input', async ({
  page,
}) => {
  const state = await server(page);
  state.failTag = true;
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '물품 등록', exact: true });
  await dialog.getByLabel('물품명', { exact: true }).fill('새 우산');
  await dialog.getByLabel('물품 종류', { exact: true }).selectOption('1');
  await dialog.getByLabel('NFC 태그 UID').fill('04A210BD');
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByRole('alert')).toContainText('이미 연결된 태그');
  await expect(dialog).toContainText('물품 ID 201 저장 완료');
  state.failTag = false;
  await dialog.getByLabel('NFC 태그 UID').fill('04A210AA');
  await dialog.getByRole('button', { name: '태그 연결 재시도' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.creates).toBe(1);
  expect(state.attaches).toBe(2);
  await page.getByRole('button', { name: '새 우산 상세 보기' }).click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText('04A210AA');
  await expect(page.getByRole('button', { name: '물품 삭제', exact: true })).toBeDisabled();
});
test('lost create response blocks resubmission and refresh failure does not repeat a saved mutation', async ({
  page,
}) => {
  const state = await server(page);
  state.loseCreate = true;
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '물품 등록', exact: true });
  await dialog.getByLabel('물품명', { exact: true }).fill('응답 유실 물품');
  await dialog.getByLabel('물품 종류', { exact: true }).selectOption('1');
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog).toContainText('저장 결과가 불명확합니다');
  await expect(dialog.getByRole('button', { name: '등록하기' })).toBeDisabled();
  await dialog.getByRole('button', { name: '닫기', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '응답 유실 물품 상세 보기' })).toBeVisible();
  expect(state.creates).toBe(1);
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  state.loseCreate = false;
  await dialog.getByLabel('물품명', { exact: true }).fill('저장 후 갱신 실패');
  await dialog.getByLabel('물품 종류', { exact: true }).selectOption('1');
  state.failRefresh = true;
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(page.getByRole('status')).toContainText('저장 완료');
  await expect(page.getByRole('alert')).toBeVisible();
  state.failRefresh = false;
  await page.getByRole('button', { name: '다시 시도' }).click();
  expect(state.creates).toBe(2);
  await expect(page.getByRole('button', { name: '저장 후 갱신 실패 상세 보기' })).toBeVisible();
});
test('unknown status response is reconciled, restricted deletion disabled and eligible deletion confirmed', async ({
  page,
}) => {
  const state = await server(page);
  await page.goto('/admin/items?selected=101');
  await page.getByRole('button', { name: '상태 변경', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '상태 변경', exact: true });
  await dialog.getByLabel('변경할 상태').selectOption('inspection');
  await dialog.getByLabel('변경 사유').fill('점검 필요');
  state.loseStatus = true;
  await dialog.getByRole('button', { name: '상태 저장' }).click();
  await expect(dialog.getByRole('button', { name: '상태 저장' })).toBeDisabled();
  await dialog.getByRole('button', { name: '현재 상태 확인' }).click();
  await expect(dialog).toContainText('변경 사유의 저장 여부는');
  await dialog.getByRole('button', { name: '목록 다시 확인' }).click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText('점검 중');
  expect(state.statusWrites).toBe(1);
  await page.goto('/admin/items?selected=102');
  await page.getByRole('button', { name: '물품 삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '삭제 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.deletes).toBe(1);
});
test('tag response loss reconciles existing UID without attaching a second time', async ({
  page,
}) => {
  const state = await server(page);
  state.loseTag = true;
  await page.goto('/admin/tags?selected=102');
  await page.getByLabel('NFC 태그 UID').fill('04A210BD');
  await page.getByRole('button', { name: '태그 연결', exact: true }).click();
  await expect(page.getByLabel('NFC 태그 UID')).toBeDisabled();
  await page.getByRole('button', { name: '연결 확인 및 재시도' }).click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText(
    '이 물품에 태그가 연결되어 있어요.',
  );
  expect(state.attaches).toBe(1);
});
test('session changes clear open drafts, logout returns to login and USER has no admin data', async ({
  page,
}) => {
  const state = await server(page);
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  await page.getByLabel('물품명', { exact: true }).fill('개인 초안');
  state.userId = '5';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.aw-operator')).toContainText('다른 관리자');
  state.role = 'USER';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '관리자 권한이 필요해요' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  state.role = 'ADMIN';
  await page.getByRole('button', { name: '다시 시도' }).click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toHaveCount(0);
});
test('admin layout, dialogs and focus remain usable on narrow and wide screens', async ({
  page,
}) => {
  test.setTimeout(90000);
  await server(page);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    for (const path of [
      '/admin',
      '/admin/items',
      '/admin/items?selected=104',
      '/admin/tags?selected=102',
      '/admin/rentals?selected=302',
      '/admin/history',
      '/admin/users?selected=2',
    ]) {
      await page.goto(path);
      await expect(page.locator('.aw-heading h1')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        width + ' ' + path,
      ).toBe(true);
      if (
        [390, 1440].includes(width) &&
        [
          '/admin',
          '/admin/items',
          '/admin/tags?selected=102',
          '/admin/rentals?selected=302',
        ].includes(path)
      )
        await page.screenshot({
          path:
            'test-results/admin-' +
            width +
            '-' +
            path.replaceAll('/', '-').replaceAll('?', '-').replaceAll('=', '-') +
            '.png',
          fullPage: true,
        });
    }
    await page.goto('/admin/items');
    await page.getByRole('button', { name: '물품 등록', exact: true }).click();
    await expect(page.getByLabel('물품명', { exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '물품 등록', exact: true })).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/items');
  await page.evaluate(() => {
    document.body.style.zoom = '2';
  });
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '물품 등록', exact: true })).toBeFocused();
});
