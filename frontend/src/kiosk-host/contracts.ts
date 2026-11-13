import type { NfcAdapter } from '../shared/nfc';
import type { NfcScanProof } from '../shared/types';

export const HOST_PROTOCOL_VERSION = 2 as const;
export type KioskCommand =
  | { action: 'health' }
  | { action: 'verify'; code: string }
  | { action: 'catalog'; grantRef: string }
  | { action: 'scan'; uid: string; grantRef: string }
  | { action: 'rent'; operationId: string; grantRef: string; itemId: string; itemTypeId: string }
  | { action: 'return-scan'; proof: NfcScanProof }
  | {
      action: 'return';
      operationId: string;
      scanTicketId: string;
      proof: NfcScanProof;
      condition: 'NORMAL' | 'DAMAGED';
      returnCode: string;
    };

export type HostRequest = { version: 2; requestId: string; command: KioskCommand };
export type HostResponse = { version: 2; requestId: string; status: number; data: unknown };
interface HostBase {
  platform: 'windows' | 'android';
  reader: NfcAdapter;
  subscribeBack?: (listener: () => void) => () => void;
  /** The host, not this renderer, authorizes privileged actions on the server. */
  openOperatorPanel?: () => Promise<void>;
  requestExit?: () => Promise<void>;
}
export interface KioskHostV1 extends HostBase {
  version: 1;
}
/** P1 transport contract. Does not certify durable journaling or native device integration. */
export interface KioskHostV2 extends HostBase {
  version: 2;
  capabilities: { transport: 1 };
  request: (request: HostRequest) => Promise<HostResponse>;
}
export type KioskHost = KioskHostV1 | KioskHostV2;
declare global {
  interface Window {
    tagbackKioskHost?: KioskHost;
  }
}
