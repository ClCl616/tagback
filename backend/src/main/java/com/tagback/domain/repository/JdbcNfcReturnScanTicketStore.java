package com.tagback.domain.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcNfcReturnScanTicketStore implements NfcReturnScanTicketStore {
    private final JdbcTemplate jdbc;

    public JdbcNfcReturnScanTicketStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UUID create(String bridgeId, String uid, UUID proofNonce, Long itemId, Long rentalId, Instant now, Instant expiresAt) {
        jdbc.update("delete from nfc_return_scan_tickets where consumed_at is not null or expires_at <= ?",
                Timestamp.from(now));
        UUID ticketId = UUID.randomUUID();
        jdbc.update("insert into nfc_return_scan_tickets (ticket_id, bridge_id, tag_uid, proof_nonce, item_id, rental_id, expires_at) "
                        + "values (?, ?, ?, ?, ?, ?, ?)",
                ticketId, bridgeId, uid, proofNonce, itemId, rentalId, Timestamp.from(expiresAt));
        return ticketId;
    }

    @Override
    public Optional<Ticket> findUsable(UUID ticketId, Instant now) {
        return jdbc.query("select ticket_id, bridge_id, tag_uid, proof_nonce, item_id, rental_id, expires_at "
                        + "from nfc_return_scan_tickets where ticket_id = ? and consumed_at is null and expires_at > ?",
                (rs, row) -> new Ticket(rs.getObject("ticket_id", UUID.class), rs.getString("bridge_id"),
                        rs.getString("tag_uid"), rs.getObject("proof_nonce", UUID.class), rs.getLong("item_id"),
                        rs.getLong("rental_id"), rs.getTimestamp("expires_at").toInstant()),
                ticketId, Timestamp.from(now)).stream().findFirst();
    }

    @Override
    public Optional<Ticket> consume(UUID ticketId, Instant now) {
        return jdbc.query("update nfc_return_scan_tickets set consumed_at = ? "
                        + "where ticket_id = ? and consumed_at is null and expires_at > ? "
                        + "returning ticket_id, bridge_id, tag_uid, proof_nonce, item_id, rental_id, expires_at",
                (rs, row) -> new Ticket(rs.getObject("ticket_id", UUID.class), rs.getString("bridge_id"),
                        rs.getString("tag_uid"), rs.getObject("proof_nonce", UUID.class), rs.getLong("item_id"),
                        rs.getLong("rental_id"), rs.getTimestamp("expires_at").toInstant()),
                Timestamp.from(now), ticketId, Timestamp.from(now)).stream().findFirst();
    }
}
