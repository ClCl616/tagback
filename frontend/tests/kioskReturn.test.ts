import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReturnClient, lookupReturnTag } from '../src/shared/kioskReturn';
import { subscribeServerConnection, verifyRentalCode } from '../src/shared/kioskHttp';

const response = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
afterEach(() => vi.unstubAllGlobals());

describe('return integration boundary', () => {
  it.each([
    [410, 'RENTAL_GRANT_EXPIRED', 'AUTH', '코드 인증 시간이 지났어요. 새 코드를 받아 다시 입력해 주세요.'],
    [409, 'RENTAL_CODE_CONSUMED', 'CODE_USED', '이미 사용한 코드예요. 새 코드를 받아 입력해 주세요.'],
    [429, 'RENTAL_VERIFICATION_LIMITED', 'RENTAL_VERIFICATION_LIMITED', '잠시 후 코드를 다시 확인해 주세요.'],
  ])('handles return code error %s %s', async (status, code, expected, message) => {
    const retryAt = '2026-11-04T12:00:00Z';
    const client = createReturnClient(async () => response(status, { error: { code, retryAt } }), async () => ({}));
    await expect(client.returnItem('12')).rejects.toMatchObject({ code: expected, message,
      ...(status === 429 ? { retryAt: Date.parse(retryAt) } : {}) });
  });
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
    await expect(client.lookup('04:a2:3b:1c:5d:6e:80')).rejects.toMatchObject({ code: 'AUTH_PENDING', message: '반납 코드를 입력해 주세요.' });
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
  it('checks the scanned UID before leaving return confirmation unsupported', async () => {
    const transport = vi.fn().mockResolvedValue(response(200, { tag: { uid: '04A23B1C5D6E80', status: 'ACTIVE' } }));
    const client = createReturnClient(transport, async () => ({}));
    await expect(lookupReturnTag('04A23B1C5D6E80', client)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe('/api/tags/04A23B1C5D6E80');
  });
  it.each([[404, 'TAG_NOT_FOUND', 'TAG_UNKNOWN'], [409, 'TAG_INACTIVE', 'TAG_INACTIVE']])
   ('maps return lookup error %s %s', async (status, code, expected) => {
      const client = createReturnClient(async () => response(status, { error: { code } }), async () => ({ 'X-Test-Auth': 'mock' }));
      await expect(lookupReturnTag('04A23B1C5D6E80', client)).rejects.toMatchObject({ code: expected });
    });
  it.each([
    [404, 'TAG_NOT_FOUND', '등록되지 않은 태그입니다. 반납할 물품의 태그를 확인해 주세요.'],
    [409, 'TAG_INACTIVE', '사용 중지된 태그입니다. 관리자에게 문의해 주세요.'],
    [404, 'ITEM_NOT_FOUND', '해당 물품을 찾을 수 없습니다.'],
    [409, 'RENTAL_NOT_ACTIVE', '이미 반납됐거나 진행 중인 대여가 없습니다.'],
  ])('provides the scan guidance for %s %s', async (status, code, message) => {
    const client = createReturnClient(async () => response(status, { error: { code } }), async () => ({}));
    await expect(lookupReturnTag('04A23B1C5D6E80', client)).rejects.toMatchObject({ message });
  });
  it.each([
    [404, 'TAG_NOT_FOUND', 'TAG_UNKNOWN'], [409, 'TAG_INACTIVE', 'TAG_INACTIVE'],
    [400, 'INVALID_INPUT', 'INVALID_INPUT'], [404, 'ITEM_NOT_FOUND', 'ITEM_NOT_FOUND'],
    [409, 'RENTAL_NOT_ACTIVE', 'RENTAL_NOT_ACTIVE'], [409, 'RENTAL_STATE_CONFLICT', 'RENTAL_STATE_CONFLICT'],
  ])('maps %s %s', async (status, code, expected) => {
    const client = createReturnClient(async () => response(status, { error: { code } }), async () => ({ 'X-Test-Auth': 'mock' }));
    await expect(client.returnItem('12')).rejects.toMatchObject({ code: expected });
  });
  it.each([
    [401, 'SESSION_REQUIRED', 'RETURN_CODE_AUTH', '코드를 다시 입력해 주세요.'],
    [401, 'SESSION_EXPIRED', 'RETURN_CODE_AUTH', '코드를 다시 입력해 주세요.'],
    [401, 'SESSION_REPLACED', 'RETURN_CODE_AUTH', '코드를 다시 입력해 주세요.'],
    [401, undefined, 'RETURN_CODE_AUTH', '코드를 다시 입력해 주세요.'],
    [401, 'UNRECOGNIZED', 'RETURN_CODE_AUTH', '코드를 다시 입력해 주세요.'],
    [403, 'FORBIDDEN', 'RETURN_FORBIDDEN', '대여한 본인만 반납할 수 있어요. 대리 반납은 불가해요.'],
    [403, undefined, 'RETURN_FORBIDDEN', '대여한 본인만 반납할 수 있어요. 대리 반납은 불가해요.'],
    [403, 'UNRECOGNIZED', 'RETURN_FORBIDDEN', '대여한 본인만 반납할 수 있어요. 대리 반납은 불가해요.'],
  ])('classifies authentication error %s %s by status', async (status, code, expected, message) => {
    const body = code === undefined ? {} : { error: { code } };
    const client = createReturnClient(async () => response(status, body), async () => ({}));
    await expect(client.returnItem('12')).rejects.toMatchObject({ code: expected, message });
  });
  it.each([
    ['RENTAL_CODE_INVALID', 'CODE_INVALID'],
    ['RENTAL_CODE_EXPIRED', 'CODE_EXPIRED'],
    ['RENTAL_CODE_CONSUMED', 'CODE_USED'],
  ])('keeps existing rental verification mapping for %s', async (code, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(400, { error: { code, message: '코드를 확인해 주세요.' } })));
    await expect(verifyRentalCode('123456')).rejects.toMatchObject({ code: expected });
  });
});
