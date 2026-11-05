import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutRental, lookupRentalTag, lookupReturnTag, probeServerConnection, rentalCatalog, returnRental, subscribeServerConnection, verifyRentalCode } from '../src/shared/kioskHttp';
import type { Grant } from '../src/shared/types';
import { issueRentalCode } from '../src/shared/rentalCodeHttp';

const grant: Grant = { token: 'rental-token', maskedPhone: '010****5678', expiresAt: Date.now() + 60000 };
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300,
  status, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('real kiosk HTTP contract', () => {
  it('모바일 세션으로 일회성 대여·반납 코드를 발급받는다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ code: '123456', expiresAt: '2026-10-14T10:03:00Z' }));
    vi.stubGlobal('fetch', fetch);
    expect((await issueRentalCode()).value).toBe('123456');
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/rental-codes');
    expect(fetch.mock.calls[0][1].credentials).toBe('include');
  });
  it('서버 복구를 주기 확인 요청으로 감지한다', async () => {
    const states: string[] = [];
    const unsubscribe = subscribeServerConnection((state) => states.push(state));
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetch);
    await probeServerConnection();
    await probeServerConnection();
    expect(states.slice(-2)).toEqual(['disconnected', 'connected']);
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/kiosk/health');
    unsubscribe();
  });

  it('반납 응답 유실 뒤 같은 티켓과 증명으로 완료 결과를 다시 확인한다', async () => {
    const key = '4d36c088-5b23-4960-a7e3-c4f98101ac0e';
    const ticket = '6fa7b810-77bd-4f49-8cf9-e9bd457f1101';
    const proof = { bridgeId: 'kiosk-1', uid: '04A23B1C5D6E80', issuedAt: 1790000000000,
      nonce: '98f6da84-f149-4e1d-b6f5-370523b76d2b', signature: 'a'.repeat(64) };
    const result = { rentalId: '9', itemId: '5', rentalStatus: 'RETURNED', itemStatus: 'AVAILABLE',
      condition: 'NORMAL', rentedAt: '2026-10-14T10:00:00Z',
      dueAt: '2026-10-15T10:00:00Z', returnedAt: '2026-10-14T11:00:00Z' };
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(json(result));
    vi.stubGlobal('fetch', fetch);
    await expect(returnRental(key, ticket, '9', proof, 'normal', '123456')).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect((await returnRental(key, ticket, '9', proof, 'normal', '123456')).rental.returnedAt)
      .toBe(Date.parse(result.returnedAt));
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(JSON.parse(fetch.mock.calls[0][1].body).returnCode).toBe('123456');
  });
  it('최근 실제 요청의 HTTP 응답·네트워크 실패·복구를 구분한다', async () => {
    const states: string[] = [];
    const unsubscribe = subscribeServerConnection((state) => states.push(state));
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ error: { code: 'RENTAL_CODE_INVALID' } }, 401))
      .mockResolvedValueOnce(json({ token: grant.token, maskedPhoneNumber: grant.maskedPhone,
        expiresAt: new Date(grant.expiresAt).toISOString() }, 201));
    vi.stubGlobal('fetch', fetch);
    await expect(verifyRentalCode('123456')).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(verifyRentalCode('123456')).rejects.toMatchObject({ code: 'CODE_INVALID' });
    await verifyRentalCode('123456');
    expect(states.slice(-3)).toEqual(['disconnected', 'connected', 'connected']);
    unsubscribe();
  });

  it('네트워크 오류와 시간 초과는 연결 오류로 표시하고 다시 시도할 수 있는 메시지를 준다', async () => {
    const states: string[] = [];
    const unsubscribe = subscribeServerConnection((state) => states.push(state));
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(timeout));

    await expect(verifyRentalCode('123456')).rejects.toMatchObject({
      code: 'NETWORK', message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
    });
    await expect(verifyRentalCode('123456')).rejects.toMatchObject({
      code: 'TIMEOUT', message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
    });
    expect(states.slice(-2)).toEqual(['disconnected', 'disconnected']);
    unsubscribe();
  });

  it('백엔드 오류 형식이 없는 5xx는 연결 오류로 분류한다', async () => {
    const states: string[] = [];
    const unsubscribe = subscribeServerConnection((state) => states.push(state));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => null }));

    await expect(verifyRentalCode('123456')).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE', message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
    });
    expect(states.at(-1)).toBe('disconnected');
    unsubscribe();
  });

  it('백엔드 오류 형식이 있는 5xx는 서버 연결을 정상으로 유지한다', async () => {
    const states: string[] = [];
    const unsubscribe = subscribeServerConnection((state) => states.push(state));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: {
      code: 'BACKEND_FAILURE', message: '일시적인 백엔드 오류',
    } }, 503)));

    await expect(verifyRentalCode('123456')).rejects.toMatchObject({
      code: 'BACKEND_FAILURE', message: '일시적인 백엔드 오류',
    });
    expect(states.at(-1)).toBe('connected');
    unsubscribe();
  });

  it('백엔드 오류 형식이 있는 4xx는 연결 정상으로 두고 기존 오류 코드를 안내한다', async () => {
    const states: string[] = [];
    const unsubscribe = subscribeServerConnection((state) => states.push(state));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: {
      code: 'RENTAL_CODE_INVALID', message: '코드가 올바르지 않습니다.',
    } }, 401)));

    await expect(verifyRentalCode('123456')).rejects.toMatchObject({ code: 'CODE_INVALID' });
    expect(states.at(-1)).toBe('connected');
    unsubscribe();
  });

  it('코드 검증 후 토큰을 받고 목록을 인증하여 조회한다', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ token: grant.token, maskedPhoneNumber: grant.maskedPhone,
        expiresAt: new Date(grant.expiresAt).toISOString() }, 201))
      .mockResolvedValueOnce(json({ itemTypes: [{ itemTypeId: '12', itemTypeName: '우산' }] }));
    vi.stubGlobal('fetch', fetch);
    const result = await verifyRentalCode('123456');
    const catalog = await rentalCatalog(result);
    expect(catalog.kinds).toEqual([expect.objectContaining({ id: '12', name: '우산' })]);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/kiosk/rental-grants');
    expect(fetch.mock.calls[0][1].body).toBe('{"code":"123456"}');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer rental-token');
    expect(fetch.mock.calls[1][1].credentials).toBe('omit');
  });

  it('태그 조회의 종류·대여 가능 여부를 검사한다', async () => {
    const item = { itemId: 5, name: '우산 1', status: 'AVAILABLE', rentable: true,
      itemTypeId: '12', itemTypeName: '우산' };
    const fetch = vi.fn().mockResolvedValue(json({ item, tag: { uid: '04A23B1C5D6E80', status: 'ACTIVE' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await lookupRentalTag('04A23B1C5D6E80', grant, '12')).kindId).toBe('12');
    await expect(lookupRentalTag('04A23B1C5D6E80', grant, '13')).rejects.toMatchObject({ code: 'MISMATCH' });
    fetch.mockResolvedValueOnce(json({ item: { ...item, rentable: false }, tag: { uid: '04A23B1C5D6E80', status: 'ACTIVE' } }));
    await expect(lookupRentalTag('04A23B1C5D6E80', grant, '12')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('요청 UID를 정규화하고 다른 UID 또는 UID 누락 응답을 거부한다', async () => {
    const item = { itemId: 5, name: '우산 1', status: 'AVAILABLE', rentable: true,
      itemTypeId: '12', itemTypeName: '우산' };
    const fetch = vi.fn().mockResolvedValue(json({ item,
      tag: { uid: '04A23B1C5D6E80', status: 'ACTIVE' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await lookupRentalTag('04:a2:3b:1c:5d:6e:80', grant, '12')).tag).toBe('04A23B1C5D6E80');
    expect(fetch.mock.calls[0][0]).toBe('/api/tags/04A23B1C5D6E80');
    for (const uid of [undefined, '04A23B1C5D6E81', 'invalid']) {
      fetch.mockResolvedValueOnce(json({ item, tag: { uid, status: 'ACTIVE' } }));
      await expect(lookupRentalTag('04A23B1C5D6E80', grant, '12')).rejects.toMatchObject({ code: 'UNKNOWN' });
    }
    fetch.mockClear();
    await expect(lookupRentalTag('invalid', grant, '12')).rejects.toMatchObject({ code: 'INVALID_UID_FORMAT' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('미등록·비활성 태그 오류를 사용자 안내로 변환한다', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { code: 'TAG_NOT_FOUND' } }, 404))
      .mockResolvedValueOnce(json({ error: { code: 'TAG_INACTIVE' } }, 409));
    vi.stubGlobal('fetch', fetch);
    await expect(lookupRentalTag('04A23B1C5D6E80', grant, '12')).rejects.toMatchObject({ code: 'TAG_UNKNOWN' });
    await expect(lookupRentalTag('04A23B1C5D6E80', grant, '12')).rejects.toMatchObject({ code: 'TAG_INACTIVE' });
  });

  it('문자열 ID, 동일 멱등 키와 토큰으로 반출을 재시도한다', async () => {
    const result = { rentalId: '9', itemId: '5', itemTypeId: '12', rentalStatus: 'RENTED',
      itemStatus: 'RENTED', rentedAt: '2026-10-14T10:00:00Z', dueAt: '2026-10-15T10:00:00Z' };
    const fetch = vi.fn().mockResolvedValueOnce(json(result, 201)).mockResolvedValueOnce(json(result, 200));
    vi.stubGlobal('fetch', fetch);
    const key = '4d36c088-5b23-4960-a7e3-c4f98101ac0e';
    expect((await checkoutRental(key, grant, '5', '12')).rental.id).toBe('9');
    expect((await checkoutRental(key, grant, '5', '12')).rental.id).toBe('9');
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers['Idempotency-Key']).toBe(key);
      expect(options.headers.Authorization).toBe('Bearer rental-token');
      expect(options.body).toBe('{"itemId":"5","itemTypeId":"12"}');
    }
  });

  it('반출 통신 오류는 결과 미확정으로 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(checkoutRental('4d36c088-5b23-4960-a7e3-c4f98101ac0e', grant, '5', '12'))
      .rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('응답 유실 뒤 같은 키·토큰·본문으로 재시도해 저장 결과 200을 받는다', async () => {
    const result = { rentalId: '9', itemId: '5', itemTypeId: '12', rentalStatus: 'RENTED',
      itemStatus: 'RENTED', rentedAt: '2026-10-14T10:00:00Z', dueAt: '2026-10-15T10:00:00Z' };
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(json(result, 200));
    vi.stubGlobal('fetch', fetch);
    const key = '4d36c088-5b23-4960-a7e3-c4f98101ac0e';
    await expect(checkoutRental(key, grant, '5', '12')).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect((await checkoutRental(key, grant, '5', '12')).rental.id).toBe('9');
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(key);
    expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe(key);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe(fetch.mock.calls[0][1].headers.Authorization);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });

  it('미확정 요청 재시도에서 토큰 만료는 성공·실패가 아닌 별도 상태로 돌린다', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(json({ error: { code: 'RENTAL_GRANT_EXPIRED' } }, 410));
    vi.stubGlobal('fetch', fetch);
    const key = '4d36c088-5b23-4960-a7e3-c4f98101ac0e';
    await expect(checkoutRental(key, grant, '5', '12')).rejects.toMatchObject({ code: 'UNKNOWN' });
    await expect(checkoutRental(key, grant, '5', '12')).rejects.toMatchObject({ code: 'GRANT_EXPIRED' });
    expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe(key);
  });
});


describe('return exception messages', () => {
  const proof = { bridgeId: 'reader', uid: '04A23B1C5D6E80', issuedAt: 1790000000000,
    nonce: '98f6da84-f149-4e1d-b6f5-370523b76d2b', signature: 'a'.repeat(64) };
  const key = '4d36c088-5b23-4960-a7e3-c4f98101ac0e';
  const ticket = '6fa7b810-77bd-4f49-8cf9-e9bd457f1101';
  const reject = (code: string, status = 409, retryAt?: string) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code, message: 'server', retryAt } }, status)));
  };
  it('스캔과 최종 반납에서 대여 없음 안내를 구분한다', async () => {
    reject('RENTAL_NOT_ACTIVE');
    await expect(lookupReturnTag(proof)).rejects.toMatchObject({ code: 'RENTAL_NOT_ACTIVE', message: '등록되지 않았거나 반납할 대여가 없는 태그입니다. 태그를 확인해 주세요.' });
    await expect(returnRental(key, ticket, '9', proof, 'normal', '000000')).rejects.toMatchObject({ code: 'RENTAL_NOT_ACTIVE', message: '이미 반납되었거나 진행 중인 대여가 없습니다.' });
  });
  it('물품 상태 충돌은 관리자 문의를 안내한다', async () => {
    reject('RENTAL_STATE_CONFLICT');
    await expect(returnRental(key, ticket, '9', proof, 'normal', '000000')).rejects.toMatchObject({ code: 'RENTAL_STATE_CONFLICT', message: '물품 상태가 변경되었습니다. 관리자에게 문의해 주세요.' });
  });
  it('반납 인식 증명이 만료되거나 유효하지 않으면 재인식을 안내한다', async () => {
    reject('NFC_SCAN_REQUIRED', 403);
    await expect(returnRental(key, ticket, '9', proof, 'normal', '000000')).rejects.toMatchObject({ code: 'NFC_SCAN_REQUIRED', message: '인식 정보가 만료되었거나 올바르지 않아요. 물품을 다시 인식해 주세요.' });
  });
  it('요청 제한에서 재시도 시각을 보존하고 표시한다', async () => {
    const retry = '2026-11-04T08:00:00Z';
    reject('RENTAL_VERIFICATION_LIMITED', 429, retry);
    await expect(returnRental(key, ticket, '9', proof, 'normal', '000000')).rejects.toMatchObject({ code: 'RENTAL_VERIFICATION_LIMITED', retryAt: Date.parse(retry), message: expect.stringContaining('이후 다시 시도해 주세요.') });
    reject('RENTAL_VERIFICATION_LIMITED', 429);
    await expect(returnRental(key, ticket, '9', proof, 'normal', '000000')).rejects.toMatchObject({ message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
  });
});
