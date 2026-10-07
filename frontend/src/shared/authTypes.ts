export type Purpose = 'access' | 'reset' | 'change';
export type Challenge = { id: string; expiresAt: number; resendAt: number };
export type Verification = {
  proof: string;
  expiresAt: number;
  maskedPhone: string;
  existing: boolean;
  canReset: boolean;
  needsPin: boolean;
};
export type LoginResult = { token: string; registration: string };
export type AuthResult = LoginResult | { completed: true };
export interface AuthAdapter {
  requestSms(phone: string, purpose: Purpose, source: string, reauth?: string): Promise<Challenge>;
  verifySms(
    id: string,
    phone: string,
    code: string,
    purpose: Purpose,
    source: string,
  ): Promise<Verification>;
  registration(
    token: string,
  ): Promise<{ maskedPhone: string; retryAt: number; locked: boolean } | null>;
  login(
    id: string,
    credential: string,
    pin: string,
    registered: boolean,
    source: string,
  ): Promise<AuthResult>;
  loginWithPhone(id: string, phone: string, pin: string, source: string): Promise<AuthResult>;
  signup(
    id: string,
    proof: string,
    pin: string,
    source: string,
    profile: { name: string; occupation: string },
  ): Promise<AuthResult>;
  resetPin(id: string, proof: string, pin: string, source: string): Promise<AuthResult>;
  reauthenticate(token: string, pin: string, source: string): Promise<string>;
  changePhone(id: string, proof: string, reauth: string, source: string): Promise<AuthResult>;
  result(id: string): Promise<AuthResult | null>;
  logout(token: string): Promise<void>;
  unregister(registration: string): Promise<void>;
}
export type AuthDatabase = {
  registrations: Record<string, { userId: string; expiresAt: number; reason?: string }>;
  sessions: Record<
    string,
    { userId: string; registration: string; expiresAt: number; seenAt: number; reason?: string }
  >;
  attempts: Record<string, { failures: number; retryAt: number }>;
  sms: Array<
    Challenge & {
      phone: string;
      purpose: Purpose;
      source: string;
      attempts: number;
      verified?: boolean;
      used?: boolean;
      proof?: string;
      proofExpiresAt?: number;
      reauth?: string;
    }
  >;
  rates: Record<string, number[]>;
  reauth: Record<string, { userId: string; session: string; expiresAt: number; used?: boolean }>;
  operations: Record<string, { fingerprint: string; result: AuthResult }>;
};
