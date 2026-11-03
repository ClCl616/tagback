import { describe, expect, it, vi } from 'vitest';
import { bridgeNfc } from '../src/shared/nfc';

class FakeEventSource {
  static latest: FakeEventSource;
  listeners = new Map<string, (event: MessageEvent) => void>();
  closed = false;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(public url: string) { FakeEventSource.latest = this; }
  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener as (event: MessageEvent) => void);
  }
  dispatch(type: string, data = `{ "type": "${type}" }`) {
    this.listeners.get(type)?.({ data } as MessageEvent);
  }
  close() { this.closed = true; }
}

describe('reader bridge SSE adapter', () => {
  it('연결, UID 인식, 제거, 연결 오류와 복구를 UI에 전달한다', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const reads: { uid: string; proof?: { bridgeId: string } }[] = [];
    const states: string[] = [];
    let removed = 0;
    const stop = bridgeNfc.subscribe((read) => reads.push(read), {
      onStatus: (status) => states.push(status), onRemoved: () => removed++,
    });
    const source = FakeEventSource.latest;
    expect(source.url).toBe('http://127.0.0.1:8765/events');
    source.dispatch('READER_CONNECTED');
    source.dispatch('TAG_READ', '{"type":"TAG_READ","uid":"04C8AB82492490"}');
    source.dispatch('TAG_READ', '{"type":"TAG_READ","uid":"04C8AB82492491","bridgeId":"kiosk-1","issuedAt":1790000000000,"nonce":"98f6da84-f149-4e1d-b6f5-370523b76d2b","signature":"' + '0'.repeat(64) + '"}');
    source.dispatch('TAG_READ', '{"type":"TAG_READ","uid":"not-a-uid"}');
    source.dispatch('TAG_REMOVED');
    source.onerror?.();
    source.dispatch('READER_CONNECTED');
    expect(reads.map((read) => read.uid)).toEqual(['04C8AB82492490', '04C8AB82492491']);
    expect(reads[0].proof).toBeUndefined();
    expect(reads[1].proof?.bridgeId).toBe('kiosk-1');
    expect(removed).toBe(1);
    expect(states).toEqual(['connecting', 'connected', 'disconnected', 'connected']);
    stop();
    expect(source.closed).toBe(true);
    vi.unstubAllGlobals();
  });
});
