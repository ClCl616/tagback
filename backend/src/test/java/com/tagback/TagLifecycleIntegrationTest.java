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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
    @Autowired TransactionTemplate transactions;

    private final List<Long> itemIds = new ArrayList<>();
    private final List<Long> typeIds = new ArrayList<>();
    private final List<Long> userIds = new ArrayList<>();
    private Long actorUserId;

    @BeforeEach
    void createActor() {
        String phone = "+8210" + String.format("%08d", Math.floorMod(UUID.randomUUID().getLeastSignificantBits(), 100_000_000));
        actorUserId = jdbc.queryForObject(
                "INSERT INTO users (phone_number, password_hash) VALUES (?, 'test') RETURNING user_id",
                Long.class, phone);
        userIds.add(actorUserId);
    }

    @AfterEach
    void cleanup() {
        for (Long id : itemIds) {
            jdbc.update("DELETE FROM rentals WHERE item_id = ?", id);
            jdbc.update("UPDATE items SET status = 'TAG_PENDING' WHERE item_id = ?", id);
            jdbc.update("DELETE FROM item_status_history WHERE item_id = ?", id);
            jdbc.update("DELETE FROM nfc_tags WHERE item_id = ?", id);
            jdbc.update("DELETE FROM items WHERE item_id = ?", id);
        }
        for (Long id : userIds) jdbc.update("DELETE FROM users WHERE user_id = ?", id);
        for (Long id : typeIds) jdbc.update("DELETE FROM item_types WHERE item_type_id = ?", id);
    }

    @Test
    void replacementKeepsHistoryAndRetryReturnsSameTag() {
        Item item = item();
        String oldUid = uid();
        String newUid = uid();
        var original = registration.register(item.getId(), oldUid);

        var replaced = lifecycle.replace(item.getId(), newUid, oldUid, actorUserId);
        var retried = lifecycle.replace(item.getId(), newUid.toLowerCase(), oldUid, actorUserId);

        assertTrue(replaced.created());
        assertFalse(retried.created());
        assertEquals(replaced.response().tag().tagId(), retried.response().tag().tagId());
        assertNotNull(tags.findByUid(oldUid).orElseThrow().getDeactivatedAt());
        assertEquals(newUid, tags.findByItem_Id(item.getId()).orElseThrow().getUid());
        assertTrue(tags.existsByItem_Id(item.getId()));
        assertEquals(2L, countTags(item.getId()));
        assertEquals(1L, countActive(item.getId()));

        var restored = lifecycle.replace(item.getId(), oldUid, newUid, actorUserId);
        assertTrue(restored.created());
        assertEquals(original.response().tag().tagId(), restored.response().tag().tagId());
        assertEquals(oldUid, tags.findByItem_Id(item.getId()).orElseThrow().getUid());
        assertNull(tags.findByUid(oldUid).orElseThrow().getDeactivatedAt());
        assertNotNull(tags.findByUid(newUid).orElseThrow().getDeactivatedAt());
        assertEquals(2L, countTags(item.getId()));
        assertEquals(1L, countActive(item.getId()));
        assertFalse(lifecycle.replace(item.getId(), oldUid, newUid, actorUserId).created());
    }

    @Test
    void replacementWithoutActiveTagCreatesOneAndDeactivateIsIdempotent() {
        Item item = item();
        String uid = uid();

        long before = historyCount(item.getId());
        var first = lifecycle.replace(item.getId(), uid, null, actorUserId);
        assertTrue(first.created());
        assertEquals(ItemStatus.AVAILABLE, status(item.getId()));
        assertEquals(before + 1, historyCount(item.getId()));
        assertLatestHistory(item.getId(), ItemStatus.TAG_PENDING, ItemStatus.AVAILABLE);
        lifecycle.deactivate(item.getId(), uid, actorUserId);
        assertEquals(ItemStatus.TAG_PENDING, status(item.getId()));
        assertEquals(before + 2, historyCount(item.getId()));
        assertLatestHistory(item.getId(), ItemStatus.AVAILABLE, ItemStatus.TAG_PENDING);
        lifecycle.deactivate(item.getId(), "", actorUserId);
        assertEquals(ItemStatus.TAG_PENDING, status(item.getId()));
        assertEquals(before + 2, historyCount(item.getId()));

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
    void deleteThenPutSameUidReactivatesOriginalRow() {
        Item item = item();
        String uid = uid();
        var original = registration.register(item.getId(), uid);

        lifecycle.deactivate(item.getId(), uid, actorUserId);
        assertEquals(0L, countActive(item.getId()));
        assertEquals(ItemStatus.TAG_PENDING, status(item.getId()));
        long before = historyCount(item.getId());
        var restored = lifecycle.replace(item.getId(), uid.toLowerCase(), null, actorUserId);

        assertTrue(restored.created());
        assertEquals(original.response().tag().tagId(), restored.response().tag().tagId());
        assertEquals(ItemStatus.AVAILABLE, status(item.getId()));
        assertEquals(before + 1, historyCount(item.getId()));
        assertLatestHistory(item.getId(), ItemStatus.TAG_PENDING, ItemStatus.AVAILABLE);
        assertEquals(1L, countTags(item.getId()));
        assertEquals(1L, countActive(item.getId()));
        assertNull(tags.findByUid(uid).orElseThrow().getDeactivatedAt());
    }

    @Test
    void anotherItemCannotReuseInactiveUid() {
        Item first = item();
        Item second = item();
        String uid = uid();
        registration.register(first.getId(), uid);
        lifecycle.deactivate(first.getId(), uid, actorUserId);

        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> registration.register(second.getId(), uid)).code());
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> registration.register(first.getId(), uid)).code());
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(second.getId(), uid, null, actorUserId)).code());
        assertEquals(0L, countTags(second.getId()));
        assertEquals(0L, countActive(first.getId()));
    }

    @Test
    void missingItemIsNotSilentlyTreatedAsDeactivated() {
        assertEquals("ITEM_NOT_FOUND", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(Long.MAX_VALUE, uid(), null, actorUserId)).code());
        assertEquals("ITEM_NOT_FOUND", assertThrows(TagRegistrationException.class,
                () -> lifecycle.deactivate(Long.MAX_VALUE, "", actorUserId)).code());
    }

    @Test
    void lookupReturnsItemAndRejectsUnknownOrInactiveUid() {
        Item item = item();
        String uid = uid();
        registration.register(item.getId(), uid);

        TagLookupResponse result = lifecycle.lookup(uid.toLowerCase());
        assertEquals(item.getId(), result.item().itemId());
        assertEquals(item.getItemName(), result.item().name());
        assertEquals(item.getItemType().getId().toString(), result.item().itemTypeId());
        assertEquals(item.getItemType().getName(), result.item().itemTypeName());
        assertEquals(ItemStatus.AVAILABLE, result.item().status());
        assertTrue(result.item().rentable());
        assertEquals("ACTIVE", result.tag().status());
        assertEquals("TAG_NOT_FOUND", assertThrows(TagRegistrationException.class,
                () -> lifecycle.lookup(uid())).code());

        lifecycle.deactivate(item.getId(), uid, actorUserId);
        assertEquals("TAG_INACTIVE", assertThrows(TagRegistrationException.class,
                () -> lifecycle.lookup(uid)).code());
    }

    @Test
    void concurrentReplacementWithSameUidCreatesOnlyOneNewTag() throws Exception {
        Item item = item();
        String originalUid = uid();
        registration.register(item.getId(), originalUid);
        String newUid = uid();
        CountDownLatch start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> { start.await(); return lifecycle.replace(item.getId(), newUid, originalUid, actorUserId); });
            var second = workers.submit(() -> { start.await(); return lifecycle.replace(item.getId(), newUid, originalUid, actorUserId); });
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
    void concurrentReplacementWithDifferentUidsRejectsStaleExpectedUid() throws Exception {
        Item item = item();
        String originalUid = uid();
        registration.register(item.getId(), originalUid);
        String aUid = uid();
        String bUid = uid();
        CountDownLatch start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> { start.await(); return replaceOutcome(item.getId(), aUid, originalUid); });
            var second = workers.submit(() -> { start.await(); return replaceOutcome(item.getId(), bUid, originalUid); });
            start.countDown();
            List<String> outcomes = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter("CREATED"::equals).count());
            assertEquals(1, outcomes.stream().filter("TAG_CHANGED"::equals).count());
            assertEquals(2L, countTags(item.getId()));
            assertEquals(1L, countActive(item.getId()));
        }
    }

    @Test
    void expectedUidMustMatchUnlessRequestIsAlreadyActive() {
        Item item = item();
        String oldUid = uid();
        registration.register(item.getId(), oldUid);
        assertEquals("TAG_CHANGED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(item.getId(), uid(), null, actorUserId)).code());
        assertEquals("TAG_CHANGED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(item.getId(), uid(), uid(), actorUserId)).code());
        assertFalse(lifecycle.replace(item.getId(), oldUid, uid(), actorUserId).created());
        assertEquals(oldUid, tags.findByItem_Id(item.getId()).orElseThrow().getUid());
    }

    @Test
    void replacingAvailableItemDoesNotCreateStatusHistory() {
        Item item = item();
        String oldUid = uid();
        registration.register(item.getId(), oldUid, actorUserId);
        long before = historyCount(item.getId());

        assertTrue(lifecycle.replace(item.getId(), uid(), oldUid, actorUserId).created());

        assertEquals(ItemStatus.AVAILABLE, status(item.getId()));
        assertEquals(before, historyCount(item.getId()));
    }

    @Test
    void inspectionAndRepairStatusesStayUnchangedWhenTagsChange() {
        for (ItemStatus state : List.of(ItemStatus.INSPECTION, ItemStatus.REPAIR)) {
            Item item = item();
            jdbc.update("UPDATE items SET status = ? WHERE item_id = ?", state.name(), item.getId());
            long before = historyCount(item.getId());

            assertTrue(lifecycle.replace(item.getId(), uid(), null, actorUserId).created());
            assertEquals(state, status(item.getId()));
            assertEquals(before, historyCount(item.getId()));

            lifecycle.deactivate(item.getId(), tags.findByItem_Id(item.getId()).orElseThrow().getUid(), actorUserId);
            assertEquals(state, status(item.getId()));
            assertEquals(before, historyCount(item.getId()));
        }
    }

    @Test
    void deactivatingItemWithoutActiveTagDoesNotChangeStatusOrHistory() {
        Item item = item();
        long before = historyCount(item.getId());

        lifecycle.deactivate(item.getId(), "", actorUserId);

        assertEquals(ItemStatus.TAG_PENDING, status(item.getId()));
        assertEquals(before, historyCount(item.getId()));
    }

    @Test
    void deleteExpectedUidMustMatchCurrentActiveTag() {
        Item item = item();
        String uid = uid();
        registration.register(item.getId(), uid);
        long before = historyCount(item.getId());

        assertEquals("TAG_CHANGED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.deactivate(item.getId(), "", actorUserId)).code());
        assertEquals("TAG_CHANGED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.deactivate(item.getId(), uid(), actorUserId)).code());
        assertEquals(1L, countActive(item.getId()));
        assertEquals(before, historyCount(item.getId()));

        lifecycle.deactivate(item.getId(), uid.toLowerCase(), actorUserId);
        assertEquals(0L, countActive(item.getId()));
        assertEquals("TAG_CHANGED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.deactivate(item.getId(), uid, actorUserId)).code());
        lifecycle.deactivate(item.getId(), "", actorUserId);
        assertEquals("TAG_CHANGED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.deactivate(item.getId(), uid, actorUserId)).code());
        assertEquals(ItemStatus.TAG_PENDING, status(item.getId()));
    }

    @Test
    void rentedStatusBlocksReplaceAndDeleteButEmptyDeleteRemainsIdempotent() {
        Item item = item();
        String oldUid = uid();
        registration.register(item.getId(), oldUid);
        jdbc.update("UPDATE items SET status = 'RENTED' WHERE item_id = ?", item.getId());
        assertRentedTagUnchanged(item, oldUid);
        lifecycle.deactivate(itemWithoutTagAndRentedStatus().getId(), "", actorUserId);
    }

    @Test
    void unreturnedRentalBlocksReplaceAndDeleteEvenWhenStatusIsAvailable() {
        Item item = item();
        String oldUid = uid();
        registration.register(item.getId(), oldUid);
        addRental(item, false);
        assertRentedTagUnchanged(item, oldUid);
    }

    @Test
    void returnedRentalAllowsReplacementAndDeletion() {
        Item item = item();
        String oldUid = uid();
        String newUid = uid();
        registration.register(item.getId(), oldUid);
        addRental(item, true);
        assertTrue(lifecycle.replace(item.getId(), newUid, oldUid, actorUserId).created());
        lifecycle.deactivate(item.getId(), newUid, actorUserId);
        assertEquals(0L, countActive(item.getId()));
    }

    private void assertRentedTagUnchanged(Item item, String oldUid) {
        long before = historyCount(item.getId());
        assertEquals("ITEM_RENTED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.replace(item.getId(), uid(), oldUid, actorUserId)).code());
        assertEquals("ITEM_RENTED", assertThrows(TagRegistrationException.class,
                () -> lifecycle.deactivate(item.getId(), oldUid, actorUserId)).code());
        assertEquals(oldUid, tags.findByItem_Id(item.getId()).orElseThrow().getUid());
        assertEquals(1L, countActive(item.getId()));
        assertEquals(before, historyCount(item.getId()));
    }

    private Item itemWithoutTagAndRentedStatus() {
        Item item = item();
        jdbc.update("UPDATE items SET status = 'RENTED' WHERE item_id = ?", item.getId());
        return item;
    }

    private void addRental(Item item, boolean returned) {
        String phone = "+8210" + String.format("%08d", Math.floorMod(UUID.randomUUID().getLeastSignificantBits(), 100_000_000));
        Long userId = jdbc.queryForObject("INSERT INTO users (phone_number, password_hash) VALUES (?, 'test') RETURNING user_id",
                Long.class, phone);
        userIds.add(userId);
        if (returned) {
            jdbc.update("INSERT INTO rentals (user_id, item_id, due_at, returned_at, status) "
                    + "VALUES (?, ?, now() + interval '1 day', now(), 'RETURNED')", userId, item.getId());
        } else {
            jdbc.update("INSERT INTO rentals (user_id, item_id, due_at) "
                    + "VALUES (?, ?, now() + interval '1 day')", userId, item.getId());
        }
    }

    private String replaceOutcome(Long itemId, String uid, String expectedUid) {
        try {
            return lifecycle.replace(itemId, uid, expectedUid, actorUserId).created() ? "CREATED" : "UNCHANGED";
        } catch (TagRegistrationException exception) {
            return exception.code();
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

    @Test
    void availableItemRequiresAnActiveTagAtTransactionCommit() {
        Item item = item();
        String oldUid = uid();
        registration.register(item.getId(), oldUid);

        assertThrows(DataIntegrityViolationException.class, () ->
                jdbc.update("UPDATE nfc_tags SET deactivated_at = now() WHERE item_id = ?", item.getId()));
        assertEquals(1L, countActive(item.getId()));

        lifecycle.deactivate(item.getId(), oldUid, actorUserId);
        assertThrows(DataIntegrityViolationException.class, () ->
                jdbc.update("UPDATE items SET status = 'AVAILABLE' WHERE item_id = ?", item.getId()));
        assertEquals(ItemStatus.TAG_PENDING, status(item.getId()));

        String newUid = uid();
        transactions.executeWithoutResult(ignored -> {
            jdbc.update("UPDATE items SET status = 'AVAILABLE' WHERE item_id = ?", item.getId());
            jdbc.update("INSERT INTO nfc_tags(item_id, tag_uid) VALUES (?, ?)", item.getId(), newUid);
        });
        assertEquals(ItemStatus.AVAILABLE, status(item.getId()));
        assertEquals(1L, countActive(item.getId()));

        String replacementUid = uid();
        transactions.executeWithoutResult(ignored -> {
            jdbc.update("UPDATE nfc_tags SET deactivated_at = now() WHERE item_id = ? AND deactivated_at IS NULL",
                    item.getId());
            jdbc.update("INSERT INTO nfc_tags(item_id, tag_uid) VALUES (?, ?)", item.getId(), replacementUid);
        });
        assertEquals(ItemStatus.AVAILABLE, status(item.getId()));
        assertEquals(1L, countActive(item.getId()));
    }

    private Item item() {
        String suffix = UUID.randomUUID().toString();
        ItemType type = types.saveAndFlush(new ItemType("교체 테스트 " + suffix, null));
        typeIds.add(type.getId());
        Item item = items.saveAndFlush(new Item("테스트 물품 " + suffix, ItemStatus.TAG_PENDING, type));
        itemIds.add(item.getId());
        return item;
    }

    private long countTags(Long itemId) {
        return jdbc.queryForObject("SELECT count(*) FROM nfc_tags WHERE item_id = ?", Long.class, itemId);
    }

    private ItemStatus status(Long itemId) {
        return ItemStatus.valueOf(jdbc.queryForObject(
                "SELECT status FROM items WHERE item_id = ?", String.class, itemId));
    }

    private long historyCount(Long itemId) {
        return jdbc.queryForObject("SELECT count(*) FROM item_status_history WHERE item_id = ?", Long.class, itemId);
    }

    private void assertLatestHistory(Long itemId, ItemStatus from, ItemStatus to) {
        var row = jdbc.queryForMap("SELECT from_status, to_status, source, changed_by_user_id, reason "
                + "FROM item_status_history WHERE item_id = ? ORDER BY item_status_history_id DESC LIMIT 1", itemId);
        assertEquals(from.name(), row.get("from_status"));
        assertEquals(to.name(), row.get("to_status"));
        assertEquals("TAG_REGISTRATION", row.get("source"));
        assertEquals(actorUserId, ((Number) row.get("changed_by_user_id")).longValue());
        assertNull(row.get("reason"));
    }

    private long countActive(Long itemId) {
        return jdbc.queryForObject("SELECT count(*) FROM nfc_tags WHERE item_id = ? AND deactivated_at IS NULL",
                Long.class, itemId);
    }

    private static String uid() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 14).toUpperCase();
    }
}
