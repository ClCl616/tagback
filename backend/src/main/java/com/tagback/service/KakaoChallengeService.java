package com.tagback.service;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

/** Development-only challenge verification; never logs codes, proofs or identifiers. */
@Service
@Profile(com.tagback.config.AuthProfiles.KAKAO)
public class KakaoChallengeService {
    private final JdbcTemplate db;
    private final Clock clock;
    private final byte[] key;
    private final String botId;
    private final Duration codeTtl;
    private final SecureRandom random = new SecureRandom();

    public KakaoChallengeService(JdbcTemplate db, Clock clock,
            @Value("${tagback.kakao.hmac-key:}") String key,
            @Value("${tagback.kakao.bot-id:}") String botId,
            @Value("${tagback.kakao.code-ttl-seconds:300}") long codeTtlSeconds) {
        if (key == null || key.length() < 32 || botId == null || botId.isBlank() || botId.length() > 100)
            throw new IllegalStateException("Kakao authentication requires a secret key and bot ID");
        if (codeTtlSeconds < 30 || codeTtlSeconds > 600) throw new IllegalArgumentException("Invalid Kakao code TTL");
        this.db = db; this.clock = clock; this.key = key.getBytes(StandardCharsets.UTF_8); this.botId = botId;
        this.codeTtl = Duration.ofSeconds(codeTtlSeconds);
    }

    public String newProof() {
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public boolean validProof(String value) { return value != null && value.matches("[A-Za-z0-9_-]{43}"); }

    @Transactional(propagation = Propagation.MANDATORY)
    public void deleteIdentityRateLimit(String botId, String userId) {
        db.update("delete from kakao_auth_rate_limits where scope='skill-user' and subject_hmac=?",
                hash("rate:skill-user", botId + ":" + userId));
    }

    /** Must be called within the caller's transaction; locks the proof until it commits. */
    @Transactional(propagation = Propagation.MANDATORY)
    public LockedChallenge lockForCompletion(UUID id, String proof) {
        if (id == null || !validProof(proof)) throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
        var rows = db.query("select purpose,status,expires_at,bot_id,bot_user_key from kakao_auth_challenges where challenge_id=? and browser_proof_hmac=? for update",
                (rs, n) -> new LockedChallenge(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant(), rs.getString(4), rs.getString(5)), id, hash("browser", proof));
        if (rows.isEmpty()) throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
        return rows.getFirst();
    }

    public record LockedChallenge(String purpose, String status, Instant expiresAt, String botId, String userId) {
        @Override public String toString() { return "LockedChallenge[redacted]"; }
    }

    @Transactional
    public Issued issue(String purpose, String proof, String remote) {
        if (!List.of("SIGNUP", "LOGIN", "PIN_RESET").contains(purpose) || !validProof(proof))
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        Instant now = clock.instant();
        if (!allow("issue-address", remote, 20, now) || !allow("issue-browser", proof, 5, now))
            throw new AuthException(AuthErrorCode.KAKAO_REQUEST_LIMIT_EXCEEDED);
        byte[] owner = hash("browser", proof);
        // Serialize concurrent reissues for the same browser, including across purposes.
        db.queryForObject("select pg_advisory_xact_lock(hashtextextended(?, 0))", (rs, row) -> 0,
                "kakao-issue:" + HexFormat.of().formatHex(owner));
        db.update("update kakao_auth_challenges set status='CANCELED' where browser_proof_hmac=? and status in ('PENDING','VERIFIED')", owner);
        db.update("update kakao_auth_challenges set status='EXPIRED' where expires_at <= ? and status in ('PENDING','VERIFIED')", Timestamp.from(now));
        Instant expiry = now.plus(codeTtl);
        for (int i = 0; i < 10; i++) {
            String code = String.format(Locale.ROOT, "%010d", random.nextLong(10_000_000_000L));
            UUID id = UUID.randomUUID();
            int inserted = db.update("insert into kakao_auth_challenges(challenge_id,purpose,status,code_hmac,browser_proof_hmac,created_at,expires_at) values (?,?,'PENDING',?,?,?,?) on conflict do nothing",
                    id, purpose, hash("code", code), owner, Timestamp.from(now), Timestamp.from(expiry));
            if (inserted == 1) return new Issued(id, code, expiry);
        }
        throw new IllegalStateException("Unable to allocate a challenge");
    }

    @Transactional(readOnly = true)
    public Status status(UUID id, String proof) {
        if (!validProof(proof)) throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
        var rows = db.query("select purpose,status,expires_at from kakao_auth_challenges where challenge_id=? and browser_proof_hmac=?",
                (rs, n) -> new Status(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant()), id, hash("browser", proof));
        if (rows.isEmpty()) throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
        var result = rows.getFirst();
        if ((result.status().equals("PENDING") || result.status().equals("VERIFIED")) && !result.expiresAt().isAfter(clock.instant()))
            return new Status(result.purpose(), "EXPIRED", result.expiresAt());
        return result;
    }

    @Transactional
    public void cancel(UUID id, String proof) {
        if (!validProof(proof)) throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
        if (db.update("update kakao_auth_challenges set status='CANCELED' where challenge_id=? and browser_proof_hmac=? and status in ('PENDING','VERIFIED')", id, hash("browser", proof)) != 1)
            throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
    }

    @Transactional
    public boolean verify(Map<String, Object> payload, String remote) {
        Instant now = clock.instant();
        if (!allow("skill-global", "all", 60, now) || !allow("skill-address", remote, 30, now)) return false;
        if (!(payload.get("bot") instanceof Map<?, ?> bot) || !botId.equals(bot.get("id")) ||
                !(payload.get("userRequest") instanceof Map<?, ?> req) ||
                !(req.get("user") instanceof Map<?, ?> user) || !"botUserKey".equals(user.get("type")) ||
                !(user.get("id") instanceof String userId) || userId.isBlank() || userId.length() > 70 ||
                !(req.get("utterance") instanceof String code) || !code.matches("[0-9]{10}")) return false;
        if (!allow("skill-user", botId + ":" + userId, 5, now)) return false;
        var rows = db.query("select challenge_id,status,bot_id,bot_user_key from kakao_auth_challenges where code_hmac=? and status in ('PENDING','VERIFIED') and expires_at>? for update",
                (rs,n) -> new Existing(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4)), hash("code", code), Timestamp.from(now));
        if (rows.isEmpty()) return false;
        var c = rows.getFirst();
        if ("VERIFIED".equals(c.status())) return botId.equals(c.botId()) && userId.equals(c.userId());
        return db.update("update kakao_auth_challenges set status='VERIFIED',bot_id=?,bot_user_key=?,verified_at=? where challenge_id=? and status='PENDING' and expires_at>?",
                botId, userId, Timestamp.from(now), c.id(), Timestamp.from(now)) == 1;
    }

    private boolean allow(String scope, String subject, int max, Instant now) {
        if (subject == null || subject.isBlank() || subject.length() > 256) subject = "unknown";
        Integer count = db.queryForObject("insert into kakao_auth_rate_limits(scope,subject_hmac,window_started_at,request_count) values (?,?,?,1) on conflict (scope,subject_hmac) do update set request_count=case when kakao_auth_rate_limits.window_started_at <= ? then 1 else kakao_auth_rate_limits.request_count+1 end, window_started_at=case when kakao_auth_rate_limits.window_started_at <= ? then excluded.window_started_at else kakao_auth_rate_limits.window_started_at end returning request_count",
                Integer.class, scope, hash("rate:" + scope, subject), Timestamp.from(now), Timestamp.from(now.minusSeconds(60)), Timestamp.from(now.minusSeconds(60)));
        return count != null && count <= max;
    }

    private byte[] hash(String domain, String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal((domain + "\0" + input).getBytes(StandardCharsets.UTF_8));
        } catch (java.security.GeneralSecurityException e) { throw new IllegalStateException("HMAC unavailable", e); }
    }

    public record Issued(UUID id, String code, Instant expiresAt) { @Override public String toString() { return "Issued[redacted]"; } }
    public record Status(String purpose, String status, Instant expiresAt) {}
    private record Existing(UUID id, String status, String botId, String userId) { @Override public String toString() { return "Existing[redacted]"; } }
}
