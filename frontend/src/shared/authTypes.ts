export type KakaoPurpose = 'SIGNUP' | 'LOGIN' | 'PIN_RESET';
export type KakaoChallenge = { id: string; code: string; expiresAt: number };
export type KakaoStatus = { purpose: KakaoPurpose; status: 'PENDING' | 'VERIFIED' | 'CONSUMED' | 'CANCELED' | 'EXPIRED'; expiresAt: number };
export type AuthResult = { token: string; registration: string } | { completed: true };
export interface AuthAdapter {
  issue(purpose: KakaoPurpose): Promise<KakaoChallenge>;
  status(id: string): Promise<KakaoStatus>;
  cancel(id: string): Promise<void>;
  registration(): Promise<boolean>;
  registeredLogin(key: string, pin: string): Promise<AuthResult>;
  newBrowserLogin(key: string, challengeId: string, pin: string): Promise<AuthResult>;
  signup(key: string, challengeId: string, pin: string, profile: { name: string; occupation: string }): Promise<AuthResult>;
  resetPin(key: string, challengeId: string, pin: string): Promise<AuthResult>;
  result(key: string): Promise<AuthResult>;
  logout(token?: string): Promise<void>;
  unregister(): Promise<void>;
}
