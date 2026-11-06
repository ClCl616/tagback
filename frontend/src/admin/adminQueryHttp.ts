import { ServiceError } from '../shared/serviceError';

export const serverStatusLabels = {
  TAG_PENDING: '태그 연결 대기',
  AVAILABLE: '대여 가능',
  RENTED: '대여 중',
  INSPECTION: '점검 중',
  REPAIR: '수리 중',
} as const;
export type ServerStatus = keyof typeof serverStatusLabels;
export type ServerItem = {
  itemId: string;
  itemName: string;
  itemTypeId: string;
  itemTypeName: string;
  status: ServerStatus;
  createdAt: string;
};
export type ServerItemType = { itemTypeId: string; itemTypeName: string };
export type ServerItemPage = {
  items: ServerItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

async function get(path: string, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'include', cache: 'no-store', signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ServiceError('NETWORK', '서버에 연결하지 못했습니다. 다시 시도해 주세요.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new ServiceError('AUTH', '관리자 계정으로 로그인해 주세요.');
    if (response.status === 403) throw new ServiceError('FORBIDDEN', '관리자 권한이 필요합니다.');
    throw new ServiceError('SERVER', '물품 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
  }
  return body;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validType(value: unknown): value is ServerItemType {
  return (
    record(value) &&
    typeof value.itemTypeId === 'string' &&
    /^[1-9]\d*$/.test(value.itemTypeId) &&
    typeof value.itemTypeName === 'string'
  );
}
function validItem(value: unknown): value is ServerItem {
  return (
    record(value) &&
    typeof value.itemId === 'string' &&
    /^[1-9]\d*$/.test(value.itemId) &&
    typeof value.itemName === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.status === 'string' &&
    Object.hasOwn(serverStatusLabels, value.status) &&
    validType(value)
  );
}
function invalid(): never {
  throw new ServiceError('UNKNOWN', '서버 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
}
export async function fetchItemTypes(signal: AbortSignal): Promise<ServerItemType[]> {
  const data = await get('/api/v1/item-types', signal);
  if (!record(data) || !Array.isArray(data.itemTypes) || !data.itemTypes.every(validType))
    return invalid();
  return data.itemTypes;
}
export async function fetchAdminItems(
  filters: {
    keyword: string;
    itemTypeId: string;
    status: string;
    page: number;
    size: number;
  },
  signal: AbortSignal,
): Promise<ServerItemPage> {
  const params = new URLSearchParams({ page: String(filters.page), size: String(filters.size) });
  if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.itemTypeId) params.set('itemTypeId', filters.itemTypeId);
  if (filters.status) params.set('status', filters.status);
  const data = await get(`/api/v1/admin/items?${params}`, signal);
  if (
    !record(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(validItem) ||
    !Number.isSafeInteger(data.page) ||
    data.page !== filters.page ||
    !Number.isSafeInteger(data.size) ||
    data.size !== filters.size ||
    !Number.isSafeInteger(data.totalElements) ||
    (data.totalElements as number) < 0 ||
    !Number.isSafeInteger(data.totalPages) ||
    (data.totalPages as number) < 0
  )
    return invalid();
  return data as ServerItemPage;
}
