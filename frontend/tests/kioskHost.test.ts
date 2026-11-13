import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRequest, KioskHostV2 } from '../src/kiosk-host/contracts';
const key = '4d36c088-5b23-4960-a7e3-c4f98101ac0e';
const ticket = '6fa7b810-77bd-4f49-8cf9-e9bd457f1101';
const proof = {
  bridgeId: 'test',
  uid: '04A23B1C5D6E80',
  issuedAt: 1790000000000,
  nonce: key,
  signature: 'a'.repeat(64),
};
const grant = { token: 'opaque-handle', maskedPhone: '010****5678', expiresAt: Date.now() + 60000 };
function host(
  request = vi.fn(async (r: HostRequest) => ({
    version: 2 as const,
    requestId: r.requestId,
    status: 200,
    data: {},
  })),
): KioskHostV2 {
  return {
    version: 2,
    platform: 'windows',
    capabilities: { transport: 1 },
    reader: { subscribe: () => () => {} },
    request,
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('installed kiosk boundary', () => {
  it.each([
    undefined,
    null,
    { version: 99 },
    { version: 1, platform: 'windows', reader: { subscribe: () => () => {} } },
    { ...host(), capabilities: { transport: 9 } },
    { ...host(), request: undefined },
  ])('blocks missing/incompatible host without web fallback: %j', async (candidate) => {
    vi.stubGlobal('window', { tagbackKioskHost: candidate });
    const runtime = await import('../src/kiosk-host/runtime');
    runtime.requireInstalledHost();
    expect(runtime.getKioskRuntime().mode).toBe('blocked');
    const { kioskRequest } = await import('../src/kiosk-host/transport');
    await expect(kioskRequest({ action: 'health' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps reader-only v1 compatible in the web entry', async () => {
    const candidate = { version: 1, platform: 'windows', reader: { subscribe: () => () => {} } };
    vi.stubGlobal('window', { tagbackKioskHost: candidate });
    const { getKioskRuntime } = await import('../src/kiosk-host/runtime');
    expect(getKioskRuntime()).toMatchObject({ mode: 'web', host: candidate });
  });
  it('accepts an opaque host grant and never sends it to browser fetch', async () => {
    const request = vi.fn(async (r: HostRequest) => ({
      version: 2 as const,
      requestId: r.requestId,
      status: 200,
      data:
        r.command.action === 'verify'
          ? {
              grantHandle: 'native-handle',
              maskedPhoneNumber: '010****5678',
              expiresAt: '2026-12-01T00:00:00Z',
            }
          : { itemTypes: [] },
    }));
    vi.stubGlobal('window', { tagbackKioskHost: host(request) });
    const api = await import('../src/shared/kioskHttp');
    const granted = await api.verifyRentalCode('123456');
    await api.rentalCatalog(granted);
    expect(granted.token).toBe('native-handle');
    expect(request.mock.calls[1][0].command).toEqual({
      action: 'catalog',
      grantRef: 'native-handle',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('lost rental reply retains operation identity and body across replay', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost'))
      .mockImplementation(async (r: HostRequest) => ({
        version: 2,
        requestId: r.requestId,
        status: 200,
        data: {
          rentalId: '9',
          itemId: '5',
          itemTypeId: '1',
          rentalStatus: 'RENTED',
          itemStatus: 'RENTED',
          rentedAt: '2026-11-13T00:00:00Z',
          dueAt: '2026-11-16T00:00:00Z',
        },
      }));
    vi.stubGlobal('window', { tagbackKioskHost: host(request) });
    const { checkoutRental } = await import('../src/shared/kioskHttp');
    await expect(checkoutRental(key, grant, '5', '1')).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect((await checkoutRental(key, grant, '5', '1')).type).toBe('rent');
    const [a, b] = request.mock.calls.map(([r]) => r as HostRequest);
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.command).toEqual(b.command);
    expect(a.command).toMatchObject({ operationId: key });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('a mismatched reply cannot confirm a return; preserves the local operation id and proof', async () => {
    const request = vi.fn(async () => ({
      version: 2 as const,
      requestId: 'unrelated',
      status: 200,
      data: {},
    }));
    vi.stubGlobal('window', { tagbackKioskHost: host(request) });
    const { returnRental } = await import('../src/shared/kioskHttp');
    await expect(returnRental(key, ticket, '9', proof, 'damaged', '123456')).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
    expect(request.mock.calls).toHaveLength(1);
    expect((request.mock.calls as unknown as [[HostRequest]])[0][0].command).toEqual({
      action: 'return',
      operationId: key,
      scanTicketId: ticket,
      proof,
      condition: 'DAMAGED',
      returnCode: '123456',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('host timeout leaves writes unknown and never falls back to HTTP', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { tagbackKioskHost: host(vi.fn(() => new Promise(() => {}))) });
    const { checkoutRental } = await import('../src/shared/kioskHttp');
    const result = expect(checkoutRental(key, grant, '5', '1')).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
    await vi.advanceTimersByTimeAsync(15001);
    await result;
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains server rejection mapping instead of treating every native failure as success', async () => {
    const request = vi.fn(async (r: HostRequest) => ({
      version: 2 as const,
      requestId: r.requestId,
      status: 401,
      data: { error: { code: 'RETURN_CODE_INVALID', message: '코드를 확인해 주세요' } },
    }));
    vi.stubGlobal('window', { tagbackKioskHost: host(request) });
    const { returnRental } = await import('../src/shared/kioskHttp');
    await expect(returnRental(key, ticket, '9', proof, 'normal', '123456')).rejects.toMatchObject({
      code: 'RETURN_CODE_INVALID',
    });
  });
});
