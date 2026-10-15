import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutRental, lookupRentalTag, rentalCatalog, verifyRentalCode } from '../src/shared/kioskHttp';
import type { Grant } from '../src/shared/types';

const grant: Grant = { token: 'rental-token', maskedPhone: '010****5678', expiresAt: Date.now() + 60000 };
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300,
  status, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('real kiosk HTTP contract', () => {
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
    fetch.mockResolvedValueOnce(json({ item: { ...item, rentable: false }, tag: { status: 'ACTIVE' } }));
    await expect(lookupRentalTag('04A23B1C5D6E80', grant, '12')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
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
});
