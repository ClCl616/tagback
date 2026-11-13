import { serverSession, timestamp } from './httpAuth';
import { authApi } from './auth';
import { ServiceError } from './serviceError';
import { KIOSK } from './config';
import { allPages, positiveId } from './http';
import { catalogHttp } from './catalogHttp';
import { rentalCatalog } from './kioskHttp';
import { kioskApi } from './kioskApi';
import { issueRentalCode } from './rentalCodeHttp';
import type { ServiceApi, Rental } from './types';
export { ServiceError } from './serviceError';
export const fail = (code: string, message: string): never => {
  throw new ServiceError(code, message);
};
export const normalizePhone = (v: string) => v.replace(/[\s-]/g, '');
export const phoneValid = (v: string) => /^010\d{8}$/.test(normalizePhone(v));
export function notify() {
  window.dispatchEvent(new Event('tagback-change'));
}
export const api: ServiceApi = {
  catalog: (grant) => (grant ? rentalCatalog(grant) : catalogHttp()),
  logout: (token) => authApi.logout(token),
  async me() {
    const { user } = await serverSession();
    return {
      phone: user.maskedPhoneNumber,
      name: user.name || '회원',
      occupation: user.occupation || '',
    };
  },
  code: () => issueRentalCode(),
  async rentals() {
    const signal = AbortSignal.timeout(60000);
    const lists = await Promise.all(
      ['ACTIVE', 'HISTORY'].map((scope) =>
        allPages(`/api/v1/rentals/me?scope=${scope}`, 'rentals', signal),
      ),
    );
    const rows: Rental[] = lists.flat().map((r) => {
      if (
        !positiveId(r.rentalId) ||
        !positiveId(r.itemId) ||
        typeof r.itemName !== 'string' ||
        typeof r.itemTypeName !== 'string' ||
        typeof r.overdue !== 'boolean'
      )
        throw new ServiceError('UNKNOWN', '대여 이력을 확인하지 못했습니다.');
      return {
        id: r.rentalId,
        itemId: r.itemId,
        userId: '',
        stationId: KIOSK.stationId,
        rentedAt: timestamp(r.rentedAt),
        dueAt: timestamp(r.dueAt),
        returnedAt: r.returnedAt === null ? undefined : timestamp(r.returnedAt),
        itemName: r.itemName,
        itemTypeName: r.itemTypeName,
        overdue: r.overdue,
      };
    });
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new ServiceError('CHANGED', '대여 상태가 변경되었습니다. 다시 조회해 주세요.');
    return rows.sort((a, b) => b.rentedAt - a.rentedAt);
  },
  verifyCode: kioskApi.verifyCode,
  scan: kioskApi.scan,
  rent: kioskApi.rent,
  returnItem: kioskApi.returnItem,
  operation: kioskApi.operation,
};
