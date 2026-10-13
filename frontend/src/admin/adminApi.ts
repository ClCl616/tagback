import { before, fail, notify, transaction } from '../shared/api';
import { normalizeUid } from './itemRegistration';
import type { Item } from '../shared/types';

export type ItemDraft = Pick<
  Item,
  'label' | 'kindId' | 'stationId' | 'tag' | 'status' | 'image' | 'inventoryNumber'
> & { removeDefaultImage?: boolean; category?: string };
// Development-only mock adapter. Replace with server-enforced ADMIN authorization.
export const adminApi = {
  // Mock-only state queries. These are not guessed server endpoints.
  async findCreated(operationId: string) {
    return this.getItem(operationId);
  },
  async getItem(id: string) {
    if (!import.meta.env.DEV) return fail('FORBIDDEN', '관리자 연결이 준비되지 않았습니다.');
    await before();
    return transaction((db) => db.items.find((i) => i.id === id && !i.deleted));
  },
  async attachTag(id: string, value: string): Promise<Item> {
    if (!import.meta.env.DEV) return fail('FORBIDDEN', '관리자 연결이 준비되지 않았습니다.');
    const uid = normalizeUid(value);
    const fault = await before(true, 'save');
    if (fault === 'conflict')
      return fail('ITEM_ALREADY_TAGGED', '이 물품의 태그 정보를 다시 확인해 주세요.');
    const item = await transaction((db) => {
      const item = db.items.find((i) => i.id === id && !i.deleted);
      if (!item) return fail('ITEM_NOT_FOUND', '물품을 찾을 수 없습니다. 목록을 확인해 주세요.');
      if (item.tag) {
        if (item.tag === uid) return item;
        return fail('ITEM_ALREADY_TAGGED', '이 물품에는 다른 태그가 연결되어 있습니다.');
      }
      if (db.items.some((i) => i.tag === uid))
        return fail('TAG_ALREADY_REGISTERED', '이미 등록된 태그입니다. 다른 태그를 인식해 주세요.');
      item.tag = uid;
      item.active = true;
      return item;
    });
    notify();
    if (fault === 'unknown') return fail('UNKNOWN', '태그 연결 결과를 확인해야 합니다.');
    return item;
  },
  async remove(item: Item) {
    if (!import.meta.env.DEV) return fail('FORBIDDEN', '관리자 연결이 준비되지 않았습니다.');
    const fault = await before(true, 'save');
    if (fault === 'unknown' || fault === 'conflict')
      return fail('RETRY', '삭제하지 못했습니다. 다시 시도해 주세요.');
    await transaction((db) => {
      const current = db.items.find((i) => i.id === item.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(item))
        return fail('CONFLICT', '물품이 변경되었습니다. 목록을 새로고침해 주세요.');
      if (
        current.status === 'rented' ||
        db.rentals.some((r) => r.itemId === item.id && !r.returnedAt)
      )
        return fail('RENTED', '대여 중인 물품은 반납 후 삭제할 수 있습니다.');
      current.deleted = true;
      current.active = false;
    });
    notify();
  },
  async removeCategory(name: string) {
    if (!import.meta.env.DEV) return fail('FORBIDDEN', '관리자 연결이 준비되지 않았습니다.');
    const fault = await before(true, 'save');
    if (fault === 'unknown' || fault === 'conflict')
      return fail('RETRY', '삭제하지 못했습니다. 다시 시도해 주세요.');
    await transaction((db) => {
      if (db.kinds.some((k) => k.category === name))
        return fail('IN_USE', '물품 또는 이용 이력이 있는 카테고리는 삭제할 수 없습니다.');
      db.categories = (db.categories || []).filter((c) => c !== name);
    });
    notify();
  },
  async addCategory(value: string): Promise<string> {
    if (!import.meta.env.DEV) return fail('FORBIDDEN', '관리자 연결이 준비되지 않았습니다.');
    const fault = await before(true, 'save');
    if (fault === 'unknown' || fault === 'conflict')
      return fail('RETRY', '카테고리를 저장하지 못했습니다. 다시 시도해 주세요.');
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 30) return fail('CATEGORY', '카테고리명은 1~30자로 입력해 주세요.');
    const result = await transaction((db) => {
      const categories = [
        ...new Set([...(db.categories || []), ...db.kinds.map((k) => k.category)]),
      ];
      const existing = categories.find((c) => c.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (existing) return existing;
      db.categories = [...categories, name];
      return name;
    });
    notify();
    return result;
  },
  async save(operationId: string, draft: ItemDraft, original?: Item): Promise<Item> {
    if (!import.meta.env.DEV) return fail('FORBIDDEN', '관리자 연결이 준비되지 않았습니다.');
    const fault = await before(true, 'save');
    if ((original && fault === 'unknown') || fault === 'conflict')
      return fail('RETRY', '저장하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.');
    const result = await transaction((db) => {
      const name = draft.label.trim();
      const inventoryNumber = draft.inventoryNumber?.trim() || '';
      if (!/^[A-Za-z0-9-]{1,20}$/.test(inventoryNumber))
        return fail('NUMBER', '관리번호는 영문, 숫자, 하이픈 1~20자로 입력해 주세요.');
      const label = name + ' ' + inventoryNumber;
      const tag = draft.tag.trim().toUpperCase();
      if (
        !draft.image &&
        (draft.removeDefaultImage ||
          !original ||
          original.image ||
          !['calc', 'umbrella', 'battery', 'cable'].includes(original.kindId))
      )
        return fail('IMAGE_REQUIRED', '물품 이미지를 등록해 주세요.');
      if (
        draft.image &&
        (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(draft.image) ||
          draft.image.length > 700_000)
      )
        return fail(
          'IMAGE',
          '이미지를 다시 선택해 주세요. 저장 가능한 이미지 크기를 초과했습니다.',
        );
      if (!name || name.length > 60) return fail('LABEL', '물품명은 1~60자로 입력해 주세요.');
      const categories = [...(db.categories || []), ...db.kinds.map((k) => k.category)];
      if (!draft.category || !categories.includes(draft.category))
        return fail('CATEGORY', '카테고리를 선택해 주세요.');
      let kind = db.kinds.find((k) => k.id === draft.kindId);
      if (draft.kindId && (!kind || kind.category !== draft.category))
        return fail('KIND', '선택한 카테고리의 물품명을 선택해 주세요.');
      if (!kind) {
        kind = db.kinds.find((k) => k.category === draft.category && k.name === name);
        if (!kind) {
          kind = {
            id: 'kind-' + operationId,
            name,
            category: draft.category,
            description: '',
            art: 'generic',
          };
          db.kinds.push(kind);
        }
      }
      if (!db.stations.some((s) => s.id === draft.stationId))
        return fail('STATION', '대여소를 선택해 주세요.');
      if (!original && tag) return fail('TAG', '물품 생성 후 태그를 연결해 주세요.');
      if (!['available', 'inspection', 'repair', 'rented'].includes(draft.status))
        return fail('STATUS', '물품 상태를 확인해 주세요.');
      const existing = original ? db.items.find((i) => i.id === original.id) : undefined;
      if (original && (!existing || JSON.stringify(existing) !== JSON.stringify(original)))
        return fail(
          'CONFLICT',
          '다른 화면에서 물품이 변경되었습니다. 목록을 새로고침한 후 다시 수정해 주세요.',
        );
      if (existing && (tag !== existing.tag || draft.stationId !== existing.stationId))
        return fail('FIXED', '등록된 태그와 대여소는 이 화면에서 변경할 수 없습니다.');
      if (draft.status === 'available' && !existing?.tag)
        return fail('TAG_REQUIRED', '태그 연결 후 대여 가능으로 변경할 수 있습니다.');
      const rented = existing && db.rentals.some((r) => r.itemId === existing.id && !r.returnedAt);
      if (rented && (draft.status !== existing!.status || kind.id !== existing!.kindId))
        return fail(
          'RENTED',
          '대여 중인 물품은 카테고리나 상태를 변경할 수 없습니다. 반납 후 수정해 주세요.',
        );
      if (draft.status === 'rented' && (!existing || existing.status !== 'rented'))
        return fail('RENTED', '대여 중 상태는 키오스크 대여 처리로만 변경됩니다.');
      if (
        db.items.some(
          (i) =>
            tag && i.id !== existing?.id && i.id !== operationId && i.tag.toUpperCase() === tag,
        )
      )
        return fail('DUPLICATE', '이미 등록된 태그 ID입니다. 다른 태그를 접촉해 주세요.');
      if (!original) {
        const retry = db.items.find((i) => i.id === operationId);
        if (retry) return retry;
      }
      const item: Item = {
        id: existing?.id || operationId,
        active: existing?.active ?? false,
        kindId: kind.id,
        stationId: draft.stationId,
        status: draft.status,
        image: draft.image || '',
        name,
        inventoryNumber,
        label,
        tag,
      };
      if (existing) Object.assign(existing, item);
      else db.items.push(item);
      return item;
    }).catch((error) => {
      if (error instanceof DOMException && error.name === 'QuotaExceededError')
        return fail(
          'STORAGE',
          '브라우저 저장 공간이 부족합니다. 더 작은 이미지를 선택하거나 기존 이미지를 삭제한 뒤 다시 저장해 주세요.',
        );
      throw error;
    });
    notify();
    if (!original && fault === 'unknown')
      return fail('UNKNOWN', '물품 생성 결과를 확인해야 합니다.');
    return result;
  },
};
