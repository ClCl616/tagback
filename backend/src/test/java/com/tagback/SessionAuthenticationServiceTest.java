package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.exception.*;
import com.tagback.service.SessionService;
import com.tagback.service.sms.SmsSecrets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SessionAuthenticationServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final LoginSessionRepository sessions = mock(LoginSessionRepository.class);
    private final Instant now = Instant.parse("2026-10-06T09:00:00Z");
    private final SmsSecrets secrets = new SmsSecrets("test-only-key-for-session-authentication");
    private final User user = mock(User.class);
    private BrowserRegistration browser;
    private LoginSession session;
    private SessionService service;

    @BeforeEach void setup() {
        when(user.getId()).thenReturn(7L);
        when(user.getRole()).thenReturn(UserRole.USER);
        browser = new BrowserRegistration(user, "browser-hash", now.plus(Duration.ofDays(30)), now.minusSeconds(60));
        session = new LoginSession(browser, secrets.tokenHash("test-session"), now.plusSeconds(60),
                now.plus(Duration.ofHours(8)), now.minusSeconds(60));
        when(sessions.findUserIdByTokenHash(secrets.tokenHash("test-session"))).thenReturn(Optional.of(7L));
        when(users.findByIdForUpdate(7L)).thenReturn(Optional.of(user));
        when(sessions.findBySessionTokenHash(secrets.tokenHash("test-session"))).thenReturn(Optional.of(session));
        service = new SessionService(users, mock(BrowserRegistrationRepository.class), sessions,
                secrets, null, Clock.fixed(now, ZoneOffset.UTC));
    }

    @Test void authenticationReadsCurrentRoleAndDoesNotExtendExpiry() {
        var lastActivity = session.getLastActivityAt();
        var idleExpiry = session.getIdleExpiresAt();
        var browserExpiry = browser.getExpiresAt();
        assertEquals(UserRole.USER, service.authenticate("test-session").role());
        when(user.getRole()).thenReturn(UserRole.ADMIN);
        var identity = service.authenticate("test-session");
        assertEquals(7L, identity.userId());
        assertEquals(UserRole.ADMIN, identity.role());
        assertEquals(lastActivity, session.getLastActivityAt());
        assertEquals(idleExpiry, session.getIdleExpiresAt());
        assertEquals(browserExpiry, browser.getExpiresAt());
    }

    @Test void missingBlankAndUnknownSessionsAreRejected() {
        for (String token : new String[]{null, "", " ", "unknown"}) {
            assertEquals(AuthErrorCode.SESSION_REQUIRED,
                    assertThrows(AuthException.class, () -> service.authenticate(token)).code());
        }
    }

    @Test void idleExpiryBoundaryRevokesSession() {
        session.recordActivity(now.minusSeconds(60), now);
        assertEquals(AuthErrorCode.SESSION_EXPIRED,
                assertThrows(AuthException.class, () -> service.authenticate("test-session")).code());
        assertEquals(SessionRevokedReason.EXPIRED, session.getRevokedReason());
    }

    @Test void absoluteExpiryBoundaryRejectsEvenWithFutureIdleExpiry() {
        session = new LoginSession(browser, secrets.tokenHash("test-session"), now.plusSeconds(60), now, now.minusSeconds(60));
        when(sessions.findBySessionTokenHash(secrets.tokenHash("test-session"))).thenReturn(Optional.of(session));
        assertEquals(AuthErrorCode.SESSION_EXPIRED,
                assertThrows(AuthException.class, () -> service.authenticate("test-session")).code());
    }

    @Test void revokedBrowserRejectsItsSession() {
        browser.revoke(now);
        assertEquals(AuthErrorCode.SESSION_REQUIRED,
                assertThrows(AuthException.class, () -> service.authenticate("test-session")).code());
        assertEquals(SessionRevokedReason.REGISTRATION_REMOVED, session.getRevokedReason());
    }

    @Test void expiredBrowserRejectsAndRevokesItsSession() {
        browser.renew(now.minusSeconds(60), now);
        assertEquals(AuthErrorCode.SESSION_EXPIRED,
                assertThrows(AuthException.class, () -> service.authenticate("test-session")).code());
        assertEquals(now, browser.getRevokedAt());
    }

    @Test void replacedAndLoggedOutSessionsAreRejected() {
        session.revoke(now, SessionRevokedReason.SESSION_REPLACED);
        assertEquals(AuthErrorCode.SESSION_REPLACED,
                assertThrows(AuthException.class, () -> service.authenticate("test-session")).code());
        session = new LoginSession(browser, secrets.tokenHash("test-session"), now.plusSeconds(60), now.plusSeconds(600), now);
        session.revoke(now, SessionRevokedReason.LOGOUT);
        when(sessions.findBySessionTokenHash(secrets.tokenHash("test-session"))).thenReturn(Optional.of(session));
        assertEquals(AuthErrorCode.SESSION_REQUIRED,
                assertThrows(AuthException.class, () -> service.authenticate("test-session")).code());
    }
}
