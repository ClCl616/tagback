package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemType;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemTypeRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.dto.tag.TagLookupResponse;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagLifecycleService;
import com.tagback.service.TagRegistrationService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "TAGBACK_DB_PASSWORD", matches = ".+")
class TagLifecycleIntegrationTest {
    @Autowired ItemTypeRepository types;
    @Autowired ItemRepository items;
    @Autowired NfcTagRepository tags;
    @Autowired TagRegistrationService registration;
    @Autowired TagLifecycleService lifecycle;
    @Autowired JdbcTemplate jdbc;

    private final List<Long> itemIds = new ArrayList<>();
    private final List<Long> typeIds = new ArrayList<>();

    @AfterEach
    void cleanup() {
        for (Long id : itemIds) {
            jdbc.update("DELETE FROM nfc_tags WHERE item_id = ?", id);
            jdbc.update("DELETE FROM items WHERE item_id = ?", id);
        }
        for (Long id : typeIds) jdbc.update("DELETE FROM item_types WHERE item_type_id = ?", id);
    }

    @Test
    void replacementKeepsHistoryAndRetryReturnsSameTag() {
        Item item = item();
        String oldUid = uid();
        String newUid = uid();
        registration.register(item.getId(), oldUid);

        var replaced = lifecycle.replace(item.getId(), newUid);
        var retried = lifecycle.replace(item.getId(), newUid.toLowerCase());

        assertTrue(replaced.created());
        assertFalse(retried.created());
        assertEquals(replaced.response().tag().tagId(), retried.response().tag().tagId());
        assertNotNull(tags.findByUid(oldUid).orElseThrow().getDeactivatedAt());
        assertEquals(newUid, tags.findByItem_Id(item.getId()).orElseThrow().getUid());
        assertTrue(tags.existsByItem_Id(item.getId()));
        assertEquals(2L, countTags(item.getId()));
        assertEquals(1L, countActive(item.getId()));
    }

    @Test
    void replacementWithoutActiveTagCreatesOneAndDeactivateIsIdempotent() {
        Item item = item();
        String uid = uid();

        var first = lifecycle.replace(item.getId(), uid);
        assertTrue(first.created());
        lifecycle.deactivate(item.getId());
        lifecycle.deactivate(item.getId());

        assertFalse(tags.existsByItem_Id(item.getId()));
        assertTrue(tags.findByItem_Id(item.getId()).isEmpty());
        assertNotNull(tags.findByUid(uid).orElseThrow().getDeactivatedAt());
        assertEquals(1L, countTags(item.getId()));
        assertEquals(0L, countActive(item.getId()));
        // The week-5 POST must ignore historical inactive tags on the item.
        assertTrue(registration.register(item.getId(), uid()).created());
        assertEquals(1L, countActive(item.getId()));
    }

    @Test
    void inactiveUidRemainsReservedEvenForAnotherItem() {
        Item first = item();
        Item second = item();
        String uid = uid();
        registration.register(first.getId(), uid);
        lifecycle.deactivate(first.getId());

        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> registration.register(second.getId(), uid)).code());
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> registration.register(first.getId(), uid)).code());
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(second.getId(), uid)).code());
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(first.getId(), uid)).code());
    }

    @Test
    void missingItemIsNotSilentlyTreatedAsDeactivated() {
        assertEquals("ITEM_NOT_FOUND", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(Long.MAX_VALUE, uid())).code());
        assertEquals("ITEM_NOT_FOUND", assertThrows(TagRegistrationException.class,
                () -> lifecycle.deactivate(Long.MAX_VALUE)).code());
    }

    @Test
    void lookupReturnsItemAndRejectsUnknownOrInactiveUid() {
        Item item = item();
        String uid = uid();
        registration.register(item.getId(), uid);

        TagLookupResponse result = lifecycle.lookup(uid.toLowerCase());
        assertEquals(item.getId(), result.item().itemId());
        assertEquals(item.getItemName(), result.item().name());
        assertEquals(ItemStatus.AVAILABLE, result.item().status());
        assertTrue(result.item().rentable());
        assertEquals("ACTIVE", result.tag().status());
        assertEquals("TAG_NOT_FOUND", assertThrows(TagRegistrationException.class,
                () -> lifecycle.lookup(uid())).code());

        lifecycle.deactivate(item.getId());
        assertEquals("TAG_INACTIVE", assertThrows(TagRegistrationException.class,
                () -> lifecycle.lookup(uid)).code());
    }

    @Test
    void concurrentReplacementWithSameUidCreatesOnlyOneNewTag() throws Exception {
        Item item = item();
        registration.register(item.getId(), uid());
        String newUid = uid();
        CountDownLatch start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> { start.await(); return lifecycle.replace(item.getId(), newUid); });
            var second = workers.submit(() -> { start.await(); return lifecycle.replace(item.getId(), newUid); });
            start.countDown();
            var a = first.get(20, TimeUnit.SECONDS);
            var b = second.get(20, TimeUnit.SECONDS);
            assertEquals(1, List.of(a, b).stream().filter(TagRegistrationService.RegistrationResult::created).count());
            assertEquals(a.response().tag().tagId(), b.response().tag().tagId());
            assertEquals(2L, countTags(item.getId()));
            assertEquals(1L, countActive(item.getId()));
        }
    }

    @Test
    void concurrentReplacementWithDifferentUidsSerializesAndKeepsOneActive() throws Exception {
        Item item = item();
        registration.register(item.getId(), uid());
        String aUid = uid();
        String bUid = uid();
        CountDownLatch start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> { start.await(); return lifecycle.replace(item.getId(), aUid); });
            var second = workers.submit(() -> { start.await(); return lifecycle.replace(item.getId(), bUid); });
            start.countDown();
            assertTrue(first.get(20, TimeUnit.SECONDS).created());
            assertTrue(second.get(20, TimeUnit.SECONDS).created());
            assertEquals(3L, countTags(item.getId()));
            assertEquals(1L, countActive(item.getId()));
        }
    }

    @Test
    void migrationPreservesGlobalUidUniquenessAndReplacesItemConstraint() {
        assertEquals(0L, jdbc.queryForObject(
                "SELECT count(*) FROM pg_constraint WHERE conrelid = 'nfc_tags'::regclass AND conname = 'nfc_tags_item_id_key'",
                Long.class));
        assertEquals(1L, jdbc.queryForObject(
                "SELECT count(*) FROM pg_constraint WHERE conrelid = 'nfc_tags'::regclass AND conname = 'nfc_tags_tag_uid_key'",
                Long.class));
        String index = jdbc.queryForObject(
                "SELECT indexdef FROM pg_indexes WHERE tablename = 'nfc_tags' AND indexname = 'uq_nfc_tags_active_item'",
                String.class);
        assertTrue(index.contains("UNIQUE INDEX"));
        assertTrue(index.contains("deactivated_at IS NULL"));
    }

    private Item item() {
        String suffix = UUID.randomUUID().toString();
        ItemType type = types.saveAndFlush(new ItemType("교체 테스트 " + suffix, null));
        typeIds.add(type.getId());
        Item item = items.saveAndFlush(new Item("테스트 물품 " + suffix, ItemStatus.AVAILABLE, type));
        itemIds.add(item.getId());
        return item;
    }

    private long countTags(Long itemId) {
        return jdbc.queryForObject("SELECT count(*) FROM nfc_tags WHERE item_id = ?", Long.class, itemId);
    }

    private long countActive(Long itemId) {
        return jdbc.queryForObject("SELECT count(*) FROM nfc_tags WHERE item_id = ? AND deactivated_at IS NULL",
                Long.class, itemId);
    }

    private static String uid() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 14).toUpperCase();
    }
}
