import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ItemRegistration,
  normalizeUid,
  type RegistrationGateway,
} from '../src/admin/itemRegistration';
import { ServiceError } from '../src/shared/api';
import type { ItemDraft } from '../src/admin/adminApi';
import type { Item } from '../src/shared/types';
import { postItemTag } from '../src/admin/tagTransport';
const draft: ItemDraft = {
  label: '계산기',
  kindId: 'calc',
  stationId: 'engineering',
  tag: '04A23B1C',
  status: 'inspection',
  inventoryNumber: '009',
};
const item: Item = {
  id: 'created-id',
  label: '계산기 009',
  kindId: 'calc',
  stationId: 'engineering',
  tag: '',
  active: false,
  status: 'inspection',
};
function setup() {
  let stored: Item | undefined;
  const gateway = {
    save: vi.fn(async () => (stored = { ...item })),
    findCreated: vi.fn(async () => stored),
    getItem: vi.fn(async () => stored),
    attachTag: vi.fn(
      async (id: string, uid: string) => (stored = { ...stored!, id, tag: uid, active: true }),
    ),
  } satisfies RegistrationGateway;
  return {
    gateway,
    flow: new ItemRegistration(gateway, 'operation'),
    change: vi.fn(),
    set: (i: Item) => {
      stored = i;
    },
  };
}
const error = (code: string) => new ServiceError(code, code);
afterEach(() => vi.unstubAllGlobals());
describe('두 단계 물품 등록', () => {
  it('태그 없이 물품만 등록하고 연결 요청은 하지 않는다', async () => {
    const { flow, gateway, change } = setup();
    const result = await flow.submit({ ...draft, tag: '' }, undefined, change);
    expect(result?.id).toBe(item.id);
    expect(gateway.save).toHaveBeenCalledTimes(1);
    expect(gateway.attachTag).not.toHaveBeenCalled();
  });

  it('생성 응답 ID로 태그를 연결하고 두 단계 후 완료한다', async () => {
    const { flow, gateway, change } = setup();
    const result = await flow.submit(draft, undefined, change);
    expect(gateway.save).toHaveBeenCalledWith('operation', { ...draft, tag: '' }, undefined);
    expect(gateway.attachTag).toHaveBeenCalledWith('created-id', draft.tag);
    expect(result?.tag).toBe(draft.tag);
  });
  it('생성 실패는 생성부터 재시도한다', async () => {
    const { flow, gateway, change } = setup();
    gateway.save.mockRejectedValueOnce(error('SAVE'));
    await expect(flow.submit(draft, undefined, change)).rejects.toThrow('SAVE');
    expect(gateway.attachTag).not.toHaveBeenCalled();
    await flow.submit(draft, undefined, change);
    expect(gateway.save).toHaveBeenCalledTimes(2);
  });
  it('태그 실패 후 입력을 바꿔도 물품은 재생성하지 않는다', async () => {
    const { flow, gateway, change } = setup();
    gateway.attachTag.mockRejectedValueOnce(error('TAG_ALREADY_REGISTERED'));
    await expect(flow.submit(draft, undefined, change)).rejects.toThrow('TAG_ALREADY_REGISTERED');
    expect(flow.item?.id).toBe(item.id);
    await flow.submit({ ...draft, tag: '04000099' }, undefined, change);
    expect(gateway.save).toHaveBeenCalledTimes(1);
    expect(gateway.attachTag).toHaveBeenLastCalledWith(item.id, '04000099');
  });
  it('기존 미등록 물품은 같은 ID에 연결한다', async () => {
    const { flow, gateway, change, set } = setup();
    set(item);
    await flow.submit(draft, item, change);
    expect(gateway.save).toHaveBeenCalledWith('operation', { ...draft, tag: '' }, item);
    expect(gateway.attachTag).toHaveBeenCalledWith(item.id, draft.tag);
  });
  it('동시 제출을 무시한다', async () => {
    const { flow, gateway, change } = setup();
    await Promise.all([
      flow.submit(draft, undefined, change),
      flow.submit(draft, undefined, change),
    ]);
    expect(gateway.save).toHaveBeenCalledTimes(1);
    expect(gateway.attachTag).toHaveBeenCalledTimes(1);
  });
  it('생성 응답 유실은 조회된 생성 결과를 이어서 사용한다', async () => {
    const { flow, gateway, change, set } = setup();
    gateway.save.mockImplementationOnce(async () => {
      set(item);
      throw error('UNKNOWN');
    });
    await flow.submit(draft, undefined, change);
    expect(gateway.findCreated).toHaveBeenCalledTimes(1);
    expect(gateway.save).toHaveBeenCalledTimes(1);
  });
  it('태그 응답 유실은 조회로 완료를 확인한다', async () => {
    const { flow, gateway, change, set } = setup();
    gateway.attachTag.mockImplementationOnce(async () => {
      set({ ...item, tag: draft.tag });
      throw error('UNKNOWN');
    });
    expect((await flow.submit(draft, undefined, change))?.tag).toBe(draft.tag);
    expect(gateway.attachTag).toHaveBeenCalledTimes(1);
  });
  it('생성 결과 조회도 실패하면 재생성을 막고 다음 제출에 조회부터 한다', async () => {
    const { flow, gateway, change, set } = setup();
    gateway.save.mockImplementationOnce(async () => {
      set(item);
      throw error('TIMEOUT');
    });
    gateway.findCreated.mockRejectedValueOnce(error('NETWORK'));
    await expect(flow.submit(draft, undefined, change)).rejects.toThrow('처리 결과');
    expect(flow.checking).toBe('create');
    await flow.submit(draft, undefined, change);
    expect(gateway.save).toHaveBeenCalledTimes(1);
  });
  it('태그 결과 조회 실패 시에도 중복 연결하지 않는다', async () => {
    const { flow, gateway, change, set } = setup();
    gateway.attachTag.mockImplementationOnce(async () => {
      set({ ...item, tag: draft.tag });
      gateway.getItem.mockRejectedValueOnce(error('NETWORK'));
      throw error('UNKNOWN');
    });
    await expect(flow.submit(draft, undefined, change)).rejects.toThrow('처리 결과');
    expect(flow.checking).toBe('tag');
    await flow.submit(draft, undefined, change);
    expect(gateway.attachTag).toHaveBeenCalledTimes(1);
  });
  it('다른 관리자가 같은 물품에 다른 태그를 연결하면 덮어쓰지 않는다', async () => {
    const { flow, gateway, change, set } = setup();
    gateway.attachTag.mockImplementationOnce(async () => {
      set({ ...item, tag: '04000099' });
      throw error('ITEM_ALREADY_TAGGED');
    });
    await expect(flow.submit(draft, undefined, change)).rejects.toThrow('다른 태그');
    expect(gateway.attachTag).toHaveBeenCalledTimes(1);
  });
  it('연결되지 않았음이 확인된 통신 실패는 태그만 재시도한다', async () => {
    const { flow, gateway, change } = setup();
    gateway.attachTag.mockRejectedValueOnce(error('NETWORK'));
    await expect(flow.submit(draft, undefined, change)).rejects.toThrow('NETWORK');
    await flow.submit(draft, undefined, change);
    expect(gateway.save).toHaveBeenCalledTimes(1);
    expect(gateway.attachTag).toHaveBeenCalledTimes(2);
  });
});
describe('확인된 NFC API 계약', () => {
  it('UID 정규화 및 길이를 검사한다', () => {
    expect(normalizeUid('04:a2-3b 1c')).toBe('04A23B1C');
    expect(() => normalizeUid('CALC-1')).toThrow();
  });
  it('POST 경로, uid 본문, 세션 및 201 응답을 사용한다', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag: {
              tagId: 1,
              itemId: 12,
              uid: draft.tag,
              status: 'ACTIVE',
              createdAt: '2026-10-07',
            },
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    await postItemTag(12, draft.tag);
    expect(fetch).toHaveBeenCalledWith(
      '/api/items/12/tag',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ uid: draft.tag }),
      }),
    );
  });
  it.each(['TAG_ALREADY_REGISTERED', 'ITEM_ALREADY_TAGGED'])('409 %s를 보존한다', async (code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code } }), { status: 409 })),
    );
    await expect(postItemTag(12, draft.tag)).rejects.toMatchObject({ code });
  });
  it('성공 응답이 깨지면 완료로 판단하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 201 })),
    );
    await expect(postItemTag(12, draft.tag)).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});
