import { CONTROL_KEY, DB_KEY, MOCK } from './config';
import { seed, type Database } from './seed';
import type { DemoControls, Fault, ServiceApi, Receipt } from './types';

export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string): never => {
  throw new ServiceError(code, message);
};
export const passwordValid = (v: string) =>
  v.length >= 8 && /[a-zA-Z]/.test(v) && /[0-9]/.test(v) && /[\p{P}\p{S}]/u.test(v);
export const normalizePhone = (v: string) => v.replace(/[\s-]/g, '');
export const phoneValid = (v: string) => /^010\d{8}$/.test(normalizePhone(v));
export async function hash(v: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function controls(): DemoControls {
  return {
    reader: true,
    service: true,
    nextFault: '',
    nextTarget: 'any',
    sessionSeconds: MOCK.sessionSeconds,
    ...JSON.parse(localStorage.getItem(CONTROL_KEY) || '{}'),
  };
}
export function setControls(patch: Partial<DemoControls>) {
  localStorage.setItem(CONTROL_KEY, JSON.stringify({ ...controls(), ...patch }));
  window.dispatchEvent(new Event('tagback-controls'));
}
function notify() {
  window.dispatchEvent(new Event('tagback-change'));
}
// Web Locks serializes simulated transactions across tabs. This is NOT a production authorization or database boundary.
async function transaction<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  if (!navigator.locks)
    return fail('UNSUPPORTED', '이 시연은 localhost 또는 HTTPS 브라우저에서 열어 주세요.');
  return navigator.locks.request('tagback-database', async () => {
    const raw = localStorage.getItem(DB_KEY);
    const db: Database = raw ? JSON.parse(raw) : seed(await hash(MOCK.demoPassword));
    const result = await fn(db);
    const serialized = JSON.stringify(db);
    if (serialized !== raw) localStorage.setItem(DB_KEY, serialized);
    return structuredClone(result);
  });
}
async function before(write = false, target: DemoControls['nextTarget'] = 'read'): Promise<Fault> {
  await new Promise((r) => setTimeout(r, MOCK.delayMs));
  if (!controls().service)
    fail('NETWORK', '서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  const fault = await navigator.locks.request('tagback-fault', () => {
    const c = controls();
    if (c.nextTarget !== 'any' && c.nextTarget !== target) return '';
    if (!c.nextFault || (!write && ['save', 'unknown', 'conflict'].includes(c.nextFault)))
      return '';
    setControls({ nextFault: '' });
    return c.nextFault;
  });
  if (fault === 'network')
    fail('NETWORK', '네트워크 연결이 끊겼습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
  if (fault === 'timeout') fail('TIMEOUT', '요청 시간이 초과되었습니다. 다시 시도해 주세요.');
  if (fault === 'save')
    fail('SAVE', '저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 확정해 주세요.');
  return fault;
}
function userId(db: Database, token: string) {
  return db.sessions[token] || fail('AUTH', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
}
function checkCode(db: Database, value: string) {
  const c = db.codes.find((c) => c.value === value);
  if (!c)
    return fail('CODE_INVALID', '코드가 일치하지 않습니다. 모바일 웹의 코드를 확인해 주세요.');
  if (c.used)
    return fail('CODE_USED', '이미 사용한 코드입니다. 모바일 웹에서 새 코드를 확인해 주세요.');
  if (c.expiresAt <= Date.now())
    return fail('CODE_EXPIRED', '만료된 코드입니다. 모바일 웹에서 새 코드를 확인해 주세요.');
  return c;
}
async function save(id: string, fn: (db: Database) => Receipt) {
  const fault = await before(true, 'save');
  const receipt = await transaction((db) => {
    if (db.operations[id]) return db.operations[id];
    if (fault === 'conflict')
      return fail(
        'CONFLICT',
        '물품 상태가 변경되어 대여할 수 없습니다. 다른 물품을 선택해 주세요.',
      );
    const result = fn(db);
    db.operations[id] = result;
    return result;
  });
  notify();
  if (fault === 'unknown')
    fail('UNKNOWN', '응답이 끊겨 처리 결과를 확인해야 합니다. 결과 확인을 눌러 주세요.');
  return receipt;
}
export const api: ServiceApi = {
  async catalog() {
    await before();
    return transaction((db) => ({ kinds: db.kinds, items: db.items, stations: db.stations }));
  },
  async login(phone, password) {
    await before();
    const h = await hash(password);
    return transaction((db) => {
      const user = db.users.find((u) => u.phone === normalizePhone(phone) && u.passwordHash === h);
      if (!user)
        return fail('LOGIN', '전화번호 또는 비밀번호가 일치하지 않습니다. 다시 확인해 주세요.');
      const token = crypto.randomUUID();
      db.sessions[token] = user.id;
      return token;
    });
  },
  async signup(phone, password) {
    await before();
    if (!phoneValid(phone) || !passwordValid(password))
      return fail('VALIDATION', '전화번호와 비밀번호 조건을 확인해 주세요.');
    const h = await hash(password);
    return transaction((db) => {
      if (db.users.some((u) => u.phone === normalizePhone(phone)))
        return fail('DUPLICATE', '이미 가입된 전화번호입니다. 로그인해 주세요.');
      const user = { id: crypto.randomUUID(), phone: normalizePhone(phone), passwordHash: h };
      db.users.push(user);
      const token = crypto.randomUUID();
      db.sessions[token] = user.id;
      return token;
    });
  },
  async logout(token) {
    await transaction((db) => {
      delete db.sessions[token];
    });
  },
  async me(token) {
    await before();
    return transaction((db) => ({
      phone: db.users.find((u) => u.id === userId(db, token))!.phone,
    }));
  },
  async code(token, renew = false) {
    await before();
    return transaction((db) => {
      const uid = userId(db, token);
      let c = db.codes.filter((c) => c.userId === uid).at(-1);
      if (renew && c && !c.used && c.expiresAt > Date.now()) return c;
      if (!c || renew) {
        let value: string;
        do {
          value = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(
            MOCK.codeLength,
            '0',
          );
        } while (db.codes.some((c) => c.value === value));
        c = { value, userId: uid, used: false, expiresAt: Date.now() + MOCK.codeTtlMs };
        db.codes.push(c);
      }
      return c;
    });
  },
  async rentals(token) {
    await before();
    return transaction((db) =>
      db.rentals
        .filter((r) => r.userId === userId(db, token))
        .sort((a, b) => b.rentedAt - a.rentedAt),
    );
  },
  async verifyCode(value) {
    await before(false, 'verify');
    return transaction((db) => {
      const c = checkCode(db, value);
      const user = db.users.find((u) => u.id === c.userId)!;
      const grant = {
        token: crypto.randomUUID(),
        userId: c.userId,
        code: c.value,
        expiresAt: c.expiresAt,
        maskedPhone: `010-****-${user.phone.slice(-4)}`,
      };
      db.grants.push(grant);
      return grant;
    });
  },
  async scan(tag, mode, kindId) {
    await before(false, 'scan');
    if (!controls().reader)
      return fail('READER', '인식기 연결이 끊겼습니다. 연결 복구 후 다시 접촉해 주세요.');
    return transaction((db) => {
      const item = db.items.find((i) => i.tag === tag);
      if (!item) return fail('TAG_UNKNOWN', '등록되지 않은 태그입니다. 다른 물품을 접촉해 주세요.');
      if (!item.active)
        return fail('TAG_INACTIVE', '사용 중지된 태그입니다. 다른 물품을 선택해 주세요.');
      if (item.stationId !== MOCK.stationId)
        return fail('STATION', '이 대여소의 물품이 아닙니다. 원래 대여소에서 이용해 주세요.');
      if (mode === 'rent') {
        if (item.kindId !== kindId)
          return fail(
            'MISMATCH',
            '선택한 종류와 다른 물품입니다. 선택한 종류의 물품을 접촉해 주세요.',
          );
        if (item.status !== 'available')
          return fail(
            'UNAVAILABLE',
            '대여 중이거나 점검 중인 물품입니다. 다른 물품을 접촉해 주세요.',
          );
        return { item };
      }
      const rental = db.rentals.find((r) => r.itemId === item.id && !r.returnedAt);
      if (!rental)
        return fail(
          'NO_RENTAL',
          db.rentals.some((r) => r.itemId === item.id)
            ? '이미 반납한 물품입니다. 다른 물품을 접촉하거나 처음으로 돌아가 주세요.'
            : '진행 중인 대여 기록이 없습니다. 물품을 확인하고 다시 접촉해 주세요.',
        );
      return { item, rental };
    });
  },
  rent(id, grant, itemId, kindId) {
    return save(id, (db) => {
      const verified = db.grants.find((g) => g.token === grant.token);
      if (!verified || verified.expiresAt <= Date.now())
        return fail('AUTH', '대여 인증이 만료되었습니다. 코드 입력부터 다시 진행해 주세요.');
      const code = checkCode(db, verified.code);
      const item = db.items.find((i) => i.id === itemId);
      if (
        !item ||
        !item.active ||
        item.status !== 'available' ||
        item.kindId !== kindId ||
        item.stationId !== MOCK.stationId
      )
        return fail('CONFLICT', '물품 상태가 변경되었습니다. 물품 선택부터 다시 진행해 주세요.');
      const rental = {
        id: crypto.randomUUID(),
        userId: verified.userId,
        itemId,
        stationId: item.stationId,
        rentedAt: Date.now(),
        dueAt: Date.now() + MOCK.rentalMs,
      };
      db.rentals.push(rental);
      item.status = 'rented';
      code.used = true;
      return { operationId: id, item, rental, type: 'rent' };
    });
  },
  returnItem(id, itemId, condition) {
    return save(id, (db) => {
      const item = db.items.find((i) => i.id === itemId);
      const rental = db.rentals.find((r) => r.itemId === itemId && !r.returnedAt);
      if (
        !item ||
        !item.active ||
        item.stationId !== MOCK.stationId ||
        item.status !== 'rented' ||
        !rental
      )
        return fail(
          'CONFLICT',
          '대여 기록이 변경되었습니다. 처음으로 돌아가 물품을 다시 인식해 주세요.',
        );
      if (!['normal', 'damaged'].includes(condition))
        return fail('CONDITION', '물품 상태를 선택해 주세요.');
      rental.returnedAt = Date.now();
      rental.condition = condition;
      item.status = condition === 'normal' ? 'available' : 'inspection';
      return { operationId: id, item, rental, type: 'return' };
    });
  },
  async operation(id) {
    await before();
    return transaction((db) => db.operations[id] || null);
  },
};
export async function resetDemo() {
  await navigator.locks.request('tagback-database', async () =>
    localStorage.setItem(DB_KEY, JSON.stringify(seed(await hash(MOCK.demoPassword)))),
  );
  notify();
}
export async function expireCodes() {
  await transaction((db) => db.codes.forEach((c) => (c.expiresAt = Date.now() - 1)));
  notify();
}
