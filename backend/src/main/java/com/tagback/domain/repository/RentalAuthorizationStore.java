package com.tagback.domain.repository;

import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.RentalStatus;
import com.tagback.service.RentalCheckoutService.CheckoutResult;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** JDBC uses the same DataSource/transaction as the JPA checkout writes. No raw credentials are stored. */
@Repository
public class RentalAuthorizationStore {
    private final JdbcTemplate jdbc;
    public RentalAuthorizationStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void lockIssuance() {
        jdbc.execute("select pg_advisory_xact_lock(20261014, 13)");
    }

    public void releaseExpiredCodes(Instant now) {
        jdbc.update("update rental_codes set code_hash = null where code_hash is not null and expires_at <= ?", ts(now));
    }

    public Optional<Code> activeCode(long userId) {
        return jdbc.query("select * from rental_codes where user_id = ? and code_hash is not null",
                (rs, n) -> code(rs), userId).stream().findFirst();
    }

    public long issuedSince(long userId, Instant since) {
        return jdbc.queryForObject("select count(*) from rental_codes where user_id = ? and created_at >= ?",
                Long.class, userId, ts(since));
    }

    public boolean insertCode(UUID id, long userId, String hash, Instant now, Instant expires) {
        return jdbc.update("insert into rental_codes (rental_code_id, user_id, code_hash, created_at, expires_at) "
                + "values (?, ?, ?, ?, ?) on conflict do nothing", id, userId, hash, ts(now), ts(expires)) == 1;
    }

    public Optional<Code> lockCodeByHash(String hash) {
        return jdbc.query("select * from rental_codes where code_hash = ? for update",
                (rs, n) -> code(rs), hash).stream().findFirst();
    }

    public Optional<Code> lockCode(UUID id) {
        return jdbc.query("select * from rental_codes where rental_code_id = ? for update",
                (rs, n) -> code(rs), id).stream().findFirst();
    }

    public void insertGrant(UUID id, UUID codeId, String hash, Instant now, Instant expires) {
        jdbc.update("insert into rental_grants (rental_grant_id, rental_code_id, token_hash, created_at, expires_at) "
                + "values (?, ?, ?, ?, ?)", id, codeId, hash, ts(now), ts(expires));
    }

    public Optional<Grant> grantByHash(String hash) {
        return jdbc.query("select rental_grant_id, rental_code_id, expires_at from rental_grants where token_hash = ?",
                (rs, n) -> new Grant(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                        rs.getTimestamp(3).toInstant()), hash).stream().findFirst();
    }

    public Optional<Grant> grantById(UUID id) {
        return jdbc.query("select rental_grant_id, rental_code_id, expires_at from rental_grants where rental_grant_id = ?",
                (rs, n) -> new Grant(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                        rs.getTimestamp(3).toInstant()), id).stream().findFirst();
    }

    public void consumeCode(UUID id, Instant now) {
        int changed = jdbc.update("update rental_codes set consumed_at = ?, code_hash = null "
                + "where rental_code_id = ? and consumed_at is null", ts(now), id);
        if (changed != 1) throw new IllegalStateException("Rental code consumption lost its lock");
    }

    public Optional<CheckoutResult> operation(UUID grantId, UUID key) {
        return jdbc.query("select * from rental_operations where rental_grant_id = ? and idempotency_key = ?",
                (rs, n) -> new CheckoutResult(rs.getLong("rental_id"), rs.getLong("item_id"), rs.getLong("item_type_id"),
                        RentalStatus.RENTED, ItemStatus.RENTED, rs.getTimestamp("rented_at").toInstant(),
                        rs.getTimestamp("due_at").toInstant(), null), grantId, key).stream().findFirst();
    }

    public void insertOperation(UUID grantId, UUID key, CheckoutResult result) {
        jdbc.update("insert into rental_operations (rental_grant_id, idempotency_key, item_id, item_type_id, "
                + "rental_id, rented_at, due_at) values (?, ?, ?, ?, ?, ?, ?)",
                grantId, key, result.itemId(), result.itemTypeId(), result.rentalId(), ts(result.rentedAt()), ts(result.dueAt()));
    }

    public long countAttempt(String scope, Instant window) {
        return jdbc.queryForObject("insert into rental_verification_limits (scope_hash, window_start, attempts) values (?, ?, 1) "
                + "on conflict (scope_hash) do update set window_start = excluded.window_start, "
                + "attempts = case when rental_verification_limits.window_start = excluded.window_start "
                + "then rental_verification_limits.attempts + 1 else 1 end returning attempts", Long.class, scope, ts(window));
    }

    private static Code code(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp consumed = rs.getTimestamp("consumed_at");
        return new Code(rs.getObject("rental_code_id", UUID.class), rs.getLong("user_id"),
                rs.getTimestamp("expires_at").toInstant(), consumed == null ? null : consumed.toInstant());
    }
    private static Timestamp ts(Instant instant) { return Timestamp.from(instant); }
    public record Code(UUID id, long userId, Instant expiresAt, Instant consumedAt) {}
    public record Grant(UUID id, UUID codeId, Instant expiresAt) {}
}
