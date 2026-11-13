import { ServiceError } from './serviceError';
import { KIOSK } from './config';
import {
  checkoutRental,
  lookupRentalTag,
  lookupReturnTag,
  returnRental,
  rentalCatalog,
  verifyRentalCode,
} from './kioskHttp';
import type { ServiceApi } from './types';
const fail = (code: string, message: string): never => {
  throw new ServiceError(code, message);
};
export const kioskApi: Pick<
  ServiceApi,
  'catalog' | 'verifyCode' | 'scan' | 'rent' | 'returnItem' | 'operation'
> = {
  catalog: (grant) =>
    grant ? rentalCatalog(grant) : Promise.resolve({ kinds: [], items: [], stations: [] }),
  verifyCode: verifyRentalCode,
  async scan(tag, mode, kindId, grant, proof) {
    if (mode === 'return') {
      if (!proof || proof.uid !== tag)
        return fail('NFC_SCAN_REQUIRED', '실물 태그를 리더기에 인식해 주세요.');
      const result = await lookupReturnTag(proof);
      return {
        item: result.item,
        returnScanTicketId: result.scanTicketId,
        returnScanProof: proof,
        rental: {
          id: result.rentalId,
          userId: '',
          itemId: result.item.id,
          stationId: KIOSK.stationId,
          rentedAt: 0,
          dueAt: 0,
        },
      };
    }
    if (!grant) return fail('AUTH', '대여 코드를 다시 확인해 주세요.');
    return { item: await lookupRentalTag(tag, grant, kindId || '') };
  },
  rent: checkoutRental,
  returnItem(id, _itemId, rentalId, _tagUid, scanTicketId, proof, condition, returnCode) {
    if (!scanTicketId || !proof)
      return Promise.reject(new ServiceError('NFC_SCAN_REQUIRED', '태그를 다시 인식해 주세요.'));
    return returnRental(id, scanTicketId, rentalId, proof, condition, returnCode);
  },
  async operation() {
    return fail('UNSUPPORTED', '결과 조회를 지원하지 않습니다. 관리자에게 확인해 주세요.');
  },
};
