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
