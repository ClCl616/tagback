import type { Item } from '../shared/types';

// Keep legacy labels intact for rental records while displaying separate fields.
export const itemName = (item: Item) => item.name ?? item.label.replace(/\s+\d+$/, '');
export const itemNumber = (item: Item) =>
  item.inventoryNumber ?? item.label.match(/\s+(\d+)$/)?.[1] ?? '';
