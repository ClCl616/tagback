import { allPages, positiveId, request } from './http';
import { STATION } from './config';
import { ServiceError } from './serviceError';
import type { Catalog, Item, ItemStatus, Kind } from './types';

export const itemStatuses: Record<string, ItemStatus> = {
  TAG_PENDING: 'pending',
  AVAILABLE: 'available',
  RENTED: 'rented',
  INSPECTION: 'inspection',
  REPAIR: 'repair',
};
export function parseItem(row: any): Item {
  if (
    !positiveId(row?.itemId) ||
    !positiveId(row?.itemTypeId) ||
    typeof row.itemName !== 'string' ||
    typeof row.itemTypeName !== 'string' ||
    !Object.hasOwn(itemStatuses, row.status)
  )
    throw new ServiceError('UNKNOWN', '물품 응답을 확인하지 못했습니다.');
  return {
    id: row.itemId,
    name: row.itemName,
    label: row.itemName,
    kindId: row.itemTypeId,
    stationId: STATION.id,
    status: itemStatuses[row.status],
    tag: '',
    tagKnown: false,
    active: row.status === 'AVAILABLE' || row.status === 'RENTED',
  };
}
export function parseKind(row: any): Kind {
  if (!positiveId(row?.itemTypeId) || typeof row.itemTypeName !== 'string')
    throw new ServiceError('UNKNOWN', '물품 종류를 확인하지 못했습니다.');
  return {
    id: row.itemTypeId,
    name: row.itemTypeName,
    category: '공용 물품',
    description: '',
    art: 'generic',
  };
}
export function parsePublicKind(row: any): Kind {
  if (
    !Number.isSafeInteger(row?.totalCount) ||
    row.totalCount < 0 ||
    !Number.isSafeInteger(row?.availableCount) ||
    row.availableCount < 0 ||
    row.availableCount > row.totalCount
  )
    throw new ServiceError('UNKNOWN', '공개 재고를 확인하지 못했습니다.');
  return { ...parseKind(row), totalCount: row.totalCount, availableCount: row.availableCount };
}
export async function publicCatalogHttp(keyword = '', itemTypeId?: string): Promise<Catalog> {
  const signal = AbortSignal.timeout(60000);
  const kinds = itemTypeId
    ? [
        parsePublicKind(
          await request(
            `/api/v1/catalog/item-types/${encodeURIComponent(itemTypeId)}`,
            'GET',
            undefined,
            signal,
          ),
        ),
      ]
    : (
        await allPages(
          `/api/v1/catalog/item-types?keyword=${encodeURIComponent(keyword.trim())}`,
          'itemTypes',
          signal,
        )
      ).map(parsePublicKind);
  if (new Set(kinds.map((k) => k.id)).size !== kinds.length)
    throw new ServiceError('CHANGED', '조회 중 물품이 변경되었습니다. 다시 조회해 주세요.');
  // Public data contains counts only; never invent individual item IDs or statuses.
  return { items: [], kinds, categories: ['공용 물품'], stations: [STATION] };
}
export async function catalogHttp(includeAllTypes = false): Promise<Catalog> {
  const rows = await allPages('/api/v1/items', 'items', AbortSignal.timeout(60000));
  const items = rows.map(parseItem);
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw new ServiceError('CHANGED', '조회 중 물품이 변경되었습니다. 다시 조회해 주세요.');
  let kinds = [...new Map(rows.map((r) => [r.itemTypeId, parseKind(r)])).values()];
  if (includeAllTypes) {
    const data = await request('/api/v1/item-types');
    if (!Array.isArray(data.itemTypes))
      throw new ServiceError('UNKNOWN', '물품 종류를 확인하지 못했습니다.');
    kinds = data.itemTypes.map(parseKind);
  }
  return { items, kinds, categories: ['공용 물품'], stations: [STATION] };
}
