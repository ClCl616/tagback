import { fail, notify, transaction } from '../shared/api';
import type { ItemStatus } from '../shared/types';

export type TagMode = 'mixed' | 'linked' | 'unlinked';
export const MAX_BATCH = 500;
export const MAX_ITEMS = 2000;
function devOnly() {
  if (!import.meta.env.DEV) fail('FORBIDDEN', '개발 환경에서만 사용할 수 있습니다.');
}
export async function generateMockItems(count: number, tagMode: TagMode) {
  devOnly();
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH)
    fail('COUNT', `생성 수량은 1~${MAX_BATCH} 사이의 정수로 입력해 주세요.`);
  if (!['mixed', 'linked', 'unlinked'].includes(tagMode))
    fail('MODE', '태그 설정을 확인해 주세요.');
  await transaction((db) => {
    if (db.items.length + count > MAX_ITEMS)
      fail(
        'LIMIT',
        `삭제된 물품을 포함해 최대 ${MAX_ITEMS}개까지 보관할 수 있습니다. 전체 삭제 후 다시 생성해 주세요.`,
      );
    if (!db.kinds.length || !db.stations.length)
      fail('EMPTY', '물품 분류와 대여소가 필요합니다. 시연 데이터를 초기화해 주세요.');
    const tags = new Set(db.items.map((i) => i.tag));
    const numbers = new Set(db.items.map((i) => i.inventoryNumber));
    let serial = 1;
    for (let n = 0; n < count; n++) {
      const kind = db.kinds[Math.floor(Math.random() * db.kinds.length)];
      const station = db.stations[Math.floor(Math.random() * db.stations.length)];
      const linked = tagMode === 'linked' || (tagMode === 'mixed' && Math.random() < 0.7);
      let tag = '';
      if (linked) {
        do {
          tag =
            '04' +
            Array.from(crypto.getRandomValues(new Uint8Array(6)), (v) =>
              v.toString(16).padStart(2, '0'),
            )
              .join('')
              .toUpperCase();
        } while (tags.has(tag));
        tags.add(tag);
      }
      let inventoryNumber: string;
      do {
        inventoryNumber = 'M' + String(serial++).padStart(5, '0');
      } while (numbers.has(inventoryNumber));
      numbers.add(inventoryNumber);
      const statuses: ItemStatus[] = linked
        ? ['available', 'inspection', 'repair']
        : ['inspection', 'repair'];
      db.items.push({
        id: crypto.randomUUID(),
        label: `${kind.name} ${inventoryNumber}`,
        name: kind.name,
        inventoryNumber,
        kindId: kind.id,
        stationId: station.id,
        tag,
        active: linked,
        status: statuses[Math.floor(Math.random() * statuses.length)],
      });
    }
  });
  notify();
  return count;
}
export async function clearMockItems() {
  devOnly();
  await transaction((db) => {
    db.items = [];
    db.rentals = [];
    db.operations = {};
    db.codes = [];
    db.grants = [];
  });
  notify();
}
