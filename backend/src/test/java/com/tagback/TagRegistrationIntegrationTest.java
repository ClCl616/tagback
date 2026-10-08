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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

@SpringBootTest(properties = {
        "spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
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
    private final List<Long> itemIds = new ArrayList<>();
    private final List<Long> typeIds = new ArrayList<>();

    @AfterEach
    void cleanup() {
        for (Long itemId : itemIds) {
            jdbcTemplate.update("UPDATE items SET status = 'TAG_PENDING' WHERE item_id = ?", itemId);
            jdbcTemplate.update("DELETE FROM nfc_tags WHERE item_id = ?", itemId);
            jdbcTemplate.update("DELETE FROM items WHERE item_id = ?", itemId);
        }
        for (Long typeId : typeIds) {
            jdbcTemplate.update("DELETE FROM item_types WHERE item_type_id = ?", typeId);
        }
    }

    @Test
    void persistsNormalizedUidAndConnectsItToTheItem() {
        Item item = testItem();
        String uid = randomUid();

        TagRegistrationService.RegistrationResult result = registrationService.register(item.getId(), uid.toLowerCase());
        TagRegistrationResponse response = result.response();
        NfcTag saved = tagRepository.findByUid(uid).orElseThrow();

        assertEquals(true, result.created());
        assertEquals(item.getId(), response.tag().itemId());
        assertEquals(uid, response.tag().uid());
        assertEquals(uid, saved.getUid());
        assertEquals(item.getId(), saved.getItem().getId());
        assertEquals("ACTIVE", response.tag().status());
        assertNotNull(response.tag().createdAt());
        assertEquals(ItemStatus.AVAILABLE, itemRepository.findById(item.getId()).orElseThrow().getStatus());
    }

    @Test
    void retryingSameItemAndUidReturnsExistingTagWithoutAnotherRow() {
        Item item = testItem();
        String uid = randomUid();

        TagRegistrationService.RegistrationResult created = registrationService.register(item.getId(), uid);
        TagRegistrationService.RegistrationResult retried = registrationService.register(
                item.getId(), uid.toLowerCase());

        assertEquals(true, created.created());
        assertEquals(false, retried.created());
        assertEquals(created.response().tag().tagId(), retried.response().tag().tagId());
        assertEquals(created.response().tag().createdAt(), retried.response().tag().createdAt());
        assertEquals(1L, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM nfc_tags WHERE item_id = ?", Long.class, item.getId()));
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
        typeIds.add(type.getId());
        Item item = itemRepository.saveAndFlush(new Item("테스트 물품 " + suffix, ItemStatus.TAG_PENDING, type));
        itemIds.add(item.getId());
        return item;
    }

    private static String randomUid() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 14).toUpperCase();
    }
}
