package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.SmsPurpose;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import java.time.Instant;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate"})
@Transactional
class AuthSchemaIntegrationTest {
    @Autowired UserRepository users;
    @Autowired SmsRequestGateRepository gates;
    @Autowired SmsVerificationRepository sms;
    @Autowired VerificationGrantRepository grants;
    @Autowired BrowserRegistrationRepository browsers;
    @Autowired LoginSessionRepository sessions;
    @Autowired AuthOperationRepository operations;
    @Autowired EntityManager em;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-10-06T09:00:00Z");
    private String token() { return UUID.randomUUID().toString(); }
    private User user(String phone) {
        return users.saveAndFlush(new User(phone, "test-only-pin-hash", now));
    }
    private SmsVerification verifiedSms(String phone, SmsPurpose purpose) {
        gates.ensureExists(phone);
        assertTrue(gates.findForUpdate(phone).isPresent());
        var request = sms.saveAndFlush(new SmsVerification(phone, purpose, "test-only-code-hash",
                now.plusSeconds(300), now.plusSeconds(60), now));
        assertEquals(1, sms.completeDelivery(request.getId(), SmsDeliveryStatus.SENT, now));
        assertEquals(1, sms.markVerified(request.getId(), now));
        em.clear();
        return sms.findById(request.getId()).orElseThrow();
    }

    @Test
    void consumesGrantOnlyOnceForCorrectPurposeAndNumber() {
        var request = verifiedSms("+821022222222", SmsPurpose.SIGNUP);
        var grant = grants.saveAndFlush(new VerificationGrant(request, token(), now.plusSeconds(600), now));
        assertTrue(grants.findByTokenHashForUpdate(grant.getTokenHash()).isPresent());
        assertEquals(0, grants.consumeIfAvailable(grant.getId(), request.getPhoneNumber(), SmsPurpose.LOGIN, now));
        assertEquals(0, grants.consumeIfAvailable(grant.getId(), "+821099999999", SmsPurpose.SIGNUP, now));
        assertEquals(1, grants.consumeIfAvailable(grant.getId(), request.getPhoneNumber(), SmsPurpose.SIGNUP, now));
        assertEquals(0, grants.consumeIfAvailable(grant.getId(), request.getPhoneNumber(), SmsPurpose.SIGNUP, now));
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void concurrentConsumptionHasExactlyOneWinner() throws Exception {
        var tx = new TransactionTemplate(transactionManager);
        String phone = "+821099990001";
        var grant = tx.execute(status -> grants.saveAndFlush(new VerificationGrant(
                verifiedSms(phone, SmsPurpose.LOGIN), token(), now.plusSeconds(600), now)));
        assertNotNull(grant);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var ready = new CountDownLatch(2);
            var start = new CountDownLatch(1);
            java.util.concurrent.Callable<Integer> consume = () -> {
                ready.countDown();
                if (!start.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Test start timeout");
                return tx.execute(status -> grants.consumeIfAvailable(grant.getId(), phone, SmsPurpose.LOGIN, now));
            };
            var first = executor.submit(consume);
            var second = executor.submit(consume);
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            assertEquals(1, first.get(10, TimeUnit.SECONDS) + second.get(10, TimeUnit.SECONDS));
        } finally {
            tx.executeWithoutResult(status -> {
                jdbc.update("delete from verification_grants where verification_grant_id = ?", grant.getId());
                jdbc.update("delete from sms_verifications where phone_number = ?", phone);
                jdbc.update("delete from sms_request_gates where phone_number = ?", phone);
            });
        }
    }

    @Test
    void countsAllSmsPurposesAndInvalidatesPreviousRequest() {
        verifiedSms("+821044444444", SmsPurpose.SIGNUP);
        verifiedSms("+821044444444", SmsPurpose.LOGIN);
        assertEquals(2, sms.countSentSince("+821044444444", now.minus(Duration.ofHours(24))));
        assertEquals(0, sms.countSentSince("+821044444444", now));
        var pending = sms.saveAndFlush(new SmsVerification("+821044444444", SmsPurpose.SIGNUP,
                token(), now.plusSeconds(300), now.plusSeconds(60), now));
        var otherPurpose = sms.saveAndFlush(new SmsVerification("+821044444444", SmsPurpose.LOGIN,
                token(), now.plusSeconds(300), now.plusSeconds(60), now));
        assertEquals(2, sms.countByPhoneNumberAndDeliveryStatus(pending.getPhoneNumber(), SmsDeliveryStatus.PENDING));
        assertEquals(2, sms.invalidateUnfinished(pending.getPhoneNumber(), now));
        em.clear();
        assertEquals(now, sms.findById(pending.getId()).orElseThrow().getInvalidatedAt());
        assertEquals(now, sms.findById(otherPurpose.getId()).orElseThrow().getInvalidatedAt());
    }

    @Test
    void enforcesSingleNotRevokedBrowser() {
        var user = user("+821055555555");
        browsers.saveAndFlush(new BrowserRegistration(user, token(), now.plus(Duration.ofDays(30)), now));
        assertThrows(DataIntegrityViolationException.class, () ->
                browsers.saveAndFlush(new BrowserRegistration(user, token(), now.plus(Duration.ofDays(30)), now)));
    }

    @Test
    void databaseRejectsSessionFromAnotherUsersRegistration() {
        var first = user("+821077777777");
        var other = user("+821088888888");
        var browser = browsers.saveAndFlush(new BrowserRegistration(first, token(), now.plusSeconds(3600), now));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "insert into login_sessions(login_session_id, user_id, browser_registration_id, session_token_hash, last_activity_at, idle_expires_at, absolute_expires_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), other.getId(), browser.getId(), token(), java.sql.Timestamp.from(now),
                java.sql.Timestamp.from(now.plusSeconds(1800)), java.sql.Timestamp.from(now.plusSeconds(3600)), java.sql.Timestamp.from(now)));
    }

    @Test
    void scopesIdempotencyLookupToCallerAndOperation() {
        var operation = operations.saveAndFlush(new AuthOperation(token(), "SIGNUP", token(), token(), now.plusSeconds(600), now));
        assertTrue(operations.findForUpdate(operation.getCallerScopeHash(), "SIGNUP", operation.getIdempotencyKey()).isPresent());
        assertTrue(operations.findForUpdate(operation.getCallerScopeHash(), "LOGIN", operation.getIdempotencyKey()).isEmpty());
        assertTrue(operations.findByIdAndCallerScopeHash(operation.getId(), token()).isEmpty());
    }
}
