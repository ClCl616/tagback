package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemType;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemTypeRepository;
import com.tagback.domain.repository.NfcTagRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@Transactional
class NfcTagRepositoryIntegrationTest {

    @Autowired
    private ItemTypeRepository itemTypeRepository;

    @Autowired
    private ItemRepository itemRepository;

    @Autowired
    private NfcTagRepository nfcTagRepository;

    @Test
    void findsRegisteredItemByNfcTagUid() {
        String suffix = UUID.randomUUID().toString();
        String itemTypeName = "테스트 품목 " + suffix;
        String itemName = "테스트 물품 " + suffix;
        String tagUid = "TEST-" + suffix;

        ItemType itemType = itemTypeRepository.saveAndFlush(
                new ItemType(itemTypeName, "스모크 테스트용 품목 종류")
        );
        Item item = itemRepository.saveAndFlush(
                new Item(itemName, ItemStatus.TAG_PENDING, itemType)
        );
        nfcTagRepository.saveAndFlush(new NfcTag(tagUid, item));
        item.markAvailable();
        itemRepository.flush();

        NfcTag foundTag = nfcTagRepository.findByUid(tagUid).orElseThrow();

        assertEquals(tagUid, foundTag.getUid());
        assertEquals(itemName, foundTag.getItem().getItemName());
        assertEquals(itemTypeName, foundTag.getItem().getItemType().getName());
        assertEquals(ItemStatus.AVAILABLE, foundTag.getItem().getStatus());
    }
}
