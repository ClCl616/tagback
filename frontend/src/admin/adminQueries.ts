import { HTTP_AUTH } from '../shared/authMode';
import { before, transaction } from '../shared/api';
import { serverSession } from '../shared/httpAuth';

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
// Full collection required: never present a single server page as global search/statistics.
export async function allPages(
  path: string,
  key: string,
  signal: AbortSignal,
): Promise<RecordValue[]> {
  const result: RecordValue[] = [];
  let total: number | undefined;
  for (let page = 0; page < 100; page++) {
    const response = await fetch(`${path}?page=${page}&size=100`, {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (response.status === 401) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (response.status === 403) throw new Error('관리자만 조회할 수 있습니다.');
    if (!response.ok) throw new Error('서버에 연결하지 못했습니다. 다시 시도해 주세요.');
    const data = await response.json();
    if (
      !data ||
      !Array.isArray(data[key]) ||
      data.page !== page ||
      data.size !== 100 ||
      !Number.isSafeInteger(data.totalElements) ||
      data.totalElements < 0 ||
      data.totalPages !== Math.ceil(data.totalElements / 100) ||
      data[key].some((r: unknown) => !r || typeof r !== 'object' || Array.isArray(r))
    )
      throw invalid();
    if (data.totalElements > 10000)
      throw new Error('조회 범위를 초과했습니다. 서버 검색 기능 연결이 필요합니다.');
    if (total !== undefined && total !== data.totalElements)
      throw new Error('조회 중 데이터가 변경되었습니다. 다시 시도해 주세요.');
    total = data.totalElements;
    if (data[key].length !== Math.min(100, Math.max(0, total! - page * 100))) throw invalid();
    result.push(...data[key]);
    if (page + 1 >= data.totalPages) return result;
  }
  throw invalid();
}
function unique(rows: AdminRecord[]) {
  if (rows.some((r) => !r.id) || new Set(rows.map((r) => r.id)).size !== rows.length)
    throw invalid();
  return rows;
}
export async function loadAdminData(signal: AbortSignal): Promise<AdminData> {
  if (!HTTP_AUTH) {
    if (!import.meta.env.DEV) throw new Error('관리자 서버 연결이 필요합니다.');
    await before();
    return transaction((db) => {
      const now = Date.now();
      return {
        operator: '개발용 관리자',
        loadedAt: now,
        items: db.items
          .filter((i) => !i.deleted)
          .map((i) => ({
            id: i.id,
            name: i.name || i.label,
            detail: db.kinds.find((k) => k.id === i.kindId)?.name || '',
            status: i.status.toUpperCase(),
          })),
        users: db.users.map((u) => ({
          id: u.id,
          name: u.name || '이름 없음',
          detail: u.occupation || '',
          status: 'USER',
        })),
        rentals: db.rentals.map((r) => ({
          id: r.id,
          name: db.items.find((i) => i.id === r.itemId)?.label || r.itemId,
          detail: db.users.find((u) => u.id === r.userId)?.name || r.userId,
          userId: r.userId,
          itemId: r.itemId,
          status: r.returnedAt ? 'RETURNED' : now > r.dueAt ? 'OVERDUE' : 'RENTED',
          rentedAt: new Date(r.rentedAt).toISOString(),
          dueAt: new Date(r.dueAt).toISOString(),
          returnedAt: r.returnedAt ? new Date(r.returnedAt).toISOString() : null,
          overdue: (r.returnedAt ?? now) > r.dueAt,
        })),
      };
    });
  }
  const session = await serverSession();
  if (session.user.role !== 'ADMIN') throw new Error('관리자 계정으로 로그인해 주세요.');
  const [items, users, rentals] = await Promise.all([
    allPages('/api/v1/items', 'items', signal),
    allPages('/api/v1/admin/users', 'users', signal),
    allPages('/api/v1/admin/rentals', 'rentals', signal),
  ]);
  return {
    operator: session.user.name || '관리자',
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
