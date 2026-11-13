import { test, expect, _electron, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const uid = '04A23B1C5D6E99';
const itemName = 'Windows 통합검증 우산 1';
const typeName = 'Windows 통합검증 우산';
function sql(statement: string) {
  const container = process.env.TAGBACK_TEST_CONTAINER;
  if (!container?.startsWith('tagback-kiosk-test-'))
    throw Error('Isolated test container required');
  return execFileSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'tagback_live_test',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}
async function signup(page: Page, phone: string, name: string) {
  await page.goto('/mobile/signup');
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByLabel('직업', { exact: true }).selectOption('학생');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('전화번호', { exact: true }).fill(phone);
  const requested = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/auth/sms/requests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  const response = await requested;
  expect(response.ok()).toBeTruthy();
  const { requestId } = await response.json();
  const delivered = await page.request.get(`/api/v1/dev/sms/requests/${requestId}`);
  expect(delivered.ok()).toBeTruthy();
  await page.getByLabel('SMS 인증번호').fill((await delivered.json()).code);
  await page.getByRole('button', { name: '인증번호 확인', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('PIN 번호', { exact: true }).fill('048259');
  await page.getByRole('button', { name: '가입 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/mobile$/);
}
async function issueCode(page: Page) {
  await page.goto('/mobile/code');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/rental-codes') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^(이용 코드 발급|새 코드 발급)$/ }).click();
  const result = await response;
  expect(result.ok()).toBeTruthy();
  return (await result.json()).code as string;
}

test('사용자 가입·코드 → 실제 Windows exe 대여/정상·손상 반납 → 사용자·관리자·DB 일치', async ({
  browser,
}, testInfo) => {
  test.skip(!process.env.TAGBACK_TEST_CONTAINER, 'Run isolated FullJourney harness');
  const origin = process.env.TAGBACK_LIVE_BASE_URL!;
  const owner = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const admin = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const mobile = await owner.newPage(),
    manage = await admin.newPage();
  let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    await signup(mobile, '01070000011', 'Windows 이용자');
    expect((await owner.request.get('/api/v1/admin/users')).status()).toBe(403);
    await signup(manage, '01070000012', 'Windows 관리자');
    sql("update users set role='ADMIN' where phone_number='+821070000012'");
    const login = await admin.request.post('/api/v1/auth/login/phone', {
      data: { phoneNumber: '01070000012', pin: '048259' },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(login.ok()).toBeTruthy();
    const typeId = sql(
      `insert into item_types(name) values ('${typeName}') returning item_type_id`,
    ).split('\n')[0];
    await manage.goto('/admin/items');
    await manage.getByRole('button', { name: '물품 등록', exact: true }).click();
    const dialog = manage.getByRole('dialog', { name: '물품 등록', exact: true });
    await dialog.getByLabel('물품명', { exact: true }).fill(itemName);
    await dialog.getByLabel('물품 종류', { exact: true }).selectOption(typeId);
    await dialog.getByLabel('NFC 태그 UID', { exact: true }).fill(uid);
    await dialog.getByRole('button', { name: '등록하기' }).click();
    await expect(dialog).toHaveCount(0);
    const itemId = sql(`select item_id from items where item_name='${itemName}'`);
    expect(sql(`select status from items where item_id=${itemId}`)).toBe('AVAILABLE');
    await mobile.goto('/mobile/items');
    await expect(mobile.getByText(typeName, { exact: true }).first()).toBeVisible();

    const profile = testInfo.outputPath('windows-profile');
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'host-config.json'),
      JSON.stringify({
        apiBaseUrl: origin,
        bridgeId: 'kiosk-1',
        readerName: 'TEST_DEVICE_BOUNDARY',
      }),
    );
    electron = await _electron.launch({
      executablePath: path.resolve('../kiosk/windows/out/TagBackKiosk-win32-x64/TagBackKiosk.exe'),
      args: [`--kiosk-profile=${profile}`],
      env: { ...process.env, NODE_EXTRA_CA_CERTS: process.env.TAGBACK_HTTPS_CERT! },
      timeout: 45000,
    });
    const kiosk = await electron.firstWindow();
    await kiosk.waitForFunction(() => !!document.querySelector('.kiosk-main'));
    // Only the hardware event boundary is simulated. Native IPC request, HTTPS fetch,
    // grant storage, server transactions, UI completion and SQL checks remain real.
    const health = await kiosk.evaluate(async () =>
      (window as any).tagbackKioskHost.request({
        version: 2,
        requestId: crypto.randomUUID(),
        command: { action: 'health' },
      }),
    );
    expect(health.status).toBe(200);
    await electron.evaluate(({ BrowserWindow, ipcMain }) => {
      ipcMain.removeHandler('kiosk:reader-status');
      ipcMain.handle('kiosk:reader-status', () => 'connected');
      BrowserWindow.getAllWindows()[0].webContents.send('kiosk:reader', {
        type: 'READER_CONNECTED',
      });
    });
    const scan = async () => {
      const issuedAt = Date.now(),
        nonce = randomUUID(),
        bridgeId = 'kiosk-1';
      const signature = createHmac('sha256', 'test-only-nfc-scan-secret-32-bytes-long')
        .update(`${bridgeId}\n${uid}\n${issuedAt}\n${nonce}`)
        .digest('hex');
      await electron!.evaluate(
        ({ BrowserWindow }, data) =>
          BrowserWindow.getAllWindows()[0].webContents.send('kiosk:reader', data),
        { type: 'TAG_READ', uid, bridgeId, issuedAt, nonce, signature },
      );
    };
    for (const [index, condition] of ['NORMAL', 'DAMAGED'].entries()) {
      const rentalCode = await issueCode(mobile);
      await expect(kiosk.getByRole('button', { name: /대여하기/ })).toBeEnabled({ timeout: 20000 });
      await kiosk.getByRole('button', { name: /대여하기/ }).click();
      await kiosk.getByLabel('일회성 대여 코드').fill(rentalCode);
      await kiosk.getByRole('button', { name: '확인', exact: true }).click();
      await kiosk.getByRole('button', { name: new RegExp(typeName) }).click();
      await scan();
      await kiosk.getByRole('button', { name: '대여 확정', exact: true }).click();
      await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
      await kiosk.getByRole('button', { name: '처음으로', exact: true }).click();
      expect(sql(`select count(*) from rentals where item_id=${itemId}`)).toBe(String(index + 1));
      expect(sql(`select status from items where item_id=${itemId}`)).toBe('RENTED');
      await mobile.goto('/mobile/rentals');
      await expect(mobile.getByText(typeName, { exact: true }).first()).toBeVisible();
      await manage.goto('/admin/rentals');
      await manage.getByLabel('대여 검색').fill(itemName);
      await expect(
        manage.getByRole('button', { name: itemName + ' 상세 보기', exact: true }).first(),
      ).toBeVisible();
      const returnCode = await issueCode(mobile);
      await kiosk.getByRole('button', { name: /반납하기/ }).click();
      await scan();
      await kiosk
        .getByRole('button', { name: condition === 'NORMAL' ? /정상이에요/ : /손상이 있어요/ })
        .click();
      await kiosk.getByRole('button', { name: '선택한 상태로 계속' }).click();
      await kiosk.getByLabel('일회성 반납 코드').fill(returnCode);
      await kiosk.getByRole('button', { name: '확인', exact: true }).click();
      await kiosk.getByRole('button', { name: '반납 확정', exact: true }).click();
      await expect(
        kiosk.getByRole('heading', {
          name:
            condition === 'NORMAL' ? '반납이 완료되었습니다' : '반납 · 점검 접수가 완료되었습니다',
        }),
      ).toBeVisible();
      await kiosk.screenshot({ path: testInfo.outputPath(`windows-${condition}.png`) });
      await kiosk.getByRole('button', { name: '처음으로', exact: true }).click();
      expect(sql(`select status from items where item_id=${itemId}`)).toBe(
        condition === 'NORMAL' ? 'AVAILABLE' : 'INSPECTION',
      );
      expect(
        sql(
          `select count(*) from rentals where item_id=${itemId} and status='RETURNED' and return_condition='${condition}'`,
        ),
      ).toBe('1');
      await mobile.goto('/mobile/history');
      await expect(mobile.getByText(typeName, { exact: true }).first()).toBeVisible();
      await manage.goto('/admin/history');
      await manage.getByLabel('대여 검색').fill(itemName);
      await expect(
        manage.getByRole('button', { name: itemName + ' 상세 보기', exact: true }).first(),
      ).toBeVisible();
    }
    await manage.goto('/admin/items');
    await manage.getByLabel('물품 검색').fill(itemName);
    await manage.getByRole('button', { name: itemName + ' 상세 보기', exact: true }).click();
    await expect(manage.getByRole('complementary', { name: '물품 상세' })).toContainText('점검');
    expect(
      sql(
        `select count(*) from item_status_history where item_id=${itemId} and to_status='INSPECTION'`,
      ),
    ).toBe('1');
    await manage.screenshot({ path: testInfo.outputPath('admin-inspection.png') });
    await mobile.screenshot({ path: testInfo.outputPath('user-history.png') });
  } finally {
    // Isolated test profile only. Force exit also allows collecting failures with UNKNOWN.
    if (electron) {
      if (testInfo.status !== testInfo.expectedStatus)
        await (
          await electron.firstWindow()
        )
          .screenshot({ path: testInfo.outputPath('windows-failure.png') })
          .catch(() => {});
      await electron.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await electron.close().catch(() => {});
    }
    await owner.close();
    await admin.close();
  }
});
