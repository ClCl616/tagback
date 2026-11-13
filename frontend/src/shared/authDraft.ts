import type { Challenge } from './authTypes';
const prefix = 'tagback.http.auth-draft.';
const ttl = 30 * 60000;
// Only resumable metadata is stored. Never store PIN, SMS code or verification proof.
export function readDraft<T>(key: string): T | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(prefix + key) || 'null');
    if (value && Number.isFinite(value.until) && value.until > Date.now()) return value.data;
    sessionStorage.removeItem(prefix + key);
  } catch {}
}
export function writeDraft(key: string, data: unknown) {
  try {
    sessionStorage.setItem(prefix + key, JSON.stringify({ until: Date.now() + ttl, data }));
  } catch {}
}
export function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(prefix + key);
  } catch {}
}
export const phoneKey = (phone: string) => phone.replace(/[\s-]/g, '');
export type SmsDraft = {
  challenge?: Challenge;
  restart: boolean;
  retryAt: number;
};
export function readSmsDraft(mode: string, phone: string): SmsDraft {
  const data = readDraft<SmsDraft>(`sms.${mode}.${phoneKey(phone)}`);
  const c = data?.challenge;
  return {
    challenge:
      c && typeof c.id === 'string' && Number.isFinite(c.expiresAt) && Number.isFinite(c.resendAt)
        ? c
        : undefined,
    restart: data?.restart === true,
    retryAt: Number.isFinite(data?.retryAt) ? data!.retryAt : 0,
  };
}
export function writeSmsDraft(mode: string, phone: string, data: SmsDraft) {
  if (/^010\d{8}$/.test(phoneKey(phone))) writeDraft(`sms.${mode}.${phoneKey(phone)}`, data);
}
