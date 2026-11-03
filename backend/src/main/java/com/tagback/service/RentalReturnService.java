package com.tagback.service;

import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemStatusChangeSource;
import com.tagback.domain.entity.ItemStatusHistory;
import com.tagback.domain.entity.RentalStatus;
import com.tagback.domain.entity.ReturnCondition;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemStatusHistoryRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.domain.repository.NfcScanProofUseStore;
import com.tagback.domain.repository.NfcReturnScanTicketStore;
import com.tagback.domain.repository.RentalRepository;
import com.tagback.domain.repository.ReturnInspectionWriter;
import com.tagback.dto.rental.NfcScanProof;
import com.tagback.exception.ItemException;
import com.tagback.exception.RentalException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RentalReturnService {
    private static final long RETURN_SCAN_TICKET_TTL_SECONDS = 60;
    private final ItemRepository items;
    private final RentalRepository rentals;
    private final NfcTagRepository tags;
    private final ItemStatusHistoryRepository history;
    private final ReturnInspectionWriter inspections;
    private final NfcScanProofVerifier scanProofs;
    private final NfcScanProofUseStore scanProofUses;
    private final NfcReturnScanTicketStore returnTickets;
    private final Clock clock;

    public RentalReturnService(ItemRepository items, RentalRepository rentals, NfcTagRepository tags,
                               ItemStatusHistoryRepository history, ReturnInspectionWriter inspections,
                               NfcScanProofVerifier scanProofs, NfcScanProofUseStore scanProofUses,
                               NfcReturnScanTicketStore returnTickets, Clock clock) {
        this.items = items;
        this.rentals = rentals;
        this.tags = tags;
        this.history = history;
        this.inspections = inspections;
        this.scanProofs = scanProofs;
        this.scanProofUses = scanProofUses;
        this.returnTickets = returnTickets;
        this.clock = clock;
    }

    @Transactional
    public ReturnScanResult scanTag(NfcScanProof proof) {
        var verifiedProof = scanProofs.verify(proof);
        String tagUid = verifiedProof.uid();
        // Burn the bridge proof even when the tag has no active rental, so it cannot be replayed later.
        if (!scanProofUses.consume(verifiedProof.nonce(), tagUid)) throw RentalException.scanProofUsed();
        var tag = tags.findActiveByUid(tagUid).orElseThrow(RentalException::noActiveRental);
        long itemId = tag.getItem().getId();
        var item = items.findById(itemId).orElseThrow(ItemException::itemNotFound);
        var rental = rentals.findByItem_IdAndReturnedAtIsNull(itemId)
                .orElseThrow(RentalException::noActiveRental);
        if (item.getStatus() != ItemStatus.RENTED) throw RentalException.returnStateConflict();
        Instant scannedAt = clock.instant();
        UUID ticketId = returnTickets.create(verifiedProof.bridgeId(), tagUid, verifiedProof.nonce(), itemId, rental.getId(), scannedAt,
                scannedAt.plusSeconds(RETURN_SCAN_TICKET_TTL_SECONDS));
        return new ReturnScanResult(ticketId, rental.getId(), item.getId(), item.getItemName(),
                item.getItemType().getId(), item.getItemType().getName());
    }

    /** Returns an active rental only with a short-lived ticket issued for a signed reader scan. */
    @Transactional
    public ReturnResult returnItem(UUID scanTicketId, NfcScanProof proof,
                                   ReturnCondition condition) {
        Instant lookupAt = clock.instant();
        var ticket = returnTickets.findUsable(scanTicketId, lookupAt)
                .orElseThrow(RentalException::invalidScanProof);
        var verifiedProof = scanProofs.verify(proof);
        if (!ticket.bridgeId().equals(verifiedProof.bridgeId()) || !ticket.uid().equals(verifiedProof.uid())
                || !ticket.proofNonce().equals(verifiedProof.nonce())) {
            throw RentalException.invalidScanProof();
        }
        long itemId = ticket.itemId();
        // Use the same item-row lock as checkout and admin status changes to serialize transitions.
        var item = items.findForUpdate(itemId).orElseThrow(ItemException::itemNotFound);
        var currentTicket = returnTickets.findUsable(scanTicketId, clock.instant())
                .orElseThrow(RentalException::scanProofUsed);
        if (!currentTicket.equals(ticket)) throw RentalException.rentalChanged();
        var activeTag = tags.findActiveByUid(ticket.uid()).orElseThrow(RentalException::rentalChanged);
        if (!activeTag.getItem().getId().equals(itemId)) throw RentalException.rentalChanged();
        var rental = rentals.findByItem_IdAndReturnedAtIsNull(itemId)
                .orElseThrow(RentalException::noActiveRental);

        // Pin the confirmation to the rental found when this physical tag was scanned. A stale
        // retry can never return a later rental of the same item.
        if (!rental.getId().equals(ticket.rentalId())) throw RentalException.rentalChanged();

        if (item.getStatus() != ItemStatus.RENTED) {
            throw RentalException.returnStateConflict();
        }
        if (returnTickets.consume(scanTicketId, clock.instant()).isEmpty()) throw RentalException.scanProofUsed();

        // Capture after acquiring the lock, at the same precision used for checkout timestamps.
        Instant returnedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        ItemStatus previousStatus = item.getStatus();
        ItemStatus nextStatus = condition == ReturnCondition.NORMAL ? ItemStatus.AVAILABLE : ItemStatus.INSPECTION;
        rental.markReturned(returnedAt, condition);
        item.updateStatus(nextStatus);

        // The status history flush also flushes the rental and item changes. All remain in this transaction.
        items.flush();
        history.saveAndFlush(new ItemStatusHistory(itemId, previousStatus, nextStatus,
                ItemStatusChangeSource.RENTAL_FLOW, null,
                condition == ReturnCondition.DAMAGED ? "반납 시 손상 확인, 점검 접수" : "정상 반납"));
        if (condition == ReturnCondition.DAMAGED) inspections.recordDamagedReturn(itemId);

        return new ReturnResult(rental.getId(), itemId, rental.getStatus(), item.getStatus(), condition,
                rental.getRentedAt(), rental.getDueAt(), returnedAt);
    }

    public record ReturnResult(Long rentalId, Long itemId, RentalStatus rentalStatus, ItemStatus itemStatus,
                               ReturnCondition condition,
                               Instant rentedAt, Instant dueAt, Instant returnedAt) {}
    public record ReturnScanResult(UUID scanTicketId, Long rentalId, Long itemId, String itemName,
                                   Long itemTypeId, String itemTypeName) {}
}
