package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.item.ItemRequests;
import com.tagback.exception.ItemException;
import com.tagback.exception.RentalException;
import com.tagback.service.ItemService;
import com.tagback.service.RentalCheckoutService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import static org.junit.jupiter.api.Assertions.*;

/** Uses real committed transactions: a test-wide rollback must not hide partial service writes. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@Import(RentalCheckoutPostgresIntegrationTest.FixedClock.class)
class RentalCheckoutPostgresIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-10-14T03:00:00.123456Z");
    @TestConfiguration
    static class FixedClock {
        @Bean @Primary Clock checkoutTestClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
    }

    @Autowired RentalCheckoutService checkout;
    @Autowired ItemService itemService;
    @Autowired ItemRepository items;
    @Autowired ItemTypeRepository types;
    @Autowired UserRepository users;
    @Autowired NfcTagRepository tags;
    @Autowired RentalRepository rentals;
    @Autowired ItemStatusHistoryRepository history;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactions;
    private Fixture data;

    @BeforeEach void fixtures() {
        data = transactions.execute(tx -> {
            var user = users.saveAndFlush(new User("+821033333333", "test-only", NOW));
            var otherUser = users.saveAndFlush(new User("+821044444444", "test-only", NOW));
            var type = types.saveAndFlush(new ItemType("반출 테스트 " + UUID.randomUUID(), null));
            var item = items.saveAndFlush(new Item("우산 1", ItemStatus.TAG_PENDING, type));
            tags.saveAndFlush(new NfcTag("04A23B1C5D6E80", item));
            item.markAvailable();
            items.flush();
            return new Fixture(user.getId(), otherUser.getId(), item.getId(), type.getId());
        });
    }

    @AfterEach void cleanup() {
        if (data == null) return;
        transactions.executeWithoutResult(tx -> {
            jdbc.update("delete from item_status_history where item_id = ?", data.itemId());
            jdbc.update("delete from rentals where item_id = ?", data.itemId());
            jdbc.update("update items set status = 'TAG_PENDING' where item_id = ?", data.itemId());
            jdbc.update("delete from nfc_tags where item_id = ?", data.itemId());
            jdbc.update("delete from items where item_id = ?", data.itemId());
            jdbc.update("delete from item_types where item_type_id = ?", data.typeId());
            jdbc.update("delete from users where user_id in (?, ?)", data.userId(), data.otherUserId());
        });
    }

    @Test void checkoutCommitsRentalItemAndActorHistoryWithSeventyTwoHourDueDate() {
        var result = checkout.checkout(data.userId(), data.itemId(), data.typeId());

        assertEquals(NOW, result.rentedAt());
        assertEquals(NOW.plusSeconds(72 * 3600), result.dueAt());
        assertEquals(RentalStatus.RENTED, result.rentalStatus());
        assertEquals(ItemStatus.RENTED, result.itemStatus());
        assertNull(result.returnedAt());
        var saved = rentals.findById(result.rentalId()).orElseThrow();
        assertEquals(result.rentedAt(), saved.getRentedAt());
        assertEquals(result.dueAt(), saved.getDueAt());
        assertEquals(data.userId(), jdbc.queryForObject(
                "select user_id from rentals where rental_id = ?", Long.class, result.rentalId()));
        assertState("RENTED", 1, 1);
        var changes = history.findByItemIdOrderByIdAsc(data.itemId());
        assertEquals(ItemStatus.AVAILABLE, changes.getFirst().getFromStatus());
        assertEquals(ItemStatus.RENTED, changes.getFirst().getToStatus());
        assertEquals(ItemStatusChangeSource.RENTAL_FLOW, changes.getFirst().getSource());
        assertEquals(data.userId(), changes.getFirst().getChangedByUserId());
    }

    @Test void lateHistoryDatabaseFailureRollsBackRentalAndAlreadyFlushedItem() {
        jdbc.execute("alter table item_status_history add constraint test_checkout_history_write "
                + "check (item_id <> " + data.itemId() + ")");
        try {
            assertThrows(DataIntegrityViolationException.class,
                    () -> checkout.checkout(data.userId(), data.itemId(), data.typeId()));
            assertState("AVAILABLE", 0, 0);
        } finally {
            jdbc.execute("alter table item_status_history drop constraint test_checkout_history_write");
        }
        // The rolled-back attempt must not poison the next transaction.
        checkout.checkout(data.userId(), data.itemId(), data.typeId());
        assertState("RENTED", 1, 1);
    }

    @Test void joinsOuterTransactionSoLaterCodeConsumptionFailureRollsBackAllCheckoutWrites() {
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(tx -> {
            checkout.checkout(data.userId(), data.itemId(), data.typeId());
            throw new IllegalStateException("Simulated later authentication write failure");
        }));
        assertState("AVAILABLE", 0, 0);
    }

    @Test void activeOverdueRentalBlocksCheckoutEvenWhenItemStatusIsAvailable() {
        transactions.executeWithoutResult(tx -> rentals.saveAndFlush(new Rental(
                users.getReferenceById(data.userId()), items.getReferenceById(data.itemId()),
                NOW.minusSeconds(4 * 86400), NOW.minusSeconds(86400))));
        jdbc.update("update rentals set status = 'OVERDUE' where item_id = ?", data.itemId());
        assertEquals("RENTAL_ALREADY_ACTIVE", assertThrows(RentalException.class,
                () -> checkout.checkout(data.otherUserId(), data.itemId(), data.typeId())).code());
        assertState("AVAILABLE", 1, 0);
    }

    @Test void twoUsersCheckingOutSameItemProduceOnlyOneRentalAndHistory() throws Exception {
        var outcomes = race(() -> checkoutOutcome(data.userId()), () -> checkoutOutcome(data.otherUserId()));
        assertEquals(1, outcomes.stream().filter("RENTED"::equals).count());
        assertEquals(1, outcomes.stream().filter("RENTAL_ALREADY_ACTIVE"::equals).count());
        assertState("RENTED", 1, 1);
    }

    @Test void checkoutAndAdministrativeStatusChangeCannotBothSucceed() throws Exception {
        var outcomes = race(() -> checkoutOutcome(data.userId()), () -> {
            var request = new ItemRequests.StatusChange();
            request.setStatus("INSPECTION");
            try {
                itemService.changeStatus(data.itemId(), request, data.otherUserId());
                return "INSPECTION";
            } catch (ItemException failure) {
                return failure.code();
            }
        });
        if (outcomes.contains("RENTED")) {
            assertTrue(outcomes.contains("ITEM_STATUS_CHANGE_CONFLICT"));
            assertState("RENTED", 1, 1);
        } else {
            assertTrue(outcomes.contains("INSPECTION"));
            assertTrue(outcomes.contains("ITEM_NOT_AVAILABLE"));
            assertState("INSPECTION", 0, 1);
        }
    }

    private String checkoutOutcome(long userId) {
        try {
            checkout.checkout(userId, data.itemId(), data.typeId());
            return "RENTED";
        } catch (RentalException failure) {
            return failure.code();
        }
    }

    private List<String> race(Callable<String> first, Callable<String> second) throws Exception {
        try (var workers = Executors.newFixedThreadPool(2)) {
            var ready = new CountDownLatch(2);
            var start = new CountDownLatch(1);
            Future<String> one = workers.submit(() -> afterSignal(first, ready, start));
            Future<String> two = workers.submit(() -> afterSignal(second, ready, start));
            try {
                assertTrue(ready.await(5, TimeUnit.SECONDS));
                start.countDown();
                return List.of(one.get(15, TimeUnit.SECONDS), two.get(15, TimeUnit.SECONDS));
            } finally {
                start.countDown();
                workers.shutdownNow();
            }
        }
    }

    private String afterSignal(Callable<String> action, CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        if (!start.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Race did not start");
        return action.call();
    }

    private void assertState(String status, int rentalCount, int historyCount) {
        assertEquals(status, jdbc.queryForObject("select status from items where item_id = ?", String.class, data.itemId()));
        assertEquals(rentalCount, jdbc.queryForObject("select count(*) from rentals where item_id = ?", Integer.class, data.itemId()));
        assertEquals(historyCount, jdbc.queryForObject("select count(*) from item_status_history where item_id = ?", Integer.class, data.itemId()));
    }

    private record Fixture(Long userId, Long otherUserId, Long itemId, Long typeId) {}
}
