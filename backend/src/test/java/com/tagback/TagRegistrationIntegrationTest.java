package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemType;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemTypeRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagRegistrationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "TAGBACK_DB_PASSWORD", matches = ".+")
class TagRegistrationIntegrationTest {
    @Autowired
    private ItemTypeRepository itemTypeRepository;
    @Autowired
    private ItemRepository itemRepository;
    @Autowired
    private NfcTagRepository tagRepository;
    @Autowired
    private TagRegistrationService registrationService;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void persistsNormalizedUidAndConnectsItToTheItem() {
        Item item = testItem();
        String uid = randomUid();

        TagRegistrationResponse response = registrationService.register(item.getId(), uid.toLowerCase());
        NfcTag saved = tagRepository.findByUid(uid).orElseThrow();

        assertEquals(item.getId(), response.tag().itemId());
        assertEquals(uid, response.tag().uid());
        assertEquals(uid, saved.getUid());
        assertEquals(item.getId(), saved.getItem().getId());
        assertEquals("ACTIVE", response.tag().status());
        assertNotNull(response.tag().createdAt());
    }

    @Test
    void preventsDuplicateUidAndSecondTagForOneItem() {
        Item first = testItem();
        Item second = testItem();
        String firstUid = randomUid();
        registrationService.register(first.getId(), firstUid);

        TagRegistrationException reusedUid = assertThrows(TagRegistrationException.class,
                () -> registrationService.register(second.getId(), firstUid));
        assertEquals("TAG_ALREADY_REGISTERED", reusedUid.code());

        TagRegistrationException secondTag = assertThrows(TagRegistrationException.class,
                () -> registrationService.register(first.getId(), randomUid()));
        assertEquals("ITEM_ALREADY_TAGGED", secondTag.code());
        assertEquals(first.getId(), tagRepository.findByUid(firstUid).orElseThrow().getItem().getId());
    }

    @Test
    void databaseRejectsDuplicateUidEvenWhenInsertedDirectly() {
        Item first = testItem();
        Item second = testItem();
        String uid = randomUid();
        tagRepository.saveAndFlush(new NfcTag(uid, first));

        assertThrows(DataIntegrityViolationException.class, () -> jdbcTemplate.update(
                "INSERT INTO nfc_tags (item_id, tag_uid) VALUES (?, ?)", second.getId(), uid));
    }

    @Test
    void databaseRejectsSecondTagForTheSameItem() {
        Item item = testItem();
        tagRepository.saveAndFlush(new NfcTag(randomUid(), item));

        assertThrows(DataIntegrityViolationException.class, () -> jdbcTemplate.update(
                "INSERT INTO nfc_tags (item_id, tag_uid) VALUES (?, ?)", item.getId(), randomUid()));
    }

    private Item testItem() {
        String suffix = UUID.randomUUID().toString();
        ItemType type = itemTypeRepository.saveAndFlush(new ItemType("NFC 테스트 " + suffix, null));
        return itemRepository.saveAndFlush(new Item("테스트 물품 " + suffix, ItemStatus.AVAILABLE, type));
    }

    private static String randomUid() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 14).toUpperCase();
    }
}
