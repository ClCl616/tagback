package com.tagback.service;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.exception.ItemException;
import com.tagback.exception.RentalException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RentalCheckoutService {
    private static final Duration RENTAL_DURATION = Duration.ofHours(72);
    private final ItemRepository items;
    private final NfcTagRepository tags;
    private final RentalRepository rentals;
    private final ItemStatusHistoryRepository history;
    private final UserRepository users;
    private final Clock clock;

    public RentalCheckoutService(ItemRepository items, NfcTagRepository tags, RentalRepository rentals,
                                 ItemStatusHistoryRepository history, UserRepository users, Clock clock) {
        this.items = items;
        this.tags = tags;
        this.rentals = rentals;
        this.history = history;
        this.users = users;
        this.clock = clock;
    }

    /**
     * Internal persistence step: authenticatedUserId must come from server-verified rental authentication,
     * never a request body. REQUIRED propagation lets code consumption and replay storage join this transaction.
     * This method does not validate/consume kiosk credentials or replay a previous operation.
     */
    @Transactional
    public CheckoutResult checkout(long authenticatedUserId, long itemId, long itemTypeId) {
        var user = users.findById(authenticatedUserId)
                .orElseThrow(() -> new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND));
        var item = items.findForUpdate(itemId).orElseThrow(ItemException::itemNotFound);
        if (item.getItemType().getId() != itemTypeId) throw RentalException.itemTypeMismatch();
        if (rentals.existsByItem_IdAndReturnedAtIsNull(itemId)) throw RentalException.activeRental();
        if (item.getStatus() != ItemStatus.AVAILABLE || !tags.existsByItem_Id(itemId)) {
            throw RentalException.itemNotAvailable();
        }

        // Capture time after waiting for the item lock; match PostgreSQL timestamp precision.
        Instant rentedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant dueAt = rentedAt.plus(RENTAL_DURATION);
        try {
            var rental = rentals.saveAndFlush(new Rental(user, item, rentedAt, dueAt));
            var previousStatus = item.getStatus();
            item.updateStatus(ItemStatus.RENTED);
            items.flush();
            history.saveAndFlush(new ItemStatusHistory(itemId, previousStatus, ItemStatus.RENTED,
                    ItemStatusChangeSource.RENTAL_FLOW, authenticatedUserId, null));
            return new CheckoutResult(rental.getId(), itemId, itemTypeId, rental.getStatus(),
                    item.getStatus(), rentedAt, dueAt, rental.getReturnedAt());
        } catch (DataIntegrityViolationException exception) {
            // Never query again in PostgreSQL's failed transaction. Let Spring roll back all writes.
            if (isActiveRentalConflict(exception)) throw RentalException.activeRental();
            throw exception;
        }
    }

    private boolean isActiveRentalConflict(Throwable exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation
                    && "23505".equals(violation.getSQLState())
                    && "uq_active_rental_item".equals(violation.getConstraintName())) return true;
        }
        return false;
    }

    /** A snapshot, so callers do not need to access lazy entity relationships after commit. */
    public record CheckoutResult(Long rentalId, Long itemId, Long itemTypeId, RentalStatus rentalStatus,
                                 ItemStatus itemStatus, Instant rentedAt, Instant dueAt, Instant returnedAt) {}
}
