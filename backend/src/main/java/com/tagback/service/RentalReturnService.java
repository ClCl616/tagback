package com.tagback.service;

import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemStatusChangeSource;
import com.tagback.domain.entity.ItemStatusHistory;
import com.tagback.domain.entity.RentalStatus;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemStatusHistoryRepository;
import com.tagback.domain.repository.RentalRepository;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.exception.ItemException;
import com.tagback.exception.RentalException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RentalReturnService {
    private final ItemRepository items;
    private final RentalRepository rentals;
    private final ItemStatusHistoryRepository history;
    private final Clock clock;

    public RentalReturnService(ItemRepository items, RentalRepository rentals,
                               ItemStatusHistoryRepository history, Clock clock) {
        this.items = items;
        this.rentals = rentals;
        this.history = history;
        this.clock = clock;
    }

    /**
     * Returns the active rental for an NFC-identified item. The caller ID must come from
     * server-verified return authentication, never from request data.
     */
    @Transactional
    public ReturnResult returnItem(long authenticatedUserId, long itemId) {
        // Use the same item-row lock as checkout and admin status changes to serialize transitions.
        var item = items.findForUpdate(itemId).orElseThrow(ItemException::itemNotFound);
        var rental = rentals.findByItem_IdAndReturnedAtIsNull(itemId)
                .orElseThrow(RentalException::noActiveRental);

        if (!rental.getUser().getId().equals(authenticatedUserId)) {
            throw new AuthException(AuthErrorCode.FORBIDDEN);
        }
        if (item.getStatus() != ItemStatus.RENTED) {
            throw RentalException.returnStateConflict();
        }

        // Capture after acquiring the lock, at the same precision used for checkout timestamps.
        Instant returnedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        ItemStatus previousStatus = item.getStatus();
        rental.markReturned(returnedAt);
        item.updateStatus(ItemStatus.AVAILABLE);

        // The status history flush also flushes the rental and item changes. All remain in this transaction.
        items.flush();
        history.saveAndFlush(new ItemStatusHistory(itemId, previousStatus, ItemStatus.AVAILABLE,
                ItemStatusChangeSource.RENTAL_FLOW, authenticatedUserId, null));

        return new ReturnResult(rental.getId(), itemId, rental.getStatus(), item.getStatus(),
                rental.getRentedAt(), rental.getDueAt(), returnedAt);
    }

    public record ReturnResult(Long rentalId, Long itemId, RentalStatus rentalStatus, ItemStatus itemStatus,
                               Instant rentedAt, Instant dueAt, Instant returnedAt) {}
}
