import { nfc, type NfcAdapter } from '../shared/nfc';
import type { KioskHost } from './contracts';

export type KioskRuntime = {
  mode: 'web' | 'host' | 'blocked';
  host?: KioskHost;
  reader: NfcAdapter;
  tablet: boolean;
  error?: string;
};
const unavailableReader: NfcAdapter = {
  subscribe(_listener, options) {
    options?.onStatus?.('disconnected');
    return () => {};
  },
};
let runtime: KioskRuntime | undefined;
let requireHost = false;
/** Called by the installed entry before rendering. Never downgrade an initialized runtime. */
export function requireInstalledHost() {
  if (runtime) throw new Error('Kiosk runtime already initialized');
  requireHost = true;
}
export function getKioskRuntime(): KioskRuntime {
  if (runtime) return runtime;
  const candidate: unknown = typeof window === 'undefined' ? undefined : window.tagbackKioskHost;
  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const preview =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('layout') === 'tablet';
  const blocked = (message: string): KioskRuntime => ({
    mode: 'blocked',
    reader: unavailableReader,
    tablet: android || preview,
    error: message,
  });
  if (candidate === undefined) {
    runtime = requireHost
      ? blocked('키오스크 호스트를 연결하지 못했습니다. 설치 앱에서 다시 실행해 주세요.')
      : { mode: 'web', reader: android ? unavailableReader : nfc, tablet: android || preview };
    return runtime;
  }
  const host = candidate as Partial<KioskHost> | null;
  if (
    !host ||
    ![1, 2].includes(host.version!) ||
    !['windows', 'android'].includes(host.platform!) ||
    typeof host.reader?.subscribe !== 'function' ||
    ['subscribeBack', 'openOperatorPanel', 'requestExit'].some((key) => {
      const value = (host as unknown as Record<string, unknown>)[key];
      return value !== undefined && typeof value !== 'function';
    })
  ) {
    return (runtime = blocked(
      '키오스크 호스트 버전 또는 연결 규격이 맞지 않습니다. 앱 업데이트를 확인해 주세요.',
    ));
  }
  if (requireHost && host.version !== 2)
    return (runtime = blocked('설치 앱에는 호스트 v2가 필요합니다. 앱 업데이트를 확인해 주세요.'));
  if (
    host.version === 2 &&
    (host.capabilities?.transport !== 1 || typeof host.request !== 'function')
  )
    return (runtime = blocked('키오스크 호스트의 서버 통신 기능이 호환되지 않습니다.'));
  return (runtime = {
    mode: host.version === 2 ? 'host' : 'web',
    host: host as KioskHost,
    reader: host.reader!,
    tablet: host.platform === 'android' || preview,
  });
}
