import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/shared/config', async () => {
  const actual = await vi.importActual<any>('../src/shared/config');
  return { ...actual, MOCK: { ...actual.MOCK, delayMs: 0 } };
});
import { api, controls, expireCodes, resetDemo, setControls } from '../src/shared/api';
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
  const token = await api.login('01012345678', 'Tagback1!');
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
  it('공개 재고와 개인 기록 접근 제한', async () => {
    expect(
      (await api.catalog()).items.filter(
        (i) => i.kindId === 'calc' && i.stationId === 'engineering' && i.status === 'available',
      ),
    ).toHaveLength(5);
    await expect(api.rentals('bad')).rejects.toMatchObject({ code: 'AUTH' });
    const token = await api.signup('01099990000', 'Password1!');
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
    await expect(api.scan('CALC-9', 'rent', 'calc')).rejects.toMatchObject({ code: 'STATION' });
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
    const token2 = await api.signup('01088887777', 'Password1!');
    const code2 = await api.code(token2);
    const grant2 = await api.verifyCode(code2.value);
    await api.scan('CALC-1', 'rent', 'calc');
    await api.rent('first', first.grant, 'calc-1', 'calc');
    await expect(api.rent('second', grant2, 'calc-1', 'calc')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await api.code(token2)).used).toBe(false);
  });
  it('회원가입 중복, 비밀번호 조건 및 로그인 오류', async () => {
    await expect(api.signup('01000001111', 'abc123한글')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(api.signup('01012345678', 'Password1!')).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
    await expect(api.signup('01000001111', 'password')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(api.login('01012345678', 'wrong')).rejects.toMatchObject({ code: 'LOGIN' });
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
