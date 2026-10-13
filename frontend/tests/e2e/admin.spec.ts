import { test, expect, type Page } from '@playwright/test';

async function scan(page: Page, tag: string) {
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: /^(등록하기|태그 연결 재시도|변경사항 저장|태그 연결)$/ }),
  ).toBeEnabled();
  await page.evaluate((tag) => {
    const c = new BroadcastChannel('tagback-nfc');
    c.postMessage({ tag });
    c.close();
  }, tag);
  await expect(page.getByRole('dialog').getByLabel('태그 ID', { exact: true })).toHaveValue(tag);
}

test('물품 이미지 검증·저장·새로고침·삭제 취소와 필수 검증', async ({ page }) => {
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /물품 등록|물품 수정/ });
  const input = dialog.locator('input[type=file]');
  await input.setInputFiles({
    name: 'wrong.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('text'),
  });
  await expect(dialog.getByRole('alert')).toContainText('JPG, PNG, WEBP');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await input.setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('broken'),
  });
  await expect(dialog.getByRole('alert')).toContainText('읽을 수 없습니다');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await input.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(dialog.getByRole('alert')).toContainText('5MB 이하');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await input.setInputFiles('public/images/admin-reference.png');
  await expect(dialog.getByAltText('선택한 물품 이미지 미리보기')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: '변경사항 저장' }).click();
  await expect(dialog).not.toBeVisible();
  const detail = page.getByRole('complementary', { name: '물품 상세' });
  await expect(detail.getByAltText('계산기 001 이미지')).toBeVisible();
  await page.reload();
  await expect(detail.getByAltText('계산기 001 이미지')).toBeVisible();
  await page.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await dialog.getByRole('button', { name: '이미지 삭제' }).click();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(detail.getByAltText('계산기 001 이미지')).toBeVisible();
  await page.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await dialog.getByRole('button', { name: '이미지 삭제' }).click();
  await dialog.getByRole('button', { name: '변경사항 저장' }).click();
  await expect(dialog.getByRole('alert')).toContainText('물품 이미지를 등록해 주세요');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(detail.getByAltText('계산기 001 이미지')).toBeVisible();
});

test('관리자 등록·중복 태그·수정·모바일 재고 연동', async ({ page }) => {
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto('/admin/items');
  await expect(page.getByRole('heading', { name: '물품 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '계산기 001 메뉴' })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /물품 등록|물품 수정/ });
  await dialog.getByLabel('카테고리', { exact: true }).fill('학습 용품');
  await dialog.getByRole('button', { name: '학습 용품', exact: true }).click();
  await dialog.getByLabel('관리번호', { exact: true }).fill('099');
  await dialog.getByLabel('물품명', { exact: true }).fill('공학용 계산기');
  await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
  await expect(dialog.getByAltText('선택한 물품 이미지 미리보기')).toBeVisible();
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tagback.mock.v1')!);
    db.items[0].tag = '04A23B1C';
    localStorage.setItem('tagback.mock.v1', JSON.stringify(db));
  });
  await scan(page, '04A23B1C');
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByRole('alert')).toContainText('이미 등록된 태그');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await expect(dialog.getByLabel('물품명', { exact: true })).toBeDisabled();
  await scan(page, '04000099');
  await dialog.getByRole('button', { name: '태그 연결 재시도' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.admin-notice')).toHaveCount(0);
  await page.getByRole('button', { name: '공학용 계산기 099 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await dialog.getByRole('radio', { name: '수리 중', exact: true }).check();
  await dialog.getByRole('button', { name: '변경사항 저장' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '공학용 계산기 099 상세 보기' }) }),
  ).toContainText('수리 중');
  await page.reload();
  await page.getByRole('textbox', { name: '물품 검색' }).fill('공학용 계산기 099');
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '공학용 계산기 099 상세 보기' }) }),
  ).toContainText('수리 중');
  await page.getByRole('textbox', { name: '물품 검색' }).fill('');
  await page.getByRole('button', { name: '계산기 006 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: '대여 중', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.goto('/mobile/items/calc?station=engineering');
  await expect(page.getByRole('heading', { name: '공학용 계산기' })).toBeVisible();
});

test('관리자 저장 실패 입력 유지·검색·모바일 레이아웃', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /물품 등록|물품 수정/ });
  await dialog.getByLabel('카테고리', { exact: true }).fill('생활 용품');
  await dialog.getByRole('button', { name: '생활 용품', exact: true }).click();
  await dialog.getByLabel('관리번호', { exact: true }).fill('099');
  await dialog.getByLabel('물품명', { exact: true }).fill('공용 우산');
  await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
  await expect(dialog.getByAltText('선택한 물품 이미지 미리보기')).toBeVisible();
  await scan(page, '04000199');
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ nextFault: 'save', nextTarget: 'save' }),
    ),
  );
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByRole('alert')).toContainText('저장하지 못했습니다');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await expect(dialog.getByLabel('물품명', { exact: true })).toHaveValue('공용 우산');
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('textbox', { name: '물품 검색' }).fill('찾을수없는물품');
  await expect(page.getByText('조건에 맞는 물품이 없어요')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('다른 탭의 변경을 오래된 편집본으로 덮어쓰지 않음', async ({ page, context }) => {
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const other = await context.newPage();
  await other.goto('/admin/items');
  await other.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await other.getByRole('button', { name: '수정', exact: true }).click();
  await other.getByRole('radio', { name: '점검 중', exact: true }).check();
  await other.getByRole('button', { name: '변경사항 저장' }).click();
  await expect(other.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('관리번호', { exact: true }).fill('999');
  await page.getByRole('button', { name: '변경사항 저장' }).click();
  await expect(page.getByRole('alert')).toContainText('다른 화면에서 물품이 변경');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '계산기 001 상세 보기' }) }),
  ).toContainText('점검 중');
});

test('물품 선택 상세 패널·상태 필터·스크롤 목록', async ({ page }) => {
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '계산기 002 상세 보기' }).click();
  const detail = page.getByRole('complementary', { name: '물품 상세' });
  await expect(detail.getByRole('heading', { name: '계산기', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '물품 수정', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('물품명', { exact: true })).toHaveValue(
    '계산기',
  );
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('button', { name: '다음 페이지', exact: true })).toHaveCount(0);
  await expect(page.locator('.admin-table tbody tr')).toHaveCount(14);
  await page.getByRole('button', { name: '계산기 003 상세 보기' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '계산기 003 상세 보기' })).toBeVisible();
  await page.getByRole('combobox', { name: '물품 상태 필터' }).selectOption('rented');
  await expect(page.getByRole('button', { name: '계산기 006 상세 보기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '계산기 002 상세 보기' })).toHaveCount(0);
});

test('카테고리 즉시 추가·중복 방지·새 물품 등록·재접속 유지', async ({ page }) => {
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  await page.getByLabel('카테고리', { exact: true }).fill('운동 용품');
  await page.getByLabel('카테고리', { exact: true }).press('Enter');
  await expect(page.getByLabel('카테고리', { exact: true })).toHaveValue('운동 용품');
  const dialog = page.getByRole('dialog', { name: /물품 등록|물품 수정/ });
  await dialog.getByLabel('카테고리', { exact: true }).fill(' 운동   용품 ');
  await dialog.getByLabel('카테고리', { exact: true }).press('Enter');
  await expect(dialog.getByLabel('카테고리', { exact: true })).toHaveValue('운동 용품');
  await dialog.getByLabel('카테고리', { exact: true }).click();
  await expect(dialog.getByRole('button', { name: '운동 용품', exact: true })).toHaveCount(1);
  await dialog.getByLabel('카테고리', { exact: true }).press('Escape');
  await dialog.getByLabel('물품명', { exact: true }).fill('축구공');
  await dialog.getByLabel('관리번호', { exact: true }).fill('001');
  await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
  await expect(dialog.getByAltText('선택한 물품 이미지 미리보기')).toBeVisible();
  await scan(page, '04000299');
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '축구공 001 상세 보기' })).toBeVisible();
  await page.reload();
  await page.getByLabel('카테고리 필터', { exact: true }).selectOption('운동 용품');
  await expect(page.locator('.admin-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '축구공 001 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await expect(dialog.getByLabel('카테고리', { exact: true })).toHaveValue('운동 용품');
  await expect(dialog.getByLabel('물품명', { exact: true })).toHaveValue('축구공');
});

test('이미지 없는 신규 등록 차단 및 불필요한 목록 조작 제거', async ({ page }) => {
  await page.goto('/admin/items');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '목록 간격 줄이기' })).toHaveCount(0);
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /물품 등록|물품 수정/ });
  await dialog.getByLabel('카테고리', { exact: true }).fill('학습 용품');
  await dialog.getByRole('button', { name: '학습 용품', exact: true }).click();
  await dialog.getByLabel('물품명', { exact: true }).fill('공학용 계산기');
  await dialog.getByLabel('관리번호', { exact: true }).fill('100');
  await scan(page, '04000399');
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByRole('alert')).toContainText('물품 이미지를 등록해 주세요');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await expect(dialog).toBeVisible();
});

test('행 선택·물품 삭제 확인 및 대여 중 삭제 차단', async ({ page }) => {
  await page.goto('/admin/items');
  await page
    .getByRole('row', { name: '계산기 002 선택', exact: true })
    .getByText('CALC-2', { exact: true })
    .click();
  await expect(page.getByRole('complementary', { name: '물품 상세' })).toContainText('CALC-2');
  await page.getByRole('button', { name: '계산기 002 메뉴' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '물품 삭제' });
  await confirm.getByRole('button', { name: '취소' }).click();
  await expect(page.getByRole('button', { name: '계산기 002 메뉴' })).toBeVisible();
  await page.getByRole('button', { name: '계산기 002 메뉴' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await confirm.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '계산기 002 메뉴' })).toHaveCount(0);
  await page.getByRole('button', { name: '계산기 006 메뉴' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await confirm.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(confirm.getByRole('alert')).toContainText('대여 중');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
});

test('카테고리 편집 전용·삭제 보호·반응형 편집창·드롭 이미지', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/items');
  await expect(page.getByLabel('카테고리 필터').locator('option[value="__add"]')).toHaveCount(0);
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /물품 등록|물품 수정/ });
  await dialog.getByLabel('카테고리', { exact: true }).fill('빈 카테고리');
  await dialog.getByLabel('카테고리', { exact: true }).press('Enter');
  await expect(dialog.getByLabel('카테고리', { exact: true })).toHaveValue('빈 카테고리');
  await dialog.getByLabel('카테고리', { exact: true }).click();
  await dialog.getByRole('button', { name: '빈 카테고리 카테고리 삭제' }).click();
  const confirmation = page.getByRole('dialog', { name: '정말로 삭제하시겠습니까?' });
  await expect(confirmation).toBeVisible();
  await page.screenshot({ path: 'test-results/category-confirm.png' });
  await confirmation.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dialog.getByLabel('카테고리', { exact: true })).toHaveValue('빈 카테고리');
  await dialog.getByLabel('카테고리', { exact: true }).click();
  await dialog.getByRole('button', { name: '빈 카테고리 카테고리 삭제' }).click();
  await confirmation.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await dialog.getByLabel('카테고리', { exact: true }).fill('학습 용품');
  await dialog.getByRole('button', { name: '학습 용품', exact: true }).click();
  await dialog.getByLabel('카테고리', { exact: true }).click();
  await page.screenshot({ path: 'test-results/category-list.png' });
  await dialog.getByRole('button', { name: '학습 용품 카테고리 삭제' }).click();
  await confirmation.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('삭제할 수 없습니다');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await confirmation.getByRole('button', { name: '취소', exact: true }).click();
  const transfer = await page.evaluateHandle(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 30;
    canvas.height = 30;
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (c) =>
      c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    return data;
  });
  await dialog
    .getByRole('button', { name: '물품 이미지 선택' })
    .dispatchEvent('drop', { dataTransfer: transfer });
  await expect(dialog.getByAltText('선택한 물품 이미지 미리보기')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '등록하기' })).toBeEnabled();
  await dialog.getByRole('radio', { name: '점검 중' }).check();
  await page.screenshot({ path: 'test-results/editor-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/editor-mobile.png' });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('모든 제목 정렬 순환 및 이미지 기본 상태·삭제 버튼 위치', async ({ page }) => {
  await page.goto('/admin/items');
  const rows = page.locator('.admin-table tbody tr');
  await expect(rows).toHaveCount(14);
  const initial = await rows.evaluateAll((elements) =>
    elements.map((el) => el.getAttribute('aria-label')),
  );
  for (const [name, column] of [
    ['물품명', 0],
    ['관리번호', 1],
    ['태그 ID', 2],
    ['상태', 3],
  ] as const) {
    const heading = page.getByRole('columnheader', { name: new RegExp(name) });
    await heading.getByRole('button').click();
    await expect(heading).toHaveAttribute('aria-sort', 'ascending');
    const read = () =>
      rows.evaluateAll(
        (elements, index) =>
          elements.map(
            (el) =>
              (index === 0
                ? el.querySelector('strong')
                : el.children[index]
              )?.textContent?.trim() || '',
          ),
        column,
      );
    const ascending = await read();
    const compare = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }).compare;
    expect(ascending).toEqual([...ascending].sort(compare));
    await heading.getByRole('button').click();
    await expect(heading).toHaveAttribute('aria-sort', 'descending');
    expect(await read()).toEqual([...ascending].sort((a, b) => compare(b, a)));
    await heading.getByRole('button').click();
    await expect(heading).toHaveAttribute('aria-sort', 'none');
    expect(
      await rows.evaluateAll((elements) => elements.map((el) => el.getAttribute('aria-label'))),
    ).toEqual(initial);
  }
  await page.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '물품 수정' });
  await expect(dialog.getByRole('img', { name: '기본 물품 이미지' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '이미지 삭제' })).toHaveCount(0);
  await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
  const remove = dialog.getByRole('button', { name: '이미지 삭제' });
  await expect(remove).toBeEnabled();
  const card = await dialog.getByRole('button', { name: '물품 이미지 선택' }).boundingBox();
  const button = await remove.boundingBox();
  expect(button!.y).toBeGreaterThanOrEqual(card!.y + card!.height);
  await remove.click();
  await expect(remove).toHaveCount(0);
  await expect(dialog.getByRole('img', { name: '기본 물품 이미지' })).toBeVisible();
  await page.screenshot({ path: 'test-results/default-image.png' });
});

test('파일 선택 취소는 편집창과 입력을 유지하며 빈 공간과 필터는 선택 해제', async ({ page }) => {
  await page.goto('/admin/items');
  const detail = page.getByRole('complementary', { name: '물품 상세' });
  await page.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '물품 수정' });
  await dialog.getByLabel('물품명', { exact: true }).fill('입력 유지');
  const file = dialog.locator('input[type=file]');
  // Reproduce the native file input cancel event, including its bubbling behavior.
  await file.dispatchEvent('cancel', { bubbles: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('물품명', { exact: true })).toHaveValue('입력 유지');
  await file.setInputFiles('public/images/admin-reference.png');
  await expect(dialog.getByRole('button', { name: '변경사항 저장' })).toBeEnabled();
  await file.dispatchEvent('cancel', { bubbles: true });
  await expect(dialog.getByAltText('선택한 물품 이미지 미리보기')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(detail).toBeVisible();
  await detail.getByRole('heading', { name: '물품 상세', exact: true }).click();
  await expect(detail).toBeVisible();
  await page.locator('.admin-pagination').click();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('물품을 선택해 주세요');
  for (const target of [
    page.getByLabel('카테고리 필터'),
    page.getByLabel('물품 상태 필터'),
    page.getByLabel('물품 검색'),
  ]) {
    await page.getByRole('button', { name: '계산기 002 상세 보기' }).click();
    await expect(detail).toBeVisible();
    await target.click();
    await page.keyboard.press('Escape');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('물품을 선택해 주세요');
    await expect(page.locator('.admin-table tr.is-selected')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '계산기 002 상세 보기' }).click();
  await expect(detail).toBeVisible();
});

test('다른 탭의 상태 변경 자동 동기화 및 상세 패널 고정', async ({ page, context }) => {
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '계산기 001 상세 보기' }).click();
  const detail = page.getByRole('complementary', { name: '물품 상세' });
  const before = await detail.boundingBox();
  const other = await context.newPage();
  await other.goto('/admin/items');
  await other.getByRole('button', { name: '계산기 001 메뉴' }).click();
  await other.getByRole('button', { name: '수정', exact: true }).click();
  await other.getByRole('dialog').getByRole('radio', { name: '점검 중', exact: true }).check();
  await other.getByRole('button', { name: '변경사항 저장' }).click();
  await expect(other.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('row', { name: '계산기 001 선택', exact: true })).toContainText(
    '점검 중',
  );
  await expect(detail.locator('.admin-status')).toHaveText('점검 중');
  await expect(page.locator('.admin-notice')).toHaveCount(0);
  await page.locator('.admin-pagination').click();
  await expect(detail).toContainText('물품을 선택해 주세요');
  const after = await detail.boundingBox();
  expect(after!.x).toBe(before!.x);
  expect(after!.width).toBe(before!.width);
  await page.getByLabel('카테고리 필터').selectOption('생활 용품');
  await expect(detail).toBeVisible();
  await page.screenshot({ path: 'test-results/fixed-detail.png' });
});

test('태그 미등록 물품 재개·중복 UID 실패·새 창 연결 완료', async ({ page }) => {
  await page.goto('/admin/items');
  await expect(page.getByRole('button', { name: '계산기 001 메뉴' })).toBeVisible();
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tagback.mock.v1')!);
    db.items[0].tag = '';
    db.items[0].active = false;
    db.items[1].tag = '04A23B1C';
    localStorage.setItem('tagback.mock.v1', JSON.stringify(db));
    window.dispatchEvent(new Event('tagback-change'));
  });
  await page.getByRole('button', { name: '계산기 001 상세 보기' }).click();
  const detail = page.getByRole('complementary', { name: '물품 상세' });
  await expect(detail).toContainText('태그 미등록');
  await detail.getByRole('button', { name: 'NFC 태그 연결 / 물품 수정' }).click();
  await scan(page, '04A23B1C');
  await page.getByRole('dialog').getByRole('button', { name: '태그 연결', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '확인해 주세요', exact: true }).getByRole('alert'),
  ).toContainText('이미 등록된 태그');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await page.reload();
  await expect(detail).toContainText('태그 미등록');
  await detail.getByRole('button', { name: 'NFC 태그 연결 / 물품 수정' }).click();
  await scan(page, '04000077');
  // Simulate a committed write whose response is lost.
  await page.evaluate(() => {
    window.addEventListener(
      'tagback-change',
      () => {
        localStorage.setItem(
          'tagback.mock.controls',
          JSON.stringify({ nextFault: 'unknown', nextTarget: 'save' }),
        );
      },
      { once: true },
    );
  });
  await page.getByRole('dialog').getByRole('button', { name: '태그 연결', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('같은 물품과 UID');
  await expect(page.getByRole('dialog').getByLabel('태그 ID', { exact: true })).toBeDisabled();
  await page.evaluate(() => {
    const channel = new BroadcastChannel('tagback-nfc');
    channel.postMessage({ tag: '04000098' });
    channel.close();
  });
  await expect(page.getByRole('dialog').getByLabel('태그 ID', { exact: true })).toHaveValue(
    '04000077',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '태그 연결 재시도', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(detail).toContainText('04000077');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('tagback.mock.v1')!).items.length),
  ).toBe(14);
});

test('생성 응답 유실 확인 후 두 단계 완료·중복 제출 방지', async ({ page }) => {
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('카테고리', { exact: true }).fill('학습 용품');
  await dialog.getByRole('button', { name: '학습 용품', exact: true }).click();
  await dialog.getByLabel('물품명', { exact: true }).fill('통신 테스트');
  await dialog.getByLabel('관리번호', { exact: true }).fill('010');
  await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
  await scan(page, '04000088');
  await page.evaluate(() =>
    localStorage.setItem(
      'tagback.mock.controls',
      JSON.stringify({ nextFault: 'unknown', nextTarget: 'save' }),
    ),
  );
  await dialog.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(dialog.getByRole('button', { name: '처리 중…' })).toBeDisabled();
  await expect(dialog).not.toBeVisible();
  const rows = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tagback.mock.v1')!).items.filter(
      (i: { label: string }) => i.label === '통신 테스트 010',
    ),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].tag).toBe('04000088');
});

test('신규 물품 부분 성공 후 창을 닫아도 생성 ID로 연결 재개', async ({ page }) => {
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('카테고리', { exact: true }).fill('학습 용품');
  await dialog.getByRole('button', { name: '학습 용품', exact: true }).click();
  await dialog.getByLabel('물품명', { exact: true }).fill('재개 테스트');
  await dialog.getByLabel('관리번호', { exact: true }).fill('011');
  await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
  await scan(page, '04000011');
  await page.evaluate(() => {
    window.addEventListener(
      'tagback-change',
      () => {
        localStorage.setItem(
          'tagback.mock.controls',
          JSON.stringify({ nextFault: 'save', nextTarget: 'save' }),
        );
      },
      { once: true },
    );
  });
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByRole('status')).toContainText('태그 연결은 완료되지 않았습니다');
  await page
    .getByRole('dialog', { name: '확인해 주세요', exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
  const createdId = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('tagback.mock.v1')!).items.find(
        (i: { label: string }) => i.label === '재개 테스트 011',
      ).id,
  );
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '재개 테스트 011 상세 보기' }).click();
  const detail = page.getByRole('complementary', { name: '물품 상세' });
  await expect(detail).toContainText('태그 미등록');
  await detail.getByRole('button', { name: 'NFC 태그 연결 / 물품 수정' }).click();
  await scan(page, '04000011');
  await dialog.getByRole('button', { name: '태그 연결', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const matches = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tagback.mock.v1')!).items.filter(
      (i: { label: string }) => i.label === '재개 테스트 011',
    ),
  );
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ id: createdId, tag: '04000011' });
});

test('태그 없이 등록·대여 가능 차단·후속 연결 후 상태 변경', async ({ page }) => {
  await page.goto('/admin/items');
  await page.getByRole('button', { name: '물품 등록', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: '대여 가능', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: '점검 중', exact: true })).toBeChecked();
  await dialog.getByLabel('카테고리', { exact: true }).fill('학습 용품');
  await dialog.getByRole('button', { name: '학습 용품', exact: true }).click();
  await dialog.getByLabel('물품명', { exact: true }).fill('후속 등록 테스트');
  await dialog.getByLabel('관리번호', { exact: true }).fill('012');
  await dialog.locator('input[type=file]').setInputFiles('public/images/admin-reference.png');
  await dialog.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const detail = page.getByRole('complementary', { name: '물품 상세' });
  await expect(detail).toContainText('태그 미등록');
  await expect(detail).toContainText('점검 중');
  // Adapter must also reject bypassing the disabled radio.
  const code = await page.evaluate(async () => {
    const modulePath = '/src/admin/adminApi.ts';
    const { adminApi } = await import(modulePath);
    const db = JSON.parse(localStorage.getItem('tagback.mock.v1')!);
    const item = db.items.find((i: { label: string }) => i.label === '후속 등록 테스트 012');
    try {
      await adminApi.save(
        'bypass',
        { ...item, label: item.name, category: '학습 용품', status: 'available' },
        item,
      );
    } catch (e) {
      return (e as { code: string }).code;
    }
  });
  expect(code).toBe('TAG_REQUIRED');
  await detail.getByRole('button', { name: 'NFC 태그 연결 / 물품 수정' }).click();
  await scan(page, '04000012');
  await expect(dialog.getByRole('radio', { name: '대여 가능', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '태그 연결', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(detail).toContainText('04000012');
  await expect(detail).toContainText('점검 중');
  await detail.getByRole('button', { name: '상태 변경', exact: true }).click();
  await dialog.getByRole('radio', { name: '대여 가능', exact: true }).check();
  await dialog.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(detail).toContainText('대여 가능');
});
