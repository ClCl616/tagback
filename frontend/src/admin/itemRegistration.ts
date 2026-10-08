import { ServiceError } from '../shared/api';
import type { Item } from '../shared/types';
import type { ItemDraft } from './adminApi';

import { normalizeUid } from '../shared/nfcUid';
export { normalizeUid } from '../shared/nfcUid';

// Application interface, NOT an HTTP contract. Only the mock implements lookup
// until create response, reconciliation and tag-query contracts are agreed.
export interface RegistrationGateway {
  save(operationId: string, draft: ItemDraft, original?: Item): Promise<Item>;
  findCreated(operationId: string): Promise<Item | undefined>;
  getItem(id: string): Promise<Item | undefined>;
  attachTag(id: string, uid: string): Promise<Item>;
}
const uncertain = (e: unknown) =>
  !(e instanceof ServiceError) || ['NETWORK', 'TIMEOUT', 'UNKNOWN'].includes(e.code);

export class ItemRegistration {
  item?: Item;
  checking: 'create' | 'tag' | undefined;
  private uid = '';
  private running = false;
  constructor(
    private gateway: RegistrationGateway,
    private operationId: string,
  ) {}

  async submit(
    draft: ItemDraft,
    original: Item | undefined,
    changed: () => void,
  ): Promise<Item | undefined> {
    if (this.running) return;
    this.running = true;
    try {
      if (this.checking) {
        const stage = this.checking;
        const result = await this.reconcile();
        changed();
        if (stage === 'tag' && result?.tag) return this.confirm(result);
      }
      const uid = original?.tag || (draft.tag ? normalizeUid(draft.tag) : '');

      if (!this.item) {
        try {
          // Tag attachment is a separate operation; never include a new UID in creation.
          this.item = await this.gateway.save(
            this.operationId,
            { ...draft, tag: original?.tag || '' },
            original,
          );
        } catch (e) {
          if (!original && uncertain(e)) {
            this.checking = 'create';
            changed();
            await this.reconcile();
          }
          if (!this.item) throw e;
        }
        changed();
      }
      if (original?.tag || !uid) return this.item;
      this.uid = uid;
      // Re-read on every attempt: another administrator may have attached a tag.
      this.checking = 'tag';
      const current = await this.reconcile();
      changed();
      if (!current)
        throw new ServiceError('ITEM_NOT_FOUND', '물품을 찾을 수 없습니다. 목록을 확인해 주세요.');
      if (current.tag) return this.confirm(current);
      try {
        const result = await this.gateway.attachTag(current.id, uid);
        return this.confirm(result);
      } catch (e) {
        if (
          uncertain(e) ||
          (e instanceof ServiceError &&
            ['TAG_ALREADY_REGISTERED', 'ITEM_ALREADY_TAGGED'].includes(e.code))
        ) {
          this.checking = 'tag';
          changed();
          const result = await this.reconcile();
          if (result?.tag) return this.confirm(result);
        }
        throw e;
      }
    } finally {
      this.running = false;
      changed();
    }
  }
  private confirm(item: Item) {
    if (item.tag !== this.uid)
      throw new ServiceError(
        'ITEM_ALREADY_TAGGED',
        '이 물품에는 다른 태그가 연결되어 있습니다. 창을 닫고 상세 정보를 확인해 주세요.',
      );
    this.item = item;
    return item;
  }
  private async reconcile() {
    try {
      const result =
        this.checking === 'create'
          ? await this.gateway.findCreated(this.operationId)
          : await this.gateway.getItem(this.item!.id);
      this.checking = undefined;
      if (result) this.item = result;
      return result;
    } catch {
      throw new ServiceError(
        'CHECK_REQUIRED',
        '처리 결과를 확인하지 못했습니다. 연결을 확인한 뒤 결과 확인을 눌러 주세요. 확인 전에는 다시 등록하지 않습니다.',
      );
    }
  }
}
