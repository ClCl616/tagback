import { serverSession } from '../shared/httpAuth';
import { ServiceError } from '../shared/serviceError';
import { parseItem, parseKind } from '../shared/catalogHttp';
import { STATION } from '../shared/config';
import type { Catalog } from '../shared/types';

export type AdminRecord = {
  id: string;
  name: string;
  detail: string;
  status: string;
  userId?: string;
  itemId?: string;
  rentedAt?: string;
  dueAt?: string;
  returnedAt?: string | null;
  overdue?: boolean;
};
export type AdminData = {
  items: AdminRecord[];
  users: AdminRecord[];
  rentals: AdminRecord[];
  operator: string;
  operatorId: string;
  catalog: Catalog;
  loadedAt: number;
};
type RecordValue = Record<string, unknown>;
const invalid = () => new Error('조회 결과를 확인하지 못했습니다. 새로고침해 주세요.');
function str(row: RecordValue, key: string, nullable = false): string {
  const value = row[key];
  if (nullable && value === null) return '';
  if (typeof value !== 'string') throw invalid();
  return value;
}
function date(row: RecordValue, key: string): string {
  const value = str(row, key);
  if (!Number.isFinite(Date.parse(value))) throw invalid();
  return value;
}
function status(row: RecordValue, key: string, allowed: string[]): string {
  const value = str(row, key);
  if (!allowed.includes(value)) throw invalid();
  return value;
}
import { allPages, request } from '../shared/http';
export { allPages } from '../shared/http';
function unique(rows: AdminRecord[]) {
  if (rows.some((r) => !r.id) || new Set(rows.map((r) => r.id)).size !== rows.length)
    throw invalid();
  return rows;
}
export async function loadAdminData(signal: AbortSignal): Promise<AdminData> {
  const session = await serverSession();
  if (session.user.role !== 'ADMIN')
    throw new ServiceError('FORBIDDEN', '관리자 계정으로 로그인해 주세요.');
  const [items, users, rentals, types] = await Promise.all([
    allPages('/api/v1/items', 'items', signal),
    allPages('/api/v1/admin/users', 'users', signal),
    allPages('/api/v1/admin/rentals', 'rentals', signal),
    request('/api/v1/item-types', 'GET', undefined, signal),
  ]);
  if (!Array.isArray(types.itemTypes)) throw invalid();
  return {
    operator: session.user.name || '관리자',
    operatorId: session.user.userId,
    catalog: {
      items: items.map(parseItem),
      kinds: types.itemTypes.map(parseKind),
      categories: ['공용 물품'],
      stations: [STATION],
    },
    loadedAt: Date.now(),
    items: unique(
      items.map((r) => ({
        id: str(r, 'itemId'),
        name: str(r, 'itemName'),
        detail: str(r, 'itemTypeName'),
        status: status(r, 'status', ['TAG_PENDING', 'AVAILABLE', 'RENTED', 'INSPECTION', 'REPAIR']),
      })),
    ),
    users: unique(
      users.map((r) => ({
        id: str(r, 'userId'),
        name: str(r, 'name', true) || '이름 없음',
        detail: str(r, 'occupation', true),
        status: status(r, 'role', ['USER', 'ADMIN']),
      })),
    ),
    rentals: unique(
      rentals.map((r) => {
        if (typeof r.overdue !== 'boolean') throw invalid();
        return {
          id: str(r, 'rentalId'),
          name: str(r, 'itemName'),
          detail: str(r, 'userName', true) || '이름 없음',
          userId: str(r, 'userId'),
          itemId: str(r, 'itemId'),
          status: status(r, 'rentalStatus', ['RENTED', 'RETURNED', 'OVERDUE']),
          rentedAt: date(r, 'rentedAt'),
          dueAt: date(r, 'dueAt'),
          returnedAt: r.returnedAt === null ? null : date(r, 'returnedAt'),
          overdue: r.overdue,
        };
      }),
    ),
  };
}
