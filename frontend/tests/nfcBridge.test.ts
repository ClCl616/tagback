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
    const tags: string[] = [];
    const states: string[] = [];
    let removed = 0;
    const stop = bridgeNfc.subscribe((uid) => tags.push(uid), {
      onStatus: (status) => states.push(status), onRemoved: () => removed++,
    });
    const source = FakeEventSource.latest;
    expect(source.url).toBe('http://127.0.0.1:8765/events');
    source.dispatch('READER_CONNECTED');
    source.dispatch('TAG_READ', '{"type":"TAG_READ","uid":"04C8AB82492490"}');
    source.dispatch('TAG_READ', '{"type":"TAG_READ","uid":"not-a-uid"}');
    source.dispatch('TAG_REMOVED');
    source.onerror?.();
    source.dispatch('READER_CONNECTED');
    expect(tags).toEqual(['04C8AB82492490']);
    expect(removed).toBe(1);
    expect(states).toEqual(['connecting', 'connected', 'disconnected', 'connected']);
    stop();
    expect(source.closed).toBe(true);
    vi.unstubAllGlobals();
  });
});
