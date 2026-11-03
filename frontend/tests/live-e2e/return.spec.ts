import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type BrowserContext } from '@playwright/test';

const uid = '04A23B1C5D6E80';
const secret = 'test-only-nfc-scan-secret-32-bytes-long';

function sql(statement: string): string {
  return execFileSync(process.env.TAGBACK_LIVE_PSQL!, [
    '-h', '127.0.0.1', '-p', process.env.TAGBACK_LIVE_DB_PORT!, '-U', 'postgres',
    '-d', 'tagback_live_test', '-t', '-A', '-c', statement,
  ], { encoding: 'utf8' }).trim();
}

async function signup(context: BrowserContext, phoneNumber: string) {
  const request = context.request;
  const sms = await request.post('/api/v1/auth/sms/requests', {
    data: { phoneNumber, purpose: 'SIGNUP' },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(sms.ok(), await sms.text()).toBeTruthy();
  const { requestId } = await sms.json();
  const delivered = await request.get(`/api/v1/dev/sms/requests/${requestId}`);
  expect(delivered.ok(), await delivered.text()).toBeTruthy();
  const { code } = await delivered.json();
  const verified = await request.post('/api/v1/auth/sms/verifications', {
    data: { requestId, code },
  });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const { verificationToken } = await verified.json();
  const created = await request.post('/api/v1/auth/signup', {
    data: { verificationToken, pin: '048259', profile: { name: '연동 테스트', occupation: '학생' } },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(created.status(), await created.text()).toBe(201);
}

test('모바일 코드와 실제 반납 API가 대여자 본인만 반납하도록 연결된다', async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: 'http://127.0.0.1:5182' });
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5182' });
  const kioskContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5182' });
  try {
    await signup(owner, '01070000001');
    await signup(other, '01070000002');
    sql("insert into rentals(user_id, item_id, rented_at, due_at, status) " +
      "select u.user_id, i.item_id, now() - interval '1 hour', now() + interval '1 hour', 'RENTED' " +
      "from users u cross join items i where u.phone_number = '+821070000001' and i.item_name = 'Live calculator'");

    const ownerMobile = await owner.newPage();
    await ownerMobile.goto('/mobile/code');
    await expect(ownerMobile.locator('.code-number')).toHaveText(/^[0-9]{6}$/);
    const ownerCode = (await ownerMobile.locator('.code-number').textContent())!;
    const otherMobile = await other.newPage();
    await otherMobile.goto('/mobile/code');
    await expect(otherMobile.locator('.code-number')).toHaveText(/^[0-9]{6}$/);
    const otherCode = (await otherMobile.locator('.code-number').textContent())!;

    await kioskContext.addInitScript(() => {
      const sources = new Set<EventTarget>();
      class FakeSource extends EventTarget {
        onerror: (() => void) | null = null;
        onopen: (() => void) | null = null;
        constructor(_url: string) {
          super();
          sources.add(this);
          setTimeout(() => this.dispatchEvent(new MessageEvent('READER_CONNECTED')), 0);
        }
        close() { sources.delete(this); }
      }
      Object.defineProperty(window, 'EventSource', { value: FakeSource });
      (window as any).emitSignedTag = (payload: unknown) => {
        for (const source of sources)
          source.dispatchEvent(new MessageEvent('TAG_READ', { data: JSON.stringify(payload) }));
      };
    });
    const kiosk = await kioskContext.newPage();
    await kiosk.goto('/kiosk');
    await expect(kiosk.getByRole('button', { name: /반납하기/ })).toBeEnabled();
    await kiosk.getByRole('button', { name: /반납하기/ }).click();
    const issuedAt = Date.now(), nonce = randomUUID(), bridgeId = 'kiosk-1';
    const signature = createHmac('sha256', secret)
      .update(`${bridgeId}\n${uid}\n${issuedAt}\n${nonce}`).digest('hex');
    await kiosk.evaluate((payload) => (window as any).emitSignedTag(payload),
      { type: 'TAG_READ', bridgeId, uid, issuedAt, nonce, signature });
    await expect(kiosk.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
    await kiosk.getByRole('button', { name: /정상이에요/ }).click();
    await kiosk.getByRole('button', { name: '선택한 상태로 계속' }).click();
    await kiosk.getByLabel('일회성 반납 코드').fill(otherCode);
    await kiosk.getByRole('button', { name: '코드 확인하고 반납 완료' }).click();
    await expect(kiosk.getByRole('alert')).toContainText('대여자와 일치하지 않습니다');
    expect(sql("select status from items where item_name = 'Live calculator'")).toBe('RENTED');
    await kiosk.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();

    let responseLost = false;
    await kiosk.route('**/api/v1/rentals/return', async (route) => {
      if (responseLost) return route.continue();
      responseLost = true;
      const stored = await route.fetch();
      expect(stored.status()).toBe(200);
      await route.abort();
    });
    await kiosk.getByLabel('일회성 반납 코드').fill(ownerCode);
    await kiosk.getByRole('button', { name: '코드 확인하고 반납 완료' }).click();
    await expect(kiosk.getByRole('button', { name: '반납 결과 다시 확인' })).toBeVisible();
    await kiosk.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
    await kiosk.getByRole('button', { name: '반납 결과 다시 확인' }).click();
    await expect(kiosk.getByRole('heading', { name: '이미 반납이 완료됐어요' })).toBeVisible();
    expect(sql("select status from items where item_name = 'Live calculator'")).toBe('AVAILABLE');
    expect(sql("select count(*) from rentals where status = 'RETURNED' and returned_at is not null")).toBe('1');
    expect(sql("select count(*) from item_status_history h join items i on i.item_id = h.item_id " +
      "join users u on u.user_id = h.changed_by_user_id where i.item_name = 'Live calculator' " +
      "and u.phone_number = '+821070000001' and h.to_status = 'AVAILABLE'")).toBe('1');
  } finally {
    await owner.close();
    await other.close();
    await kioskContext.close();
  }
});
