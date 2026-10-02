// All values here are demonstration assumptions, not approved service policies.
export const MOCK = {
  codeLength: 6,
  codeTtlMs: 10 * 60_000,
  rentalMs: 3 * 24 * 60 * 60_000,
  sessionSeconds: 180,
  completionSeconds: 12,
  delayMs: 380,
  stationId: 'engineering',
  demoPhone: '01012345678',
  demoPassword: 'Tagback1!',
} as const;
export const DB_KEY = 'tagback.mock.v1';
export const CONTROL_KEY = 'tagback.mock.controls';
export const MOBILE_TOKEN_KEY = 'tagback.mobile.token';
