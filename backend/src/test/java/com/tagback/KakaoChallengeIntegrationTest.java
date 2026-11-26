package com.tagback;

import com.tagback.exception.AuthException;
import com.tagback.service.KakaoChallengeService;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@ActiveProfiles("kakao-auth")
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
    "spring.datasource.username=postgres", "spring.datasource.password=",
    "tagback.kakao.hmac-key=development-test-only-hmac-key-at-least-32-characters",
    "tagback.kakao.skill-secret=development-test-only-header-key-at-least-32-characters",
    "tagback.auth.common-hash-key=development-test-only-common-key-at-least-32-characters",
    "tagback.kakao.bot-id=test-bot"
})
class KakaoChallengeIntegrationTest {
    @Autowired KakaoChallengeService service;
    @Autowired JdbcTemplate db;

    @Test void bindsVerificationToBrowserAndPurposeAndInvalidatesOnReissue() {
        String proof = service.newProof();
        String other = service.newProof();
        var first = service.issue("SIGNUP", proof, "test-address");
        assertEquals("SIGNUP", service.status(first.id(), proof).purpose());
        assertThrows(AuthException.class, () -> service.status(first.id(), other));
        var firstPayload = payload(first.code(), "user-a");
        assertTrue(service.verify(firstPayload, "test-skill-address"));
        assertTrue(service.verify(firstPayload, "test-skill-address")); // Kakao retry
        assertFalse(service.verify(payload(first.code(), "user-b"), "test-skill-address"));
        assertEquals("VERIFIED", service.status(first.id(), proof).status());
        var next = service.issue("PIN_RESET", proof, "test-address");
        assertEquals("CANCELED", service.status(first.id(), proof).status());
        assertFalse(service.verify(firstPayload, "test-skill-address"));
        assertEquals("PIN_RESET", service.status(next.id(), proof).purpose());
        assertThrows(AuthException.class, () -> service.cancel(next.id(), other));
        service.cancel(next.id(), proof);
        assertEquals("CANCELED", service.status(next.id(), proof).status());
        assertFalse(service.verify(payload(next.code(), "user-a"), "test-skill-address"));
    }

    @Test void expiredAndWrongBotRequestsCannotVerify() {
        var proof = service.newProof();
        var challenge = service.issue("LOGIN", proof, "expiry-address");
        var badBot = Map.<String,Object>of("bot", Map.of("id", "wrong"), "userRequest", Map.of(
                "utterance", challenge.code(), "user", Map.of("id", "expiry-user", "type", "botUserKey")));
        assertFalse(service.verify(badBot, "expiry-skill"));
        db.update("update kakao_auth_challenges set created_at=now()-interval '10 minutes', expires_at=now()-interval '1 second' where challenge_id=?", challenge.id());
        assertEquals("EXPIRED", service.status(challenge.id(), proof).status());
        assertFalse(service.verify(payload(challenge.code(), "expiry-user"), "expiry-skill"));
    }

    @Test void competingUsersCannotBothClaimOneCode() throws Exception {
        var challenge = service.issue("LOGIN", service.newProof(), "race-address");
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> { start.await(); return service.verify(payload(challenge.code(), "race-a"), "race-skill"); });
            var b = pool.submit(() -> { start.await(); return service.verify(payload(challenge.code(), "race-b"), "race-skill"); });
            start.countDown();
            assertNotEquals(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
        }
    }

    @Test void issuanceAndSkillAttemptsAreRateLimited() {
        String proof = service.newProof();
        KakaoChallengeService.Issued challenge = null;
        for (int i = 0; i < 5; i++) challenge = service.issue("LOGIN", proof, "limit-issue");
        assertThrows(AuthException.class, () -> service.issue("LOGIN", proof, "limit-issue"));
        var last = challenge;
        for (int i = 0; i < 5; i++) assertFalse(service.verify(payload("9999999999", "limit-user"), "limit-skill"));
        assertFalse(service.verify(payload(last.code(), "limit-user"), "limit-skill"));
        assertEquals("PENDING", service.status(last.id(), proof).status());
    }

    private Map<String,Object> payload(String code, String user) {
        return Map.of("bot", Map.of("id", "test-bot"), "userRequest", Map.of(
                "utterance", code, "user", Map.of("id", user, "type", "botUserKey")));
    }
}
