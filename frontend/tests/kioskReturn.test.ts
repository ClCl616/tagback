import { describe, expect, it, vi } from 'vitest';
import { createReturnClient, lookupReturnTag } from '../src/shared/kioskReturn';
import { subscribeServerConnection } from '../src/shared/kioskHttp';

const response = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;

describe('return integration boundary', () => {
  it('classifies a non-JSON 500 as a disconnected server', async () => {
    const states: string[] = [];
    const stop = subscribeServerConnection(state => states.push(state));
    const client = createReturnClient(async () => new Response('', { status: 500, headers: { 'Content-Type': 'text/plain' } }), async () => ({}));
    await expect(client.lookup('04A23B1C5D6E80')).rejects.toMatchObject({ code: 'SERVER_UNAVAILABLE' });
    expect(states.at(-1)).toBe('disconnected');
    stop();
  });
  it.each([['NETWORK', new TypeError('offline')], ['TIMEOUT', Object.assign(new Error('timeout'), { name: 'TimeoutError' })]])
    ('classifies transport failure as %s', async (code, error) => {
      const states: string[] = [];
      const stop = subscribeServerConnection(state => states.push(state));
      const transport = vi.fn().mockRejectedValue(error);
      const client = createReturnClient(transport, async () => ({}));
      await expect(client.lookup('04A23B1C5D6E80')).rejects.toMatchObject({ code });
      expect(transport.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
      expect(states.at(-1)).toBe('disconnected');
      stop();
    });
  it('treats a backend-formatted 5xx as connected and maps the backend error', async () => {
    const states: string[] = [];
    const stop = subscribeServerConnection(state => states.push(state));
    const client = createReturnClient(async () => response(503, { error: { code: 'RENTAL_STATE_CONFLICT' } }), async () => ({}));
    await expect(client.returnItem('12')).rejects.toMatchObject({ code: 'RENTAL_STATE_CONFLICT' });
    expect(states.at(-1)).toBe('connected');
    stop();
  });
  it('requires explicit authentication and does not call the transport otherwise', async () => {
    const transport = vi.fn();
    const client = createReturnClient(transport, async () => undefined);
    await expect(client.lookup('04:a2:3b:1c:5d:6e:80')).rejects.toMatchObject({ code: 'AUTH_PENDING' });
    expect(transport).not.toHaveBeenCalled();
    await expect(lookupReturnTag('04A23B1C5D6E80')).rejects.toMatchObject({ code: 'AUTH_PENDING' });
  });
  it('normalizes UID, injects headers and checks returned UID', async () => {
    const transport = vi.fn().mockResolvedValueOnce(response(200, { tag: { uid: '04A23B1C5D6E80', status: 'ACTIVE' } }))
      .mockResolvedValueOnce(response(200, { tag: { uid: '04A23B1C5D6E81', status: 'ACTIVE' } }));
    const client = createReturnClient(transport, async () => ({ 'X-Test-Auth': 'mock' }));
    await client.lookup('04:a2:3b:1c:5d:6e:80');
    expect(transport.mock.calls[0][0]).toBe('/api/tags/04A23B1C5D6E80');
    expect((transport.mock.calls[0][1].headers as Headers).get('X-Test-Auth')).toBe('mock');
    await expect(client.lookup('04A23B1C5D6E80')).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it.each([[404, 'TAG_NOT_FOUND', 'TAG_UNKNOWN'], [409, 'TAG_INACTIVE', 'TAG_INACTIVE']])
   ('maps return lookup error %s %s', async (status, code, expected) => {
      const client = createReturnClient(async () => response(status, { error: { code } }), async () => ({ 'X-Test-Auth': 'mock' }));
      await expect(lookupReturnTag('04A23B1C5D6E80', client)).rejects.toMatchObject({ code: expected });
    });
  it.each([
    [404, 'TAG_NOT_FOUND', 'TAG_UNKNOWN'], [409, 'TAG_INACTIVE', 'TAG_INACTIVE'],
    [400, 'INVALID_INPUT', 'INVALID_INPUT'], [401, 'SESSION_EXPIRED', 'AUTH_PENDING'],
    [403, 'FORBIDDEN', 'AUTH_PENDING'], [404, 'ITEM_NOT_FOUND', 'ITEM_NOT_FOUND'],
    [409, 'RENTAL_NOT_ACTIVE', 'RENTAL_NOT_ACTIVE'], [409, 'RENTAL_STATE_CONFLICT', 'RENTAL_STATE_CONFLICT'],
  ])('maps %s %s', async (status, code, expected) => {
    const client = createReturnClient(async () => response(status, { error: { code } }), async () => ({ 'X-Test-Auth': 'mock' }));
    await expect(client.returnItem('12')).rejects.toMatchObject({ code: expected });
  });
});
