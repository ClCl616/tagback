import { nfc, type NfcAdapter } from '../shared/nfc';

/** Installed hosts supply their own device/lifecycle implementation before React starts.
 * Proof creation belongs to the trusted device integration, never to the UI.
 * A host must authorize privileged operations independently of the visible UI.
 */
export interface KioskHost {
  version: 1;
  platform: 'windows' | 'android';
  reader: NfcAdapter;
  subscribeBack?: (listener: () => void) => () => void;
  /** Opens a host-owned panel that authenticates ADMIN on the server before any
   * privileged action. The web UI never supplies an authorization boolean. */
  openOperatorPanel?: () => Promise<void>;
  requestExit?: () => Promise<void>;
}
declare global {
  interface Window {
    tagbackKioskHost?: KioskHost;
  }
}
export function getKioskPlatform() {
  const host = window.tagbackKioskHost?.version === 1 ? window.tagbackKioskHost : undefined;
  const android = host?.platform === 'android' || /Android/i.test(navigator.userAgent);
  const tablet = android || new URLSearchParams(location.search).get('layout') === 'tablet';
  return { host, tablet, reader: host?.reader || (android ? unavailableReader : nfc) };
}
// The Android host is not implemented by a Windows localhost SSE connection.
const unavailableReader: NfcAdapter = {
  subscribe(_listener, options) {
    options?.onStatus?.('disconnected');
    return () => {};
  },
};
