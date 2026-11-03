import { KIOSK_BRIDGE } from './kioskMode';
import type { NfcRead } from './types';

export type ReaderStatus = 'connecting' | 'connected' | 'disconnected';
export interface NfcAdapter {
  subscribe(
    listener: (read: NfcRead) => void,
    options?: { onStatus?: (status: ReaderStatus) => void; onRemoved?: () => void },
  ): () => void;
}

export const simulatorNfc: NfcAdapter = {
  subscribe(listener) {
    const channel = new BroadcastChannel('tagback-nfc');
    channel.onmessage = (e) => {
      if (typeof e.data?.tag === 'string') listener({ uid: e.data.tag });
    };
    return () => channel.close();
  },
};

// EventSource reconnects automatically; the bridge replays its latest reader state on each connection.
export const bridgeNfc: NfcAdapter = {
  subscribe(listener, options) {
    const source = new EventSource('http://127.0.0.1:8765/events');
    options?.onStatus?.('connecting');
    const onRead = (event: MessageEvent) => {
      try {
        const data: unknown = JSON.parse(event.data);
        if (
          data && typeof data === 'object' && 'type' in data && data.type === 'TAG_READ' &&
          'uid' in data && typeof data.uid === 'string' && /^[0-9A-F]{8}(?:[0-9A-F]{6}){0,2}$/.test(data.uid)
        ) {
          const proofValid =
          'bridgeId' in data && typeof data.bridgeId === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(data.bridgeId) &&
          'issuedAt' in data && typeof data.issuedAt === 'number' && Number.isSafeInteger(data.issuedAt) &&
          'nonce' in data && typeof data.nonce === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.nonce) &&
          'signature' in data && typeof data.signature === 'string' && /^[0-9a-f]{64}$/i.test(data.signature);
          listener({ uid: data.uid, proof: proofValid ? {
            bridgeId: data.bridgeId as string, uid: data.uid, issuedAt: data.issuedAt as number, nonce: data.nonce as string,
            signature: data.signature as string,
          } : undefined });
        }
      } catch { /* Ignore malformed bridge events; never scan an unverified UID. */ }
    };
    const onRemoved = () => options?.onRemoved?.();
    const onConnected = () => options?.onStatus?.('connected');
    const onDisconnected = () => options?.onStatus?.('disconnected');
    source.addEventListener('TAG_READ', onRead as EventListener);
    source.addEventListener('TAG_REMOVED', onRemoved);
    source.addEventListener('READER_CONNECTED', onConnected);
    source.addEventListener('READER_DISCONNECTED', onDisconnected);
    source.onerror = () => options?.onStatus?.('disconnected');
    source.onopen = () => options?.onStatus?.('connecting');
    return () => source.close();
  },
};

export const nfc: NfcAdapter = KIOSK_BRIDGE ? bridgeNfc : simulatorNfc;

export function emitTag(tag: string) {
  const channel = new BroadcastChannel('tagback-nfc');
  channel.postMessage({ tag });
  channel.close();
}
