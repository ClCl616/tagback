// Confirmed product policy; do not conflate with mock transport settings.
export const AUTH_POLICY = {
  pinLength: 6,
  smsTtlMs: 300_000,
  smsResendMs: 60_000,
  smsAttempts: 5,
  pinWaits: [30_000, 60_000, 300_000],
  pinBlockAt: 20,
} as const;
// Configurable demonstration assumptions, NOT settled production policy.
export const AUTH_DEMO = {
  pin: '048259',
  smsCode: '123456',
  proofMs: 10 * 60_000,
  sessionMs: 24 * 60 * 60_000,
  idleMs: 30 * 60_000,
  registrationMs: 30 * 24 * 60 * 60_000,
  rateWindowMs: 60 * 60_000,
  phoneSends: 10,
  sourceSends: 30,
  phoneChecks: 30,
  sourceChecks: 100,
  pinRequests: 100,
} as const;
export function pinError(pin: string): string | undefined {
  if (!/^\d{6}$/.test(pin)) return '숫자 6자리를 입력해 주세요.';
  if (/(\d)\1{2}/.test(pin)) return '같은 숫자를 3번 연속 사용할 수 없어요.';
  const digits = [...pin].map(Number);
  if ([1, 9].some((step) => digits.slice(1).every((n, i) => (n - digits[i] + 10) % 10 === step)))
    return '6자리 전체가 연속된 숫자예요. 다른 PIN을 입력해 주세요.';
  return undefined;
}
export function pinValid(pin: string) {
  return !pinError(pin);
}
export const REGISTRATION_KEY = 'tagback.mobile.registration';
export const SOURCE_KEY = 'tagback.mock.source';
export function browserSource() {
  let value = localStorage.getItem(SOURCE_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(SOURCE_KEY, value);
  }
  return value; // Demo rate grouping only; never used as authentication evidence.
}
