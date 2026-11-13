import { ServiceError } from './serviceError';

export async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal: signal ?? AbortSignal.timeout(15000),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ServiceError(
      'UNKNOWN',
      method === 'GET'
        ? '서버에 연결하지 못했습니다. 다시 조회해 주세요.'
        : '저장 결과를 확인하지 못했습니다. 목록을 다시 확인해 주세요.',
    );
  }
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (response.status === 401)
    throw new ServiceError('AUTH', '로그인이 필요합니다. 다시 로그인해 주세요.');
  if (response.status === 403) throw new ServiceError('FORBIDDEN', '관리자 권한이 필요합니다.');
  if (!response.ok) {
    if (response.status >= 500 || typeof data?.error?.code !== 'string')
      throw new ServiceError(
        'UNKNOWN',
        '처리 결과를 확인하지 못했습니다. 목록을 다시 조회해 주세요.',
      );
    throw new ServiceError(
      data.error.code,
      typeof data.error.message === 'string' ? data.error.message : '요청을 처리하지 못했습니다.',
    );
  }
  if (response.status !== 204 && (!data || typeof data !== 'object'))
    throw new ServiceError('UNKNOWN', '서버 응답을 확인하지 못했습니다.');
  return data;
}
export const positiveId = (id: unknown): id is string =>
  typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
export function assertId(id: string) {
  if (!positiveId(id)) throw new ServiceError('INVALID_INPUT', '물품 ID를 확인해 주세요.');
}
export async function allPages(
  path: string,
  key: string,
  signal: AbortSignal,
): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  let total: number | undefined;
  for (let page = 0; page < 100; page++) {
    const data = await request(
      `${path}${path.includes('?') ? '&' : '?'}page=${page}&size=100`,
      'GET',
      undefined,
      signal,
    );
    if (
      !Array.isArray(data[key]) ||
      data.page !== page ||
      data.size !== 100 ||
      !Number.isSafeInteger(data.totalElements) ||
      data.totalElements < 0 ||
      data.totalPages !== Math.ceil(data.totalElements / 100)
    )
      throw new ServiceError('UNKNOWN', '조회 결과를 확인하지 못했습니다.');
    if (data.totalElements > 10000)
      throw new ServiceError('LIMIT', '조회 범위를 초과했습니다. 서버 검색 기능이 필요합니다.');
    if (total !== undefined && total !== data.totalElements)
      throw new ServiceError('CHANGED', '조회 중 데이터가 변경되었습니다. 다시 조회해 주세요.');
    total = data.totalElements;
    if (
      data[key].length !== Math.min(100, Math.max(0, total! - page * 100)) ||
      data[key].some((r: unknown) => !r || typeof r !== 'object')
    )
      throw new ServiceError('UNKNOWN', '일부 조회 결과를 확인하지 못했습니다.');
    rows.push(...data[key]);
    if (page + 1 >= data.totalPages) return rows;
  }
  throw new ServiceError('LIMIT', '조회 범위를 초과했습니다.');
}
