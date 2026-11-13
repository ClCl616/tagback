import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type BrowserContext } from '@playwright/test';

const uid = '04A23B1C5D6E80';
const secret = 'test-only-nfc-scan-secret-32-bytes-long';
const baseURL = process.env.TAGBACK_LIVE_BASE_URL || 'http://127.0.0.1:5182';

function sql(statement: string): string {
  if (process.env.TAGBACK_TEST_CONTAINER)
    return execFileSync(
      'docker',
      [
        'exec',
        process.env.TAGBACK_TEST_CONTAINER,
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
  return execFileSync(
    process.env.TAGBACK_LIVE_PSQL!,
    [
      '-h',
      '127.0.0.1',
      '-p',
      process.env.TAGBACK_LIVE_DB_PORT!,
      '-U',
      'postgres',
      '-d',
      'tagback_live_test',
      '-t',
      '-A',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
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
    data: {
      verificationToken,
      pin: '048259',
      profile: { name: '연동 테스트', occupation: '학생' },
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(created.status(), await created.text()).toBe(201);
}

test('모바일 코드와 실제 반납 API가 대여자 본인만 반납하도록 연결된다', async ({ browser }) => {
  const owner = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const other = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const kioskContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  try {
    await signup(owner, '01070000001');
    await signup(other, '01070000002');
    sql(
      'insert into rentals(user_id, item_id, rented_at, due_at, status) ' +
        "select u.user_id, i.item_id, now() - interval '1 hour', now() + interval '1 hour', 'RENTED' " +
        "from users u cross join items i where u.phone_number = '+821070000001' and i.item_name = 'Live calculator'",
    );

    const ownerMobile = await owner.newPage();
    await ownerMobile.goto('/mobile/code');
    await ownerMobile.getByRole('button', { name: '이용 코드 발급', exact: true }).click();
    await expect(ownerMobile.locator('.code-number')).toHaveText(/^[0-9]{6}$/);
    const ownerCode = (await ownerMobile.locator('.code-number').textContent())!;
    const otherMobile = await other.newPage();
    await otherMobile.goto('/mobile/code');
    await otherMobile.getByRole('button', { name: '이용 코드 발급', exact: true }).click();
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
        close() {
          sources.delete(this);
        }
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
    const issuedAt = Date.now(),
      nonce = randomUUID(),
      bridgeId = 'kiosk-1';
    const signature = createHmac('sha256', secret)
      .update(`${bridgeId}\n${uid}\n${issuedAt}\n${nonce}`)
      .digest('hex');
    await kiosk.evaluate((payload) => (window as any).emitSignedTag(payload), {
      type: 'TAG_READ',
      bridgeId,
      uid,
      issuedAt,
      nonce,
      signature,
    });
    await expect(kiosk.getByRole('heading', { name: '물품 상태를 확인해 주세요' })).toBeVisible();
    await kiosk.getByRole('button', { name: /정상이에요/ }).click();
    await kiosk.getByRole('button', { name: '선택한 상태로 계속' }).click();
    let invalidResponseLost = false;
    await kiosk.route('**/api/v1/rentals/return', async (route) => {
      if (invalidResponseLost) return route.continue();
      invalidResponseLost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(401);
      await route.abort();
    });
    await kiosk.getByLabel('일회성 반납 코드').fill(otherCode);
    await kiosk.getByRole('button', { name: '확인', exact: true }).click();
    await kiosk.getByRole('button', { name: '반납 확정', exact: true }).click();
    await expect(kiosk.getByRole('button', { name: '반납 결과 다시 확인' })).toBeVisible();
    await kiosk.getByRole('button', { name: '반납 결과 다시 확인' }).click();
    await expect(kiosk.getByRole('alert')).toContainText('대여자와 일치하지 않습니다');
    expect(sql("select status from items where item_name = 'Live calculator'")).toBe('RENTED');
    await expect(kiosk.getByLabel('일회성 반납 코드')).toBeEnabled();
    await kiosk.unroute('**/api/v1/rentals/return');

    let responseLost = false;
    await kiosk.route('**/api/v1/rentals/return', async (route) => {
      if (responseLost) return route.continue();
      responseLost = true;
      const stored = await route.fetch();
      expect(stored.status()).toBe(200);
      await route.abort();
    });
    await kiosk.getByLabel('일회성 반납 코드').fill(ownerCode);
    await kiosk.getByRole('button', { name: '확인', exact: true }).click();
    await kiosk.getByRole('button', { name: '반납 확정', exact: true }).click();
    await expect(kiosk.getByRole('button', { name: '반납 결과 다시 확인' })).toBeVisible();
    await kiosk.getByRole('button', { name: '반납 결과 다시 확인' }).click();
    await expect(kiosk.getByRole('heading', { name: '이미 반납이 완료됐어요' })).toBeVisible();
    expect(sql("select status from items where item_name = 'Live calculator'")).toBe('AVAILABLE');
    expect(
      sql("select count(*) from rentals where status = 'RETURNED' and returned_at is not null"),
    ).toBe('1');
    expect(
      sql(
        'select count(*) from item_status_history h join items i on i.item_id = h.item_id ' +
          "join users u on u.user_id = h.changed_by_user_id where i.item_name = 'Live calculator' " +
          "and u.phone_number = '+821070000001' and h.to_status = 'AVAILABLE'",
      ),
    ).toBe('1');
  } finally {
    await owner.close();
    await other.close();
    await kioskContext.close();
  }
});

test('실제 대여 저장 응답 유실 복구와 손상 반납이 DB에 한 번씩 저장된다', async ({ browser }) => {
  const owner = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const kioskContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const scanUid = '04A23B1C5D6E81';
  try {
    await signup(owner, '01070000003');
    sql(
      "insert into item_types(name) values ('Live umbrella'); insert into items(item_type_id,item_name,status) select item_type_id,'Live damaged umbrella','TAG_PENDING' from item_types where name='Live umbrella'; insert into nfc_tags(item_id,tag_uid) select item_id,'04A23B1C5D6E81' from items where item_name='Live damaged umbrella'; update items set status='AVAILABLE' where item_name='Live damaged umbrella';",
    );
    await kioskContext.addInitScript(() => {
      const sources = new Set<EventTarget>();
      class FakeSource extends EventTarget {
        constructor() {
          super();
          sources.add(this);
          setTimeout(() => this.dispatchEvent(new MessageEvent('READER_CONNECTED')), 0);
        }
        close() {
          sources.delete(this);
        }
      }
      Object.defineProperty(window, 'EventSource', { value: FakeSource });
      (window as any).emitSignedTag = (payload: unknown) => {
        for (const source of sources)
          source.dispatchEvent(new MessageEvent('TAG_READ', { data: JSON.stringify(payload) }));
      };
    });
    const mobile = await owner.newPage();
    await mobile.goto('/mobile/code');
    await mobile.getByRole('button', { name: '이용 코드 발급', exact: true }).click();
    await expect(mobile.locator('.code-number')).toHaveText(/^[0-9]{6}$/);
    const rentalCode = (await mobile.locator('.code-number').textContent())!;
    const kiosk = await kioskContext.newPage();
    await kiosk.goto('/kiosk');
    await kiosk.getByRole('button', { name: /대여하기/ }).click();
    await kiosk.getByLabel('일회성 대여 코드').fill(rentalCode);
    await kiosk.getByRole('button', { name: '확인', exact: true }).click();
    await kiosk.getByRole('button', { name: /Live umbrella/ }).click();
    const emit = async (valid = true) => {
      const issuedAt = Date.now(),
        nonce = randomUUID(),
        bridgeId = 'kiosk-1';
      const signature = valid
        ? createHmac('sha256', secret)
            .update(`${bridgeId}\n${scanUid}\n${issuedAt}\n${nonce}`)
            .digest('hex')
        : '0'.repeat(64);
      await kiosk.evaluate((payload) => (window as any).emitSignedTag(payload), {
        type: 'TAG_READ',
        bridgeId,
        uid: scanUid,
        issuedAt,
        nonce,
        signature,
      });
    };
    await emit();
    await expect(kiosk.getByRole('heading', { name: '대여 정보를 확인해 주세요' })).toBeVisible();
    const writes: { key: string; auth: string; body: unknown }[] = [];
    let rentalResponse: any;
    await kiosk.route('**/api/v1/rentals', async (route) => {
      const req = route.request();
      writes.push({
        key: req.headers()['idempotency-key'],
        auth: req.headers()['authorization'],
        body: req.postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(writes.length === 1 ? 201 : 200);
      rentalResponse = await response.json();
      if (writes.length === 1) await route.abort();
      else await route.fulfill({ response });
    });
    expect(
      sql(
        "select count(*) from rentals r join items i on r.item_id=i.item_id where i.item_name='Live damaged umbrella'",
      ),
    ).toBe('0');
    await kiosk.getByRole('button', { name: '대여 확정', exact: true }).click();
    await expect(kiosk.getByRole('button', { name: '처리 결과 다시 확인' })).toBeVisible();
    expect(sql("select status from items where item_name='Live damaged umbrella'")).toBe('RENTED');
    await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).toHaveCount(0);
    await kiosk.getByRole('button', { name: '처리 결과 다시 확인' }).click();
    await expect(kiosk.getByRole('heading', { name: '대여가 완료되었습니다' })).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(
      sql(
        "select count(*) from rentals r join items i on r.item_id=i.item_id where i.item_name='Live damaged umbrella'",
      ),
    ).toBe('1');
    const due = await owner.request.get('/api/v1/rentals/me?scope=ACTIVE');
    expect(due.ok()).toBeTruthy();
    expect(JSON.stringify(await due.json())).toContain(rentalResponse.dueAt);
    await kiosk.unroute('**/api/v1/rentals');
    await kiosk.getByRole('button', { name: '처음으로', exact: true }).click();
    const newCodeResponse = mobile.waitForResponse(
      (r) => r.url().endsWith('/api/v1/rental-codes') && r.request().method() === 'POST',
    );
    await mobile.getByRole('button', { name: '새 코드 발급', exact: true }).click();
    const returnCode = (await (await newCodeResponse).json()).code;
    await kiosk.getByRole('button', { name: /반납하기/ }).click();
    await emit(false);
    await expect(kiosk.getByRole('alert')).toBeVisible();
    await expect(kiosk.getByRole('heading', { name: '반납할 물품을 인식해 주세요' })).toBeVisible();
    await kiosk.getByRole('button', { name: '다시 인식하기', exact: true }).click();
    await emit();
    await kiosk.getByRole('button', { name: /손상이 있어요/ }).click();
    await kiosk.getByRole('button', { name: '선택한 상태로 계속' }).click();
    await kiosk.getByLabel('일회성 반납 코드').fill(returnCode);
    await kiosk.getByRole('button', { name: '확인', exact: true }).click();
    expect(sql("select status from items where item_name='Live damaged umbrella'")).toBe('RENTED');
    const returned = kiosk.waitForResponse((r) => r.url().endsWith('/api/v1/rentals/return'));
    await kiosk.getByRole('button', { name: '반납 확정', exact: true }).click();
    expect((await returned).status()).toBe(200);
    await expect(
      kiosk.getByRole('heading', { name: '반납 · 점검 접수가 완료되었습니다' }),
    ).toBeVisible();
    expect(sql("select status from items where item_name='Live damaged umbrella'")).toBe(
      'INSPECTION',
    );
    expect(
      sql(
        "select count(*) from rentals r join items i on r.item_id=i.item_id where i.item_name='Live damaged umbrella' and r.status='RETURNED' and r.return_condition='DAMAGED' and r.returned_at is not null",
      ),
    ).toBe('1');
    expect(
      sql(
        "select count(*) from item_status_history h join items i on h.item_id=i.item_id where i.item_name='Live damaged umbrella' and h.to_status='INSPECTION'",
      ),
    ).toBe('1');
  } finally {
    await owner.close();
    await kioskContext.close();
  }
});
