import {
  before,
  transaction,
  hash,
  fail,
  ServiceError,
  normalizePhone,
  phoneValid,
  notify,
} from './api';
import { AUTH_DEMO as D, AUTH_POLICY as P, pinError } from './authPolicy';
import type { AuthAdapter, AuthDatabase, AuthResult, Purpose } from './authTypes';
import type { Database } from './seed';
import { MOCK } from './config';

export function authState(db: Database): AuthDatabase {
  return (db.auth ||= {
    registrations: {},
    sessions: {},
    attempts: {},
    sms: [],
    rates: {},
    reauth: {},
    operations: {},
  });
}
export function requireSession(db: Database, token: string) {
  const a = authState(db),
    s = a.sessions[token];
  if (!s) return fail('AUTH', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  if (s.reason) return fail('AUTH', s.reason);
  const r = a.registrations[s.registration];
  if (
    !r ||
    r.reason ||
    r.expiresAt <= Date.now() ||
    s.expiresAt <= Date.now() ||
    s.seenAt + D.idleMs <= Date.now()
  )
    return fail('AUTH', '로그인이 만료되었습니다. 전화번호 또는 PIN으로 다시 로그인해 주세요.');
  if (Date.now() - s.seenAt > 30_000) s.seenAt = Date.now();
  return s;
}
const masked = (phone: string) => '010-****-' + phone.slice(-4);
// Persist failed attempts before reporting rejection.
async function run<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const outcome = await transaction(async (db) => {
    try {
      return { value: await fn(db) };
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
      return { error: { code: e.code, message: e.message, retryAt: e.retryAt } };
    }
  });
  if (outcome.error)
    throw new ServiceError(outcome.error.code, outcome.error.message, outcome.error.retryAt);
  return outcome.value as T;
}
function rate(a: AuthDatabase, key: string, max: number) {
  const hits = (a.rates[key] = (a.rates[key] || []).filter((t) => t > Date.now() - D.rateWindowMs));
  if (hits.length >= max)
    throw new ServiceError(
      'RATE',
      '요청이 많습니다. 대기시간 후 다시 시도해 주세요.',
      hits[0] + D.rateWindowMs,
    );
  hits.push(Date.now());
}
function proof(db: Database, value: string, purpose: Purpose, source: string) {
  const c = authState(db).sms.find(
    (c) => c.proof === value && c.purpose === purpose && c.source === source,
  );
  if (!c || !c.verified || c.used || (c.proofExpiresAt || 0) <= Date.now())
    return fail(
      'SMS_REQUIRED',
      '인증 결과가 만료되었거나 사용되었습니다. 전화번호 인증부터 다시 진행해 주세요.',
    );
  return c;
}
function registration(db: Database, value: string) {
  const r = authState(db).registrations[value];
  if (!r || r.reason || r.expiresAt <= Date.now())
    return fail(
      'REGISTRATION',
      '브라우저 등록이 만료되거나 해제되었습니다. 전화번호 인증부터 다시 진행해 주세요.',
    );
  return r;
}
function revoke(db: Database, uid: string, reason: string) {
  const a = authState(db);
  Object.values(a.registrations)
    .filter((r) => r.userId === uid)
    .forEach((r) => (r.reason = reason));
  Object.values(a.sessions)
    .filter((s) => s.userId === uid)
    .forEach((s) => (s.reason = reason));
  Object.values(a.reauth)
    .filter((r) => r.userId === uid)
    .forEach((r) => (r.used = true));
}
function loginResult(db: Database, uid: string) {
  revoke(db, uid, '다른 브라우저에서 로그인하여 로그아웃되었습니다.');
  const a = authState(db),
    reg = crypto.randomUUID(),
    token = crypto.randomUUID();
  a.registrations[reg] = { userId: uid, expiresAt: Date.now() + D.registrationMs };
  a.sessions[token] = {
    userId: uid,
    registration: reg,
    expiresAt: Date.now() + D.sessionMs,
    seenAt: Date.now(),
  };
  a.attempts[uid] = { failures: 0, retryAt: 0 };
  return { registration: reg, token };
}
async function pinHash(pin: string) {
  const salt = crypto.randomUUID();
  return salt + '$' + (await hash(salt + pin));
}
async function checkPin(db: Database, uid: string, pin: string, source: string) {
  const a = authState(db),
    attempt = (a.attempts[uid] ||= { failures: 0, retryAt: 0 });
  if (attempt.failures >= P.pinBlockAt)
    return fail(
      'PIN_LOCKED',
      'PIN 로그인이 제한되었습니다. PIN 찾기에서 계정 복구를 진행해 주세요.',
    );
  if (attempt.retryAt > Date.now())
    throw new ServiceError('PIN_WAIT', 'PIN 입력을 잠시 기다려 주세요.', attempt.retryAt);
  if (!/^\d{6}$/.test(pin)) return fail('VALIDATION', '숫자 6자리를 입력해 주세요.');
  rate(a, 'pin:' + source, D.pinRequests);
  const user = db.users.find((u) => u.id === uid)!;
  if (!user.pinHash)
    return fail('RECOVERY', 'PIN 설정이 필요합니다. PIN 찾기에서 복구 절차를 진행해 주세요.');
  const parts = user.pinHash.split('$');
  const expected = await hash(parts.length === 2 ? parts[0] + pin : pin);
  if (expected === parts.at(-1)) return;
  attempt.failures++;
  if (attempt.failures >= P.pinBlockAt)
    return fail(
      'PIN_LOCKED',
      'PIN 로그인이 제한되었습니다. PIN 찾기에서 계정 복구를 진행해 주세요.',
    );
  if (attempt.failures % 5 === 0) {
    attempt.retryAt = Date.now() + P.pinWaits[attempt.failures / 5 - 1];
    throw new ServiceError(
      'PIN_WAIT',
      'PIN 오류가 누적되어 잠시 후 다시 입력할 수 있습니다.',
      attempt.retryAt,
    );
  }
  return fail(
    'PIN_INVALID',
    'PIN이 일치하지 않습니다. 다시 입력해 주세요. (누적 ' + attempt.failures + '회)',
  );
}
async function operation(
  id: string,
  fingerprint: string,
  fn: (db: Database) => Promise<AuthResult> | AuthResult,
) {
  if (!id) return fail('VALIDATION', '요청 식별자가 없습니다. 다시 시작해 주세요.');
  const fault = await before(true, 'auth');
  const digest = await hash(fingerprint);
  const result = await run(async (db) => {
    const a = authState(db),
      previous = a.operations[id];
    if (previous) {
      if (previous.fingerprint !== digest)
        return fail('CONFLICT', '다른 처리의 요청입니다. 처음부터 다시 진행해 주세요.');
      if ('token' in previous.result) requireSession(db, previous.result.token);
      return previous.result;
    }
    const value = await fn(db);
    a.operations[id] = { fingerprint: digest, result: value };
    return value;
  });
  notify();
  if (fault === 'unknown')
    return fail(
      'UNKNOWN',
      '응답이 끊겨 처리 결과를 확인해야 합니다. 처리 결과 다시 확인을 눌러 주세요.',
    );
  return result;
}
export const authApi: AuthAdapter = {
  async requestSms(phone, purpose, source, reauth) {
    await before(false, 'auth');
    if (!phoneValid(phone) || !source || !['access', 'reset', 'change'].includes(purpose))
      return fail('VALIDATION', '010으로 시작하는 11자리 전화번호를 입력해 주세요.');
    return run((db) => {
      const a = authState(db),
        normalized = normalizePhone(phone);
      if (purpose === 'change') {
        const r = a.reauth[reauth || ''];
        if (!r || r.used || r.expiresAt <= Date.now())
          return fail('AUTH', '계정 재인증부터 다시 진행해 주세요.');
        requireSession(db, r.session);
      }
      const previous = a.sms.filter((c) => c.phone === normalized).at(-1);
      if (previous && previous.resendAt > Date.now())
        throw new ServiceError(
          'SMS_WAIT',
          '인증번호 재발송을 잠시 기다려 주세요.',
          previous.resendAt,
        );
      rate(a, 'send-phone:' + normalized, D.phoneSends);
      rate(a, 'send-source:' + source, D.sourceSends);
      a.sms.filter((c) => c.phone === normalized).forEach((c) => (c.used = true));
      const c = {
        id: crypto.randomUUID(),
        phone: normalized,
        purpose,
        source,
        reauth,
        attempts: 0,
        expiresAt: Date.now() + P.smsTtlMs,
        resendAt: Date.now() + P.smsResendMs,
      };
      a.sms.push(c);
      return { id: c.id, expiresAt: c.expiresAt, resendAt: c.resendAt };
    });
  },
  async verifySms(id, phone, code, purpose, source) {
    await before(false, 'auth');
    return run((db) => {
      const a = authState(db),
        c = a.sms.find(
          (c) =>
            c.id === id &&
            c.phone === normalizePhone(phone) &&
            c.purpose === purpose &&
            c.source === source,
        );
      if (!c || c.used || c.verified)
        return fail(
          'SMS_USED',
          '사용되었거나 새 번호로 교체된 인증번호입니다. 다시 요청해 주세요.',
        );
      if (c.expiresAt <= Date.now())
        return fail('SMS_EXPIRED', '인증번호가 만료되었습니다. 다시 발송해 주세요.');
      rate(a, 'check-phone:' + c.phone, D.phoneChecks);
      rate(a, 'check-source:' + source, D.sourceChecks);
      if (code !== D.smsCode) {
        c.attempts++;
        if (c.attempts >= P.smsAttempts) {
          c.used = true;
          return fail('SMS_LIMIT', '인증번호를 5회 틀려 폐기했습니다. 다시 발송해 주세요.');
        }
        return fail('SMS_INVALID', '인증번호가 일치하지 않습니다. (' + c.attempts + '/5)');
      }
      c.verified = true;
      c.proof = crypto.randomUUID();
      c.proofExpiresAt = Date.now() + D.proofMs;
      const user = db.users.find((u) => u.phone === c.phone);
      return {
        proof: c.proof,
        expiresAt: c.proofExpiresAt,
        maskedPhone: masked(c.phone),
        existing: !!user,
        needsPin: !!user && !user.pinHash,
      };
    });
  },
  async registration(token) {
    await before(false, 'auth');
    return run((db) => {
      const r = authState(db).registrations[token];
      if (!r || r.reason || r.expiresAt <= Date.now()) return null;
      const user = db.users.find((u) => u.id === r.userId)!;
      const a = authState(db).attempts[user.id];
      return {
        maskedPhone: masked(user.phone),
        retryAt: a?.retryAt || 0,
        locked: (a?.failures || 0) >= 20,
      };
    });
  },
  login(id, credential, pin, registered, source) {
    return operation(
      id,
      JSON.stringify(['login', credential, pin, registered, source]),
      async (db) => {
        const c = registered ? undefined : proof(db, credential, 'access', source);
        const uid = registered
          ? registration(db, credential).userId
          : db.users.find((u) => u.phone === c!.phone)?.id;
        if (!uid) return fail('AUTH', '회원가입부터 진행해 주세요.');
        await checkPin(db, uid, pin, source);
        if (c) c.used = true;
        return loginResult(db, uid);
      },
    );
  },
  loginWithPhone(id, phone, pin, source) {
    return operation(id, JSON.stringify(['phone-login', phone, pin, source]), async (db) => {
      if (!phoneValid(phone)) return fail('PHONE', '올바른 전화번호를 입력해 주세요.');
      const user = db.users.find((u) => u.phone === normalizePhone(phone));
      if (!user) {
        rate(authState(db), 'pin:' + source, D.pinRequests);
        return fail('PIN', '전화번호 또는 PIN이 일치하지 않습니다. 다시 확인해 주세요.');
      }
      try {
        await checkPin(db, user.id, pin, source);
      } catch (error) {
        if (error instanceof ServiceError && error.code === 'PIN_INVALID')
          return fail('PIN', '전화번호 또는 PIN이 일치하지 않습니다. 다시 확인해 주세요.');
        throw error;
      }
      return loginResult(db, user.id);
    });
  },
  signup(id, value, pin, source, profile) {
    return operation(id, JSON.stringify(['signup', value, pin, source, profile]), async (db) => {
      const c = proof(db, value, 'access', source);
      const problem = pinError(pin);
      if (problem) return fail('PIN_POLICY', problem);
      if (db.users.some((u) => u.phone === c.phone))
        return fail(
          'DUPLICATE',
          '이미 가입된 번호입니다. 전화번호 인증 후 기존 PIN으로 로그인해 주세요.',
        );
      const name = profile?.name?.trim(),
        occupation = profile?.occupation?.trim();
      if (!name || name.length > 40 || !occupation || occupation.length > 40)
        return fail('PROFILE', '이름과 직업을 각각 40자 이내로 입력해 주세요.');
      const user = {
        id: crypto.randomUUID(),
        phone: c.phone,
        name,
        occupation,
        pinHash: await pinHash(pin),
      };
      db.users.push(user);
      c.used = true;
      return loginResult(db, user.id);
    });
  },
  resetPin(id, value, pin, source) {
    return operation(id, JSON.stringify(['reset', value, pin, source]), async (db) => {
      const c = proof(db, value, 'reset', source);
      const user = db.users.find((u) => u.phone === c.phone);
      if (!user) return fail('RECOVERY', '등록된 계정을 찾을 수 없습니다.');
      const problem = pinError(pin);
      if (problem) return fail('PIN_POLICY', problem);
      user.pinHash = await pinHash(pin);
      delete user.passwordHash;
      c.used = true;
      revoke(db, user.id, 'PIN이 재설정되어 로그아웃되었습니다. 다시 인증해 주세요.');
      authState(db).attempts[user.id] = { failures: 0, retryAt: 0 };
      authState(db)
        .sms.filter((s) => s.phone === user.phone)
        .forEach((s) => (s.used = true));
      return { completed: true };
    });
  },
  async reauthenticate(token, pin, source) {
    await before(false, 'auth');
    return run(async (db) => {
      const s = requireSession(db, token);
      await checkPin(db, s.userId, pin, source);
      const value = crypto.randomUUID();
      authState(db).reauth[value] = {
        userId: s.userId,
        session: token,
        expiresAt: Date.now() + D.proofMs,
      };
      return value;
    });
  },
  changePhone(id, value, reauth, source) {
    return operation(id, JSON.stringify(['change', value, reauth, source]), (db) => {
      const c = proof(db, value, 'change', source),
        a = authState(db),
        r = a.reauth[reauth];
      if (!r || r.used || r.expiresAt <= Date.now() || c.reauth !== reauth)
        return fail('AUTH', '계정 재인증부터 다시 진행해 주세요.');
      requireSession(db, r.session);
      if (db.users.some((u) => u.phone === c.phone))
        return fail('DUPLICATE', '이미 사용 중인 전화번호입니다. 다른 번호를 확인해 주세요.');
      const user = db.users.find((u) => u.id === r.userId)!;
      a.sms.filter((s) => s.phone === user.phone).forEach((s) => (s.used = true));
      user.phone = c.phone;
      c.used = true;
      r.used = true;
      revoke(db, user.id, '전화번호가 변경되어 로그아웃되었습니다. 새 번호로 로그인해 주세요.');
      return { completed: true };
    });
  },
  async result(id) {
    await before(false, 'auth');
    return run((db) => {
      const result = authState(db).operations[id]?.result || null;
      if (result && 'token' in result) requireSession(db, result.token);
      return result;
    });
  },
  async logout(token) {
    await before(false, 'auth');
    await run((db) => {
      const s = authState(db).sessions[token];
      if (s) s.reason = '로그아웃되었습니다.';
    });
    notify();
  },
  async unregister(token) {
    await before(false, 'auth');
    await run((db) => {
      const a = authState(db),
        r = a.registrations[token];
      if (r) r.reason = '브라우저 등록이 해제되었습니다.';
      Object.values(a.sessions)
        .filter((s) => s.registration === token)
        .forEach((s) => (s.reason = '브라우저 등록이 해제되었습니다.'));
    });
    notify();
  },
};
// A separate mock client sharing the demo database; real multi-device sync is not implemented.
export async function simulateOtherBrowser() {
  const source = 'simulated-other-browser';
  return authApi.loginWithPhone(crypto.randomUUID(), MOCK.demoPhone, D.pin, source);
}
