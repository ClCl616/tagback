package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.service.RentalQueryService;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.*;

/** Exercises the existing Flyway schema and partial unique index on isolated PostgreSQL. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@Transactional
class RentalRepositoryIntegrationTest {
    @Autowired RentalRepository rentals;
    @Autowired UserRepository users;
    @Autowired ItemRepository items;
    @Autowired ItemTypeRepository types;
    @Autowired NfcTagRepository tags;
    @Autowired EntityManager em;
    @Autowired JdbcTemplate jdbc;
    @Autowired RentalQueryService queries;
    @Autowired Clock clock;

    private static final Instant RENTED_AT = Instant.parse("2026-10-14T03:00:00Z");
    private static final Instant DUE_AT = Instant.parse("2026-10-17T03:00:00Z");
    private User user;
    private Item item;
    private Item otherItem;

    @BeforeEach
    void fixtures() {
        user = users.saveAndFlush(new User("+821033333333", "integration-fixture-only", RENTED_AT));
        var type = types.saveAndFlush(new ItemType("대여 저장소 테스트", null));
        item = items.saveAndFlush(new Item("물품 1", ItemStatus.TAG_PENDING, type));
        tags.saveAndFlush(new NfcTag("04A23B1C5D6E80", item));
        item.updateStatus(ItemStatus.RENTED);
        items.flush();
        otherItem = items.saveAndFlush(new Item("물품 2", ItemStatus.TAG_PENDING, type));
    }

    @Test
    void persistsRentalAndReloadsAllSchemaFields() {
        var saved = rentals.saveAndFlush(new Rental(user, item, RENTED_AT, DUE_AT));
        Long id = saved.getId();
        Long userId = user.getId();
        Long itemId = item.getId();
        em.clear();

        var found = rentals.findById(id).orElseThrow();
        assertEquals(userId, found.getUser().getId());
        assertEquals(itemId, found.getItem().getId());
        assertEquals(RENTED_AT, found.getRentedAt());
        assertEquals(DUE_AT, found.getDueAt());
        assertNull(found.getReturnedAt());
        assertEquals(RentalStatus.RENTED, found.getStatus());
        assertEquals("RENTED", jdbc.queryForObject(
                "select status from rentals where rental_id = ?", String.class, id));
        assertTrue(rentals.existsByItem_IdAndReturnedAtIsNull(itemId));
        assertEquals(id, rentals.findByItem_IdAndReturnedAtIsNull(itemId).orElseThrow().getId());
    }

    @Test
    void overdueRentalRemainsActiveAndQueriesAreScopedToTheItem() {
        var saved = rentals.saveAndFlush(new Rental(user, item, RENTED_AT, DUE_AT));
        jdbc.update("update rentals set status = 'OVERDUE' where rental_id = ?", saved.getId());
        em.clear();

        assertTrue(rentals.existsByItem_IdAndReturnedAtIsNull(item.getId()));
        assertEquals(RentalStatus.OVERDUE,
                rentals.findByItem_IdAndReturnedAtIsNull(item.getId()).orElseThrow().getStatus());
        assertTrue(items.hasActiveRental(item.getId()));
        assertFalse(rentals.existsByItem_IdAndReturnedAtIsNull(otherItem.getId()));
        assertTrue(rentals.findByItem_IdAndReturnedAtIsNull(otherItem.getId()).isEmpty());
    }

    @Test
    void returnedTimestampExcludesHistoryAndAllowsAnotherRental() {
        var saved = rentals.saveAndFlush(new Rental(user, item, RENTED_AT, DUE_AT));
        Long oldId = saved.getId();
        // Even a legacy row whose status was not updated is inactive once returned_at is set.
        jdbc.update("update rentals set returned_at = rented_at + interval '1 hour' where rental_id = ?", oldId);
        em.clear();

        assertFalse(rentals.existsByItem_IdAndReturnedAtIsNull(item.getId()));
        assertTrue(rentals.findByItem_IdAndReturnedAtIsNull(item.getId()).isEmpty());
        assertFalse(items.hasActiveRental(item.getId()));
        assertEquals(RENTED_AT.plusSeconds(3600), rentals.findById(oldId).orElseThrow().getReturnedAt());

        jdbc.update("update rentals set status = 'RETURNED' where rental_id = ?", oldId);
        em.clear();
        assertEquals(RentalStatus.RETURNED, rentals.findById(oldId).orElseThrow().getStatus());
        var next = rentals.saveAndFlush(new Rental(users.getReferenceById(user.getId()),
                items.getReferenceById(item.getId()), RENTED_AT.plusSeconds(7200), DUE_AT.plusSeconds(7200)));
        assertNotEquals(oldId, next.getId());
        assertEquals(next.getId(), rentals.findByItem_IdAndReturnedAtIsNull(item.getId()).orElseThrow().getId());
    }

    @Test
    void databaseRejectsSecondActiveRentalForSameItemIncludingOverdue() {
        var saved = rentals.saveAndFlush(new Rental(user, item, RENTED_AT, DUE_AT));
        jdbc.update("update rentals set status = 'OVERDUE' where rental_id = ?", saved.getId());

        var failure = assertThrows(DataIntegrityViolationException.class,
                () -> rentals.saveAndFlush(new Rental(user, item, RENTED_AT, DUE_AT)));
        assertTrue(failure.getMostSpecificCause().getMessage().contains("uq_active_rental_item"));
    }

    @Test
    void listsOnlyTheAuthenticatedUsersRentalsByReturnState() {
        var otherUser = users.saveAndFlush(new User("+821044444444", "integration-fixture-only", RENTED_AT));
        var mine = rentals.saveAndFlush(new Rental(user, item, RENTED_AT, DUE_AT));
        var theirs = rentals.saveAndFlush(new Rental(otherUser, otherItem, RENTED_AT, DUE_AT));
        em.clear();

        var activeSort = PageRequest.of(0, 20, Sort.by(Sort.Order.asc("dueAt"), Sort.Order.desc("id")));
        var mineActive = rentals.findByUser_IdAndReturnedAtIsNull(user.getId(), activeSort);
        assertEquals(1, mineActive.getTotalElements());
        assertEquals(mine.getId(), mineActive.getContent().getFirst().getId());
        assertEquals("물품 1", mineActive.getContent().getFirst().getItem().getItemName());
        assertEquals(theirs.getId(), rentals.findByUser_IdAndReturnedAtIsNull(otherUser.getId(), activeSort)
                .getContent().getFirst().getId());

        jdbc.update("update rentals set returned_at = rented_at + interval '1 hour' where rental_id = ?", mine.getId());
        em.clear();
        var historySort = PageRequest.of(0, 20, Sort.by(Sort.Order.desc("returnedAt"), Sort.Order.desc("id")));
        assertTrue(rentals.findByUser_IdAndReturnedAtIsNull(user.getId(), activeSort).isEmpty());
        assertEquals(mine.getId(), rentals.findByUser_IdAndReturnedAtIsNotNull(user.getId(), historySort)
                .getContent().getFirst().getId());
        assertTrue(rentals.findByUser_IdAndReturnedAtIsNotNull(otherUser.getId(), historySort).isEmpty());
    }

    @Test
    void overdueReadUsesStoredDueAtWithoutMutatingTheRental() {
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        var due = now.minusSeconds(1);
        var saved = rentals.saveAndFlush(new Rental(user, item, due.minusSeconds(72 * 3600), due));
        em.clear();

        var active = queries.list(user.getId(), "ACTIVE", 0, 20);
        assertEquals(1, active.totalElements());
        assertEquals(RentalStatus.OVERDUE, active.rentals().getFirst().rentalStatus());
        assertEquals(due, active.rentals().getFirst().dueAt());
        assertEquals("RENTED", jdbc.queryForObject(
                "select status from rentals where rental_id = ?", String.class, saved.getId()));

        jdbc.update("update rentals set returned_at = ? where rental_id = ?", Timestamp.from(now), saved.getId());
        em.clear();
        assertEquals(0, queries.list(user.getId(), "ACTIVE", 0, 20).totalElements());
        var history = queries.list(user.getId(), "HISTORY", 0, 20);
        assertEquals(RentalStatus.RETURNED, history.rentals().getFirst().rentalStatus());
        assertEquals("RENTED", jdbc.queryForObject(
                "select status from rentals where rental_id = ?", String.class, saved.getId()));
    }
}
