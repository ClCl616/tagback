package com.tagback.service;

import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemStatusChangeSource;
import com.tagback.domain.entity.ItemStatusHistory;
import com.tagback.domain.entity.RentalStatus;
import com.tagback.domain.entity.ReturnCondition;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemStatusHistoryRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.domain.repository.RentalRepository;
import com.tagback.domain.repository.ReturnInspectionWriter;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.exception.ItemException;
import com.tagback.exception.RentalException;
import com.tagback.service.TagUidNormalizer;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RentalReturnService {
    private final ItemRepository items;
    private final RentalRepository rentals;
    private final NfcTagRepository tags;
    private final ItemStatusHistoryRepository history;
    private final ReturnInspectionWriter inspections;
    private final Clock clock;

    public RentalReturnService(ItemRepository items, RentalRepository rentals, NfcTagRepository tags,
                               ItemStatusHistoryRepository history, ReturnInspectionWriter inspections, Clock clock) {
        this.items = items;
        this.rentals = rentals;
        this.tags = tags;
        this.history = history;
        this.inspections = inspections;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ReturnScanResult scanTag(long authenticatedUserId, String rawTagUid) {
        String tagUid = TagUidNormalizer.normalize(rawTagUid);
        var tag = tags.findActiveByUid(tagUid).orElseThrow(RentalException::noActiveRental);
        long itemId = tag.getItem().getId();
        var item = items.findById(itemId).orElseThrow(ItemException::itemNotFound);
        var rental = rentals.findByItem_IdAndReturnedAtIsNull(itemId)
                .orElseThrow(RentalException::noActiveRental);
        if (!rental.getUser().getId().equals(authenticatedUserId)) {
            throw new AuthException(AuthErrorCode.FORBIDDEN);
        }
        if (item.getStatus() != ItemStatus.RENTED) throw RentalException.returnStateConflict();
        return new ReturnScanResult(tagUid, rental.getId(), item.getId(), item.getItemName(),
                item.getItemType().getId(), item.getItemType().getName());
    }

    /**
     * Returns the active rental for an NFC-identified item. The caller ID must come from
     * server-verified return authentication, never from request data.
     */
    @Transactional
    public ReturnResult returnItem(long authenticatedUserId, String rawTagUid, long expectedRentalId,
                                   ReturnCondition condition) {
        String tagUid = TagUidNormalizer.normalize(rawTagUid);
        var scannedTag = tags.findActiveByUid(tagUid).orElseThrow(RentalException::noActiveRental);
        long itemId = scannedTag.getItem().getId();
        // Use the same item-row lock as checkout and admin status changes to serialize transitions.
        var item = items.findForUpdate(itemId).orElseThrow(ItemException::itemNotFound);
        var activeTag = tags.findActiveByUid(tagUid).orElseThrow(RentalException::rentalChanged);
        if (!activeTag.getItem().getId().equals(itemId)) throw RentalException.rentalChanged();
        var rental = rentals.findByItem_IdAndReturnedAtIsNull(itemId)
                .orElseThrow(RentalException::noActiveRental);

        // Pin the confirmation to the rental found when this physical tag was scanned. A stale
        // retry can never return a later rental of the same item.
        if (!rental.getId().equals(expectedRentalId)) throw RentalException.rentalChanged();

        if (!rental.getUser().getId().equals(authenticatedUserId)) {
            throw new AuthException(AuthErrorCode.FORBIDDEN);
        }
        if (item.getStatus() != ItemStatus.RENTED) {
            throw RentalException.returnStateConflict();
        }

        // Capture after acquiring the lock, at the same precision used for checkout timestamps.
        Instant returnedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        ItemStatus previousStatus = item.getStatus();
        ItemStatus nextStatus = condition == ReturnCondition.NORMAL ? ItemStatus.AVAILABLE : ItemStatus.INSPECTION;
        rental.markReturned(returnedAt, condition);
        item.updateStatus(nextStatus);

        // The status history flush also flushes the rental and item changes. All remain in this transaction.
        items.flush();
        history.saveAndFlush(new ItemStatusHistory(itemId, previousStatus, nextStatus,
                ItemStatusChangeSource.RENTAL_FLOW, authenticatedUserId,
                condition == ReturnCondition.DAMAGED ? "반납 시 손상 확인, 점검 접수" : "정상 반납"));
        if (condition == ReturnCondition.DAMAGED) inspections.recordDamagedReturn(itemId);

        return new ReturnResult(rental.getId(), itemId, rental.getStatus(), item.getStatus(), condition,
                rental.getRentedAt(), rental.getDueAt(), returnedAt);
    }

    public record ReturnResult(Long rentalId, Long itemId, RentalStatus rentalStatus, ItemStatus itemStatus,
                               ReturnCondition condition,
                               Instant rentedAt, Instant dueAt, Instant returnedAt) {}
    public record ReturnScanResult(String tagUid, Long rentalId, Long itemId, String itemName,
                                   Long itemTypeId, String itemTypeName) {}
}
