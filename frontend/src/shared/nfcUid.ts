import { ServiceError } from './api';

export function normalizeUid(value: string) {
  const uid = value.replace(/[\s:-]/g, '').toUpperCase();
  if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid))
    throw new ServiceError(
      'INVALID_UID_FORMAT',
      'NFC UID는 16진수 8·14·20자리여야 합니다. 태그를 다시 인식해 주세요.',
    );
  return uid;
}
