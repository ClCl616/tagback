import type { KioskCommand, HostResponse } from './contracts';
import { getKioskRuntime } from './runtime';

export type KioskResponse = { status: number; ok: boolean; json: () => Promise<unknown> };
/** Enumerated commands only: the renderer never supplies URLs, cookies or raw headers. */
export async function kioskRequest(command: KioskCommand): Promise<KioskResponse> {
  const runtime = getKioskRuntime();
  if (runtime.mode === 'blocked') throw new Error('KIOSK_HOST_INCOMPATIBLE');
  const timeout = command.action === 'health' ? 3000 : 15000;
  if (runtime.mode === 'host') {
    const host = runtime.host;
    if (host?.version !== 2) throw new Error('KIOSK_HOST_UNAVAILABLE');
    const requestId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A timeout abandons waiting, not the underlying write. UI recovery keeps operationId.
      const response: HostResponse = await Promise.race([
        Promise.resolve().then(() => host.request({ version: 2, requestId, command })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new DOMException('Host timeout', 'TimeoutError')),
            timeout,
          );
        }),
      ]);
      if (
        !response ||
        response.version !== 2 ||
        response.requestId !== requestId ||
        !Number.isInteger(response.status) ||
        response.status < 200 ||
        response.status > 599
      )
        throw new Error('KIOSK_HOST_INVALID_RESPONSE');
      let data = response.data;
      if (command.action === 'verify' && response.status >= 200 && response.status < 300) {
        const value = data as {
          grantHandle?: unknown;
          maskedPhoneNumber?: unknown;
          expiresAt?: unknown;
        } | null;
        if (typeof value?.grantHandle !== 'string' || !value.grantHandle.length)
          throw new Error('KIOSK_HOST_INVALID_GRANT');
        // Existing UI model field; in a host runtime this is ONLY an opaque handle, never a bearer token.
        data = {
          token: value.grantHandle,
          maskedPhoneNumber: value.maskedPhoneNumber,
          expiresAt: value.expiresAt,
        };
      }
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        json: async () => data,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  let path: string;
  let body: unknown;
  let token: string | undefined;
  let key: string | undefined;
  switch (command.action) {
    case 'health':
      path = '/api/v1/kiosk/health';
      break;
    case 'verify':
      path = '/api/v1/kiosk/rental-grants';
      body = { code: command.code };
      break;
    case 'catalog':
      path = '/api/v1/item-types';
      token = command.grantRef;
      break;
    case 'scan':
      path = `/api/tags/${encodeURIComponent(command.uid)}`;
      token = command.grantRef;
      break;
    case 'rent':
      path = '/api/v1/rentals';
      token = command.grantRef;
      key = command.operationId;
      body = { itemId: command.itemId, itemTypeId: command.itemTypeId };
      break;
    case 'return-scan':
      path = '/api/v1/rentals/return/scan';
      body = { proof: command.proof };
      break;
    case 'return':
      path = '/api/v1/rentals/return';
      body = {
        scanTicketId: command.scanTicketId,
        proof: command.proof,
        condition: command.condition,
        returnCode: command.returnCode,
      };
      break;
    default:
      throw new Error('KIOSK_COMMAND_UNSUPPORTED');
  }
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
}
