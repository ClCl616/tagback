import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/shared/config', async () => {
  const actual = await vi.importActual<any>('../src/shared/config');
  return { ...actual, MOCK: { ...actual.MOCK, delayMs: 0 } };
});
import { api, controls, expireCodes, resetDemo, setControls } from '../src/shared/api';
import { DB_KEY, MOCK } from '../src/shared/config';
import { authApi } from '../src/shared/auth';
import { AUTH_DEMO, AUTH_POLICY, pinValid } from '../src/shared/authPolicy';
async function verified(
  phone: string,
  purpose: 'access' | 'reset' | 'change' = 'access',
  source = 'test',
  reauth?: string,
) {
  const c = await authApi.requestSms(phone, purpose, source, reauth);
  return authApi.verifySms(c.id, phone, AUTH_DEMO.smsCode, purpose, source);
}
async function login(phone = MOCK.demoPhone, pin = AUTH_DEMO.pin, source = 'test') {
  const v = await verified(phone, 'access', source);
  const r = await authApi.login(crypto.randomUUID(), v.proof, pin, false, source);
  if (!('token' in r)) throw new Error('Expected login');
  return r;
}
async function signup(phone: string) {
  const v = await verified(phone);
  const r = await authApi.signup(crypto.randomUUID(), v.proof, AUTH_DEMO.pin, 'test', {
    name: '테스트',
    occupation: '학생',
  });
  if (!('token' in r)) throw new Error('Expected signup');
  return r.token;
}
function mutate(fn: (db: any) => void) {
  const db = JSON.parse(localStorage.getItem(DB_KEY)!);
  fn(db);
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}
const values = new Map<string, string>();
const queues = new Map<string, Promise<any>>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
Object.defineProperty(globalThis.navigator, 'locks', {
  value: {
    request: (key: string, fn: () => unknown) => {
      const task = (queues.get(key) || Promise.resolve()).then(fn);
      queues.set(
        key,
        task.catch(() => {}),
      );
      return task;
    },
  },
  configurable: true,
});
async function prepare() {
  const { token } = await login();
  const code = await api.code(token);
  const grant = await api.verifyCode(code.value);
  return { token, code, grant };
}
beforeEach(async () => {
  values.clear();
  queues.clear();
  await resetDemo();
});
describe('Mock service contract — not real server verification', () => {
  it('이전 비밀번호 계정은 기록 보존·세션 폐기·복구 필요 상태로 이관', async () => {
    mutate((db) => {
      db.schemaVersion = 2;
      db.users.push({ id: 'legacy', phone: '01044445555', passwordHash: 'legacy-hash' });
      db.sessions.old = 'legacy';
    });
    await api.catalog();
    const db = JSON.parse(localStorage.getItem(DB_KEY)!);
    expect(db.schemaVersion).toBe(6);
    expect(db.users.find((u: any) => u.id === 'legacy')).toEqual({
      id: 'legacy',
      phone: '01044445555',
    });
    expect(db.sessions).toEqual({});
    expect(db.rentals).toHaveLength(3);
    const v = await verified('01044445555');
    expect(v.needsPin).toBe(true);
    mutate((db) => db.auth.sms.forEach((s: any) => (s.resendAt = 0)));
    const recovery = await verified('01044445555', 'reset');
    await authApi.resetPin('legacy-reset', recovery.proof, '246802', 'test');
    const updated = JSON.parse(localStorage.getItem(DB_KEY)!).users.find((u: any) => u.id === 'legacy');
    expect(updated.pinHash).toBeTruthy();
    expect(updated.passwordHash).toBeUndefined();
  });
  it('PIN 정책: 순환/내림차순/3자리 반복 금지, 나머지 허용', () => {
    for (const pin of [
      '123456',
      '654321',
      '789012',
      '210987',
      '000123',
      '041888',
      '12345',
      'abc123',
    ])
      expect(pinValid(pin), pin).toBe(false);
    for (const pin of ['048259', '010203', '121212', '112233', '123459'])
      expect(pinValid(pin), pin).toBe(true);
  });
  it('SMS 용도·번호·출처·일회성 및 가입 proof 강제', async () => {
    await expect(
      authApi.signup('no-proof', '', AUTH_DEMO.pin, 'test', { name: '테스트', occupation: '학생' }),
    ).rejects.toMatchObject({
      code: 'SMS_REQUIRED',
    });
    const c = await authApi.requestSms('01099990000', 'access', 'test');
    await expect(
      authApi.verifySms(c.id, '01088887777', AUTH_DEMO.smsCode, 'access', 'test'),
    ).rejects.toMatchObject({ code: 'SMS_USED' });
    await expect(
      authApi.verifySms(c.id, '01099990000', AUTH_DEMO.smsCode, 'reset', 'test'),
    ).rejects.toMatchObject({ code: 'SMS_USED' });
    const v = await authApi.verifySms(c.id, '01099990000', AUTH_DEMO.smsCode, 'access', 'test');
    await expect(
      authApi.verifySms(c.id, '01099990000', AUTH_DEMO.smsCode, 'access', 'test'),
    ).rejects.toMatchObject({ code: 'SMS_USED' });
    await expect(
      authApi.signup('bad-source', v.proof, AUTH_DEMO.pin, 'other', {
        name: '테스트',
        occupation: '학생',
      }),
    ).rejects.toMatchObject({ code: 'SMS_REQUIRED' });
    await expect(
      authApi.resetPin('bad-purpose', v.proof, AUTH_DEMO.pin, 'test'),
    ).rejects.toMatchObject({ code: 'SMS_REQUIRED' });
    await expect(
      authApi.signup('bad-pin', v.proof, '123456', 'test', { name: '테스트', occupation: '학생' }),
    ).rejects.toMatchObject({
      code: 'PIN_POLICY',
    });
    const results = await Promise.allSettled([
      authApi.signup('one', v.proof, AUTH_DEMO.pin, 'test', { name: '테스트', occupation: '학생' }),
      authApi.signup('two', v.proof, AUTH_DEMO.pin, 'test', { name: '테스트', occupation: '학생' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('SMS 만료·재발송·5회 오류·누적 발송 제한', async () => {
    const phone = '01099990000';
    const c = await authApi.requestSms(phone, 'access', 'test');
    await expect(authApi.requestSms(phone, 'access', 'test')).rejects.toMatchObject({
      code: 'SMS_WAIT',
    });
    for (let i = 0; i < 5; i++)
      await expect(
        authApi.verifySms(c.id, phone, '000000', 'access', 'test'),
      ).rejects.toBeInstanceOf(Error);
    await expect(
      authApi.verifySms(c.id, phone, AUTH_DEMO.smsCode, 'access', 'test'),
    ).rejects.toMatchObject({ code: 'SMS_USED' });
    mutate((db) => db.auth.sms.forEach((s: any) => (s.resendAt = 0)));
    const next = await authApi.requestSms(phone, 'access', 'test');
    mutate((db) => (db.auth.sms.find((s: any) => s.id === next.id).expiresAt = 0));
    await expect(
      authApi.verifySms(next.id, phone, AUTH_DEMO.smsCode, 'access', 'test'),
    ).rejects.toMatchObject({ code: 'SMS_EXPIRED' });
    for (let i = 2; i < AUTH_DEMO.phoneSends; i++) {
      mutate((db) => db.auth.sms.forEach((s: any) => (s.resendAt = 0)));
      await authApi.requestSms(phone, 'access', 'test');
    }
    mutate((db) => db.auth.sms.forEach((s: any) => (s.resendAt = 0)));
    await expect(authApi.requestSms(phone, 'access', 'another-source')).rejects.toMatchObject({
      code: 'RATE',
    });
  });
  it('계정별 PIN 5/10/15/20회 제한, 대기 중 미누적, SMS 재발송으로 우회 불가', async () => {
    const r = await login();
    await authApi.logout(r.token);
    for (let group = 0; group < 4; group++) {
      for (let i = 0; i < 5; i++)
        await expect(
          authApi.login(crypto.randomUUID(), r.registration, '246802', true, 'test'),
        ).rejects.toBeInstanceOf(Error);
      let a = JSON.parse(localStorage.getItem(DB_KEY)!).auth.attempts.demo;
      expect(a.failures).toBe((group + 1) * 5);
      if (group < 3) {
        expect(a.retryAt - Date.now()).toBeGreaterThan(AUTH_POLICY.pinWaits[group] - 2000);
        await expect(
          authApi.login(crypto.randomUUID(), r.registration, AUTH_DEMO.pin, true, 'test'),
        ).rejects.toMatchObject({ code: 'PIN_WAIT' });
        expect(JSON.parse(localStorage.getItem(DB_KEY)!).auth.attempts.demo.failures).toBe(
          a.failures,
        );
        mutate((db) => (db.auth.attempts.demo.retryAt = 0));
      }
    }
    mutate((db) => db.auth.sms.forEach((s: any) => (s.resendAt = 0)));
    const v = await verified(MOCK.demoPhone);
    await expect(
      authApi.login('blocked', v.proof, AUTH_DEMO.pin, false, 'test'),
    ).rejects.toMatchObject({ code: 'PIN_LOCKED' });
  });
  it('로그아웃 등록 유지, 새 로그인 성공에만 이전 등록·세션 폐기, 키오스크 grant 유지', async () => {
    const r = await login();
    const code = await api.code(r.token),
      grant = await api.verifyCode(code.value);
    mutate((db) => db.auth.sms.forEach((s: any) => (s.resendAt = 0)));
    const v = await verified(MOCK.demoPhone, 'access', 'other');
    await expect(authApi.login('wrong', v.proof, '246802', false, 'other')).rejects.toMatchObject({
      code: 'PIN_INVALID',
    });
    expect(await api.me(r.token)).toHaveProperty('phone');
    const other = await authApi.login('other', v.proof, AUTH_DEMO.pin, false, 'other');
    await expect(api.me(r.token)).rejects.toThrow('다른 브라우저');
    expect(await authApi.registration(r.registration)).toBeNull();
    await expect(api.rent('kiosk', grant, 'calc-1', 'calc')).resolves.toHaveProperty(
      'type',
      'rent',
    );
    if (!('token' in other)) throw new Error();
    await authApi.logout(other.token);
    expect(await authApi.registration(other.registration)).not.toBeNull();
    await expect(api.me(other.token)).rejects.toMatchObject({ code: 'AUTH' });
    await authApi.unregister(other.registration);
    expect(await authApi.registration(other.registration)).toBeNull();
  });
  it('SMS 인증 후 PIN 재설정은 전체 인증 초기화·기록 유지', async () => {
    const r = await login(),
      rows = await api.rentals(r.token);
    mutate((db) => db.auth.sms.forEach((s: any) => (s.resendAt = 0)));
    const v = await verified(MOCK.demoPhone, 'reset');
    await authApi.resetPin('reset', v.proof, '246802', 'test');
    await expect(authApi.resetPin('another-reset', v.proof, '246802', 'test')).rejects.toMatchObject({
      code: 'SMS_REQUIRED',
    });
    await expect(api.me(r.token)).rejects.toMatchObject({ code: 'AUTH' });
    expect(await authApi.registration(r.registration)).toBeNull();
    expect(JSON.parse(localStorage.getItem(DB_KEY)!).rentals).toHaveLength(rows.length);
    expect(JSON.parse(localStorage.getItem(DB_KEY)!).auth.attempts.demo.failures).toBe(0);
  });
  it('전화번호 변경은 재인증 필요, 계정 ID·이력 보존 및 세션 종료', async () => {
    const r = await login();
    await expect(authApi.requestSms('01022223333', 'change', 'test')).rejects.toMatchObject({
      code: 'AUTH',
    });
    const reauth = await authApi.reauthenticate(r.token, AUTH_DEMO.pin, 'test');
    const v = await verified('01022223333', 'change', 'test', reauth);
    await authApi.changePhone('change', v.proof, reauth, 'test');
    await expect(api.me(r.token)).rejects.toMatchObject({ code: 'AUTH' });
    const db = JSON.parse(localStorage.getItem(DB_KEY)!);
    expect(db.users.find((u: any) => u.id === 'demo').phone).toBe('01022223333');
    expect(db.rentals.every((r: any) => r.userId === 'demo')).toBe(true);
  });
  it('저장 실패·응답 유실·멱등성 및 세션/등록 만료', async () => {
    const v = await verified('01022223333');
    setControls({ nextTarget: 'auth', nextFault: 'save' });
    await expect(
      authApi.signup('new', v.proof, AUTH_DEMO.pin, 'test', { name: '테스트', occupation: '학생' }),
    ).rejects.toMatchObject({
      code: 'SAVE',
    });
    expect(await authApi.result('new')).toBeNull();
    setControls({ nextTarget: 'auth', nextFault: 'unknown' });
    await expect(
      authApi.signup('new', v.proof, AUTH_DEMO.pin, 'test', { name: '테스트', occupation: '학생' }),
    ).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
    const result = await authApi.result('new');
    expect(
      await authApi.signup('new', v.proof, AUTH_DEMO.pin, 'test', {
        name: '테스트',
        occupation: '학생',
      }),
    ).toEqual(result);
    if (!result || !('token' in result)) throw new Error();
    mutate((db) => (db.auth.sessions[result.token].seenAt = 0));
    await expect(api.me(result.token)).rejects.toMatchObject({ code: 'AUTH' });
    mutate((db) => (db.auth.registrations[result.registration].expiresAt = 0));
    expect(await authApi.registration(result.registration)).toBeNull();
  });
  it('기존 mock 계정·대여 기록을 보존하며 대여소를 통합', async () => {
    const db = JSON.parse(localStorage.getItem(DB_KEY)!);
    delete db.schemaVersion;
    db.stations.push({ id: 'library', name: '이전 대여소', location: '이전 위치' });
    db.items[0].stationId = 'library';
    const oldRentals = db.rentals.length;
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    const catalog = await api.catalog();
    expect(catalog.stations).toHaveLength(1);
    expect(catalog.items.every((i) => i.stationId === 'engineering')).toBe(true);
    const { token } = await login();
    expect(await api.rentals(token)).toHaveLength(oldRentals);
  });
  it('공개 재고와 개인 기록 접근 제한', async () => {
    expect(
      (await api.catalog()).items.filter(
        (i) => i.kindId === 'calc' && i.stationId === 'engineering' && i.status === 'available',
      ),
    ).toHaveLength(5);
    await expect(api.rentals('bad')).rejects.toMatchObject({ code: 'AUTH' });
    const token = await signup('01099990000');
    expect(await api.rentals(token)).toEqual([]);
    await api.logout(token);
    await expect(api.rentals(token)).rejects.toMatchObject({ code: 'AUTH' });
  });
  it('동시 확정에 한 건만 저장하고 재고·코드를 함께 변경', async () => {
    const { token, grant } = await prepare();
    const results = await Promise.allSettled([
      api.rent('op-a', grant, 'calc-1', 'calc'),
      api.rent('op-b', grant, 'calc-1', 'calc'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await api.rentals(token)).filter((r) => r.itemId === 'calc-1')).toHaveLength(1);
    expect((await api.code(token)).used).toBe(true);
    expect((await api.catalog()).items.find((i) => i.id === 'calc-1')?.status).toBe('rented');
  });
  it('동일 요청 ID 재전송은 동일 결과', async () => {
    const { grant } = await prepare();
    const first = await api.rent('same', grant, 'calc-1', 'calc');
    const second = await api.rent('same', grant, 'calc-1', 'calc');
    expect(second).toEqual(first);
    const returned = await api.returnItem('return', 'calc-1', 'normal');
    expect(await api.returnItem('return', 'calc-1', 'normal')).toEqual(returned);
    await expect(api.returnItem('another', 'calc-1', 'normal')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('정상 반납은 재고 회복, 손상 반납은 점검 분리', async () => {
    const { grant } = await prepare();
    await api.rent('r', grant, 'calc-1', 'calc');
    await api.returnItem('n', 'calc-1', 'normal');
    expect((await api.catalog()).items.find((i) => i.id === 'calc-1')?.status).toBe('available');
    await api.returnItem('d', 'calc-6', 'damaged');
    expect((await api.catalog()).items.find((i) => i.id === 'calc-6')?.status).toBe('inspection');
  });
  it('잘못된 종류·태그·대여소·비활성·없는 기록 거절', async () => {
    await expect(api.scan('UNKNOWN', 'rent', 'calc')).rejects.toMatchObject({
      code: 'TAG_UNKNOWN',
    });
    await expect(api.scan('CALC-8', 'rent', 'calc')).rejects.toMatchObject({
      code: 'TAG_INACTIVE',
    });
    await expect(api.scan('UMBRELLA-1', 'rent', 'calc')).rejects.toMatchObject({
      code: 'MISMATCH',
    });
    const db = JSON.parse(localStorage.getItem(DB_KEY)!);
    // station guard remains in the adapter for future expansion; production seed has one station.
    expect(db.stations).toHaveLength(1);
    await expect(api.scan('CALC-9', 'rent', 'calc')).rejects.toMatchObject({ code: 'TAG_UNKNOWN' });
    await expect(api.scan('CALC-6', 'rent', 'calc')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(api.scan('CALC-1', 'return')).rejects.toMatchObject({ code: 'NO_RENTAL' });
    await expect(api.scan('UMBRELLA-1', 'return')).rejects.toThrow('이미 반납');
  });
  it('저장 실패는 변경하지 않고 응답 유실은 결과 조회로 복구', async () => {
    const { token, grant } = await prepare();
    setControls({ nextFault: 'save' });
    await expect(api.rent('op', grant, 'calc-1', 'calc')).rejects.toMatchObject({ code: 'SAVE' });
    expect((await api.code(token)).used).toBe(false);
    expect(await api.operation('op')).toBeNull();
    setControls({ nextFault: 'unknown' });
    await expect(api.rent('op', grant, 'calc-1', 'calc')).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
    expect((await api.operation('op'))?.item.status).toBe('rented');
    expect((await api.rentals(token)).filter((r) => r.itemId === 'calc-1')).toHaveLength(1);
  });
  it('코드 만료·소비·재발급과 위조 grant 검증', async () => {
    const { token, code, grant } = await prepare();
    await expect(
      api.rent('forged', { ...grant, token: 'forged' }, 'calc-1', 'calc'),
    ).rejects.toMatchObject({ code: 'AUTH' });
    await expireCodes();
    await expect(api.verifyCode(code.value)).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
    const renewed = await api.code(token, true);
    expect(renewed.value).not.toEqual(code.value);
    const next = await api.verifyCode(renewed.value);
    await api.rent('ok', next, 'calc-1', 'calc');
    await expect(api.verifyCode(renewed.value)).rejects.toMatchObject({ code: 'CODE_USED' });
  });
  it('확정 시 재고 재검사로 서로 다른 사용자의 중복 대여 차단', async () => {
    const first = await prepare();
    const token2 = await signup('01088887777');
    const code2 = await api.code(token2);
    const grant2 = await api.verifyCode(code2.value);
    await api.scan('CALC-1', 'rent', 'calc');
    await api.rent('first', first.grant, 'calc-1', 'calc');
    await expect(api.rent('second', grant2, 'calc-1', 'calc')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await api.code(token2)).used).toBe(false);
  });
  it('연체는 대여 기록 속성이며 물품 상태와 분리', async () => {
    const { token } = await prepare();
    const catalog = await api.catalog();
    const rows = await api.rentals(token);
    const overdue = rows.find((r) => !r.returnedAt && r.dueAt < Date.now())!;
    expect(overdue.itemId).toBe('battery-1');
    expect(catalog.items.find((i) => i.id === overdue.itemId)?.status).toBe('rented');
    expect(controls().reader).toBe(true);
  });
});

it('SMS 없는 전화번호 로그인: 오인증 방지, PIN 제한 유지, 새 로그인 후 이전 세션 폐기', async () => {
  const attempt = (phone: string, pin: string) =>
    authApi.loginWithPhone(crypto.randomUUID(), phone, pin, 'phone-test');
  await expect(attempt('01099998888', AUTH_DEMO.pin)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  for (let i = 0; i < 4; i++)
    await expect(attempt(MOCK.demoPhone, '246802')).rejects.toThrow('전화번호 또는 PIN');
  await expect(attempt(MOCK.demoPhone, '246802')).rejects.toMatchObject({ code: 'PIN_WAIT' });
  await expect(attempt(MOCK.demoPhone, AUTH_DEMO.pin)).rejects.toMatchObject({ code: 'PIN_WAIT' });
  mutate((db) => Object.values(db.auth.attempts).forEach((a: any) => (a.retryAt = 0)));
  const first = await attempt(MOCK.demoPhone, AUTH_DEMO.pin);
  const second = await attempt(MOCK.demoPhone, AUTH_DEMO.pin);
  if (!('token' in first) || !('token' in second)) throw new Error('Expected login');
  await expect(api.me(first.token)).rejects.toThrow();
  await expect(api.me(second.token)).resolves.toMatchObject({ phone: MOCK.demoPhone });
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).auth.sms).toHaveLength(0);
});

it('이전 태그 미등록 물품은 점검 중으로 이관하고 연결된 물품은 유지한다', async () => {
  mutate((db) => {
    db.schemaVersion = 5;
    db.items[0].tag = '';
    db.items[0].status = 'available';
    db.items[0].active = true;
  });
  const before = JSON.parse(localStorage.getItem(DB_KEY)!);
  const catalog = await api.catalog();
  expect(catalog.items[0]).toMatchObject({ tag: '', status: 'inspection', active: false });
  expect(catalog.items[1]).toEqual(before.items[1]);
});

import { generateMockItems, clearMockItems } from '../src/dev/mockItems';

it('물품 무작위 생성은 수량·UID·미등록 상태 제약을 유지한다', async () => {
  await clearMockItems();
  await generateMockItems(500, 'linked');
  await Promise.all([generateMockItems(20, 'unlinked'), generateMockItems(20, 'mixed')]);
  const { items } = await api.catalog();
  expect(items).toHaveLength(540);
  expect(new Set(items.map((i) => i.id)).size).toBe(540);
  expect(new Set(items.map((i) => i.inventoryNumber)).size).toBe(540);
  const tagged = items.filter((i) => i.tag);
  expect(new Set(tagged.map((i) => i.tag)).size).toBe(tagged.length);
  tagged.forEach((i) => expect(i.tag).toMatch(/^04[0-9A-F]{12}$/));
  items
    .filter((i) => !i.tag)
    .forEach((i) => {
      expect(['inspection', 'repair']).toContain(i.status);
      expect(i.active).toBe(false);
    });
  expect(items.some((i) => i.status === 'rented')).toBe(false);
});

it('물품 생성 한도·잘못된 수량은 쓰기 전에 거부한다', async () => {
  const initial = (await api.catalog()).items.length;
  for (const count of [0, -1, 1.5, 501, NaN]) {
    await expect(generateMockItems(count, 'mixed')).rejects.toMatchObject({ code: 'COUNT' });
  }
  expect((await api.catalog()).items).toHaveLength(initial);
  await clearMockItems();
  for (let n = 0; n < 4; n++) await generateMockItems(500, 'unlinked');
  await expect(generateMockItems(1, 'mixed')).rejects.toMatchObject({ code: 'LIMIT' });
  expect((await api.catalog()).items).toHaveLength(2000);
});

it('물품 전체 삭제는 관련 기록을 지우고 계정·카테고리를 보존한다', async () => {
  await prepare();
  const before = JSON.parse(localStorage.getItem(DB_KEY)!);
  await clearMockItems();
  const after = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(after.items).toEqual([]);
  expect(after.rentals).toEqual([]);
  expect(after.operations).toEqual({});
  expect(after.codes).toEqual([]);
  expect(after.grants).toEqual([]);
  for (const key of ['users', 'auth', 'kinds', 'categories', 'stations'])
    expect(after[key]).toEqual(before[key]);
});
