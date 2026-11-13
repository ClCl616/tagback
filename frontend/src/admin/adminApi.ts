import { request, assertId } from '../shared/http';
import { parseItem, catalogHttp } from '../shared/catalogHttp';
import { normalizeUid } from '../shared/nfcUid';
import { notify, ServiceError } from '../shared/api';
import type { Item, ItemStatus } from '../shared/types';

export type ItemDraft = { label: string; kindId: string };
async function getItem(id: string): Promise<Item> {
  assertId(id);
  const [row, result] = await Promise.all([
    request(`/api/v1/items/${id}`),
    request(`/api/items/${id}/tag`),
  ]);
  const item = parseItem(row);
  if (item.id !== id) throw new ServiceError('UNKNOWN', '물품 응답이 일치하지 않습니다.');
  if (
    result.tag !== null &&
    (!Number.isSafeInteger(result.tag?.itemId) ||
      String(result.tag.itemId) !== id ||
      typeof result.tag.uid !== 'string' ||
      result.tag.status !== 'ACTIVE')
  )
    throw new ServiceError('UNKNOWN', '태그 정보를 확인하지 못했습니다.');
  return { ...item, tagKnown: true, tag: result.tag?.uid || '', active: result.tag !== null };
}
export const adminApi = {
  catalog: () => catalogHttp(true),
  getItem,
  async save(_operationId: string, draft: ItemDraft, original?: Item): Promise<Item> {
    const itemName = draft.label.trim();
    if (!itemName || itemName.length > 100)
      throw new ServiceError('INVALID_INPUT', '물품명은 1~100자로 입력해 주세요.');
    assertId(draft.kindId);
    if (original) assertId(original.id);
    const result = await request(
      original ? `/api/v1/items/${original.id}` : '/api/v1/items',
      original ? 'PATCH' : 'POST',
      { itemName, itemTypeId: draft.kindId },
    );
    const item = parseItem(result);
    notify();
    return {
      ...item,
      tagKnown: original?.tagKnown ?? true,
      tag: original?.tag ?? '',
      active: original?.active ?? false,
    };
  },
  async attachTag(id: string, rawUid: string): Promise<Item> {
    assertId(id);
    const uid = normalizeUid(rawUid);
    const result = await request(`/api/items/${id}/tag`, 'POST', { uid });
    if (
      !Number.isSafeInteger(result.tag?.itemId) ||
      String(result.tag.itemId) !== id ||
      result.tag.uid !== uid ||
      result.tag.status !== 'ACTIVE'
    )
      throw new ServiceError(
        'UNKNOWN',
        '태그 연결 결과를 확인하지 못했습니다. 같은 물품과 UID로 다시 시도해 주세요.',
      );
    const item = await getItem(id);
    notify();
    return item;
  },
  async changeStatus(id: string, status: ItemStatus, reason: string): Promise<Item> {
    assertId(id);
    if (!['available', 'inspection', 'repair'].includes(status))
      throw new ServiceError('INVALID_INPUT', '변경할 상태를 확인해 주세요.');
    const result = parseItem(
      await request(`/api/v1/items/${id}/status`, 'PATCH', {
        status: status.toUpperCase(),
        reason: reason.trim(),
      }),
    );
    notify();
    return result;
  },
  async remove(item: Item) {
    assertId(item.id);
    await request(`/api/v1/items/${item.id}`, 'DELETE');
    notify();
  },
};
