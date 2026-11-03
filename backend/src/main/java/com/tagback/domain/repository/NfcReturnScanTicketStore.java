package com.tagback.domain.repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface NfcReturnScanTicketStore {
    UUID create(String bridgeId, String uid, UUID proofNonce, Long itemId, Long rentalId, Instant now, Instant expiresAt);
    Optional<Ticket> findUsable(UUID ticketId, Instant now);
    Optional<Ticket> consume(UUID ticketId, Instant now);

    record Ticket(UUID id, String bridgeId, String uid, UUID proofNonce, Long itemId, Long rentalId, Instant expiresAt) {}
}
