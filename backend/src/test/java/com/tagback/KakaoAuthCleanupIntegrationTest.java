package com.tagback;

import com.tagback.service.KakaoAuthCleanupService;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import static org.junit.jupiter.api.Assertions.assertEquals;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@ActiveProfiles("kakao-auth")
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
    "spring.datasource.username=postgres", "spring.datasource.password=",
    "tagback.kakao.hmac-key=development-test-only-hmac-key-at-least-32-characters",
    "tagback.kakao.skill-secret=development-test-only-header-key-at-least-32-characters",
    "tagback.auth.common-hash-key=development-test-only-common-key-at-least-32-characters",
    "tagback.kakao.bot-id=test-bot", "tagback.kakao.cleanup-initial-delay-ms=86400000"
})
class KakaoAuthCleanupIntegrationTest {
    @Autowired JdbcTemplate db;

    @Test void removesOnlyRecordsPastRetentionAndKeepsRetryAndOtherOperations() {
        Instant now = Instant.parse("2026-11-19T08:00:00Z");
        var cleanup = new KakaoAuthCleanupService(db, Clock.fixed(now, ZoneOffset.UTC));
        UUID old = UUID.randomUUID();
        UUID recent = UUID.randomUUID();
        UUID active = UUID.randomUUID();
        insertChallenge(old, now.minus(Duration.ofHours(25)));
        insertChallenge(recent, now.minus(Duration.ofHours(23)));
        insertChallenge(active, now.plusSeconds(300));
        UUID oldOp = insertOperation("KAKAO_NEW_BROWSER_LOGIN", now.minus(Duration.ofHours(25)));
        UUID recentOp = insertOperation("KAKAO_SIGNUP", now.minus(Duration.ofHours(23)));
        UUID otherOp = insertOperation("REGISTERED_LOGIN", now.minus(Duration.ofHours(25)));
        db.update("insert into kakao_auth_rate_limits(scope,subject_hmac,window_started_at,request_count) values ('test-old',decode(repeat('01',32),'hex'),?,1),('test-recent',decode(repeat('02',32),'hex'),?,1)",
                Timestamp.from(now.minus(Duration.ofHours(25))), Timestamp.from(now.minusSeconds(30)));

        cleanup.deleteExpiredRecords();

        assertEquals(0, count("kakao_auth_challenges", "challenge_id", old));
        assertEquals(1, count("kakao_auth_challenges", "challenge_id", recent));
        assertEquals(1, count("kakao_auth_challenges", "challenge_id", active));
        assertEquals(0, count("auth_operations", "operation_id", oldOp));
        assertEquals(1, count("auth_operations", "operation_id", recentOp));
        assertEquals(1, count("auth_operations", "operation_id", otherOp));
        assertEquals(0, db.queryForObject("select count(*) from kakao_auth_rate_limits where scope='test-old'", Integer.class));
        assertEquals(1, db.queryForObject("select count(*) from kakao_auth_rate_limits where scope='test-recent'", Integer.class));
    }

    private void insertChallenge(UUID id, Instant expiry) {
        db.update("insert into kakao_auth_challenges(challenge_id,purpose,status,code_hmac,browser_proof_hmac,created_at,expires_at) values (?,'LOGIN','EXPIRED',decode(repeat('03',32),'hex'),decode(repeat('04',32),'hex'),?,?)",
                id, Timestamp.from(expiry.minusSeconds(300)), Timestamp.from(expiry));
    }

    private UUID insertOperation(String type, Instant expiry) {
        UUID id = UUID.randomUUID();
        db.update("insert into auth_operations(operation_id,caller_scope_hash,operation_type,idempotency_key,request_fingerprint,created_at,expires_at) values (?,?,?,?,?,?,?)",
                id, id.toString(), type, id.toString(), "test", Timestamp.from(expiry.minusSeconds(300)), Timestamp.from(expiry));
        return id;
    }

    private int count(String table, String column, UUID id) {
        return db.queryForObject("select count(*) from " + table + " where " + column + "=?", Integer.class, id);
    }
}
