import { afterEach, expect, it, vi } from 'vitest';
import { allPages } from '../src/admin/adminQueries';
afterEach(() => vi.unstubAllGlobals());
const response = (page: number, total: number, rows: unknown[]) =>
  new Response(
    JSON.stringify({
      users: rows,
      page,
      size: 100,
      totalElements: total,
      totalPages: Math.ceil(total / 100),
    }),
  );
it('rejects changing pagination rather than returning misleading global totals', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        response(
          0,
          101,
          Array.from({ length: 100 }, () => ({})),
        ),
      )
      .mockResolvedValueOnce(response(1, 102, [{}, {}])),
  );
  await expect(allPages('/users', 'users', new AbortController().signal)).rejects.toThrow('변경');
});
it('rejects oversized datasets and accepts genuinely empty results', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(0, 10001, []))
    .mockResolvedValueOnce(response(0, 0, []));
  vi.stubGlobal('fetch', fetch);
  await expect(allPages('/users', 'users', new AbortController().signal)).rejects.toThrow('범위');
  await expect(allPages('/users', 'users', new AbortController().signal)).resolves.toEqual([]);
});
