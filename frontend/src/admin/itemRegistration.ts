import { ServiceError } from '../shared/api';
import type { Item } from '../shared/types';
import type { ItemDraft } from './adminApi';
import { normalizeUid } from '../shared/nfcUid';
export { normalizeUid } from '../shared/nfcUid';

// Application interface, not an HTTP contract. findCreated is mock-only;
// real creation reconciliation needs a separately agreed contract.
export interface RegistrationGateway {
  save(operationId: string, draft: ItemDraft, original?: Item): Promise<Item>;
  findCreated(operationId: string): Promise<Item | undefined>;
  attachTag(id: string, uid: string): Promise<Item>;
}
const uncertain = (e: unknown) =>
  !(e instanceof ServiceError) || ['NETWORK', 'TIMEOUT', 'UNKNOWN'].includes(e.code);

export class ItemRegistration {
  item?: Item;
  checking: 'create' | undefined;
  // An ambiguous tag write must be retried with exactly the same pair.
  private pendingTag?: { itemId: string; uid: string };
  get retryingTag() {
    return !!this.pendingTag;
  }
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
      if (this.pendingTag) return await this.connect(this.pendingTag.itemId, this.pendingTag.uid);
      if (this.checking) {
        await this.reconcileCreation();
        changed();
      }
      const uid = original?.tag || (draft.tag ? normalizeUid(draft.tag) : '');
      if (!this.item) {
        try {
          this.item = await this.gateway.save(
            this.operationId,
            { ...draft, tag: original?.tag || '' },
            original,
          );
        } catch (e) {
          if (!original && uncertain(e)) {
            this.checking = 'create';
            changed();
            await this.reconcileCreation();
          }
          if (!this.item) throw e;
        }
        changed();
      }
      if (original?.tag || !uid) return this.item;
      return await this.connect(this.item.id, uid);
    } finally {
      this.running = false;
      changed();
    }
  }
  private async connect(itemId: string, uid: string) {
    try {
      const result = await this.gateway.attachTag(itemId, uid);
      if (result.id !== itemId || result.tag !== uid || !result.active)
        throw new ServiceError('UNKNOWN', '태그 연결 응답이 올바르지 않습니다.');
      this.pendingTag = undefined;
      this.item = result;
      return result;
    } catch (e) {
      if (uncertain(e)) {
        this.pendingTag = { itemId, uid };
        throw new ServiceError(
          'UNKNOWN',
          '태그 연결 결과를 확인하지 못했습니다. 다시 시도하면 같은 물품과 UID로 연결을 확인합니다.',
        );
      }
      this.pendingTag = undefined;
      throw e;
    }
  }
  private async reconcileCreation() {
    try {
      const result = await this.gateway.findCreated(this.operationId);
      this.checking = undefined;
      if (result) this.item = result;
      return result;
    } catch {
      throw new ServiceError(
        'CHECK_REQUIRED',
        '물품 생성 결과를 확인하지 못했습니다. 연결을 확인한 뒤 결과 확인을 눌러 주세요. 확인 전에는 물품을 다시 생성하지 않습니다.',
      );
    }
  }
}
