package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.dao.DataIntegrityViolationException;
import java.time.Instant;
import java.time.Duration;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate"})
@Transactional
class AuthSchemaIntegrationTest {
    @Autowired UserRepository users;
    @Autowired BrowserRegistrationRepository browsers;
    @Autowired LoginSessionRepository sessions;
    @Autowired AuthOperationRepository operations;
    @Autowired JdbcTemplate jdbc;

    private final Instant now = Instant.parse("2026-10-06T09:00:00Z");
    private String token() { return UUID.randomUUID().toString(); }
    private User user(String phone) {
        return users.saveAndFlush(new User(phone, "test-only-pin-hash", now));
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
