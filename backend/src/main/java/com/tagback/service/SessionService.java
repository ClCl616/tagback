package com.tagback.service;

import com.tagback.config.AuthProperties;
import com.tagback.config.AuthenticatedUser;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.exception.*;
import com.tagback.service.sms.SmsSecrets;
import java.time.Clock;
import java.time.Instant;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("sms-mock & !prod & !production")
public class SessionService {
    private final UserRepository users;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final SmsSecrets secrets;
    private final AuthProperties policy;
    private final Clock clock;

    public SessionService(UserRepository users, BrowserRegistrationRepository browsers, LoginSessionRepository sessions,
                          SmsSecrets secrets, AuthProperties policy, Clock clock) {
        this.users = users; this.browsers = browsers; this.sessions = sessions;
        this.secrets = secrets; this.policy = policy; this.clock = clock;
    }

    @Transactional
    public AuthResponses.BrowserStatus registration(String browserToken) {
        if (missing(browserToken)) return unregistered();
        String hash = secrets.tokenHash(browserToken);
        var userId = browsers.findUserIdByTokenHash(hash);
        if (userId.isEmpty() || users.findByIdForUpdate(userId.get()).isEmpty()) return unregistered();
        var found = browsers.findByRegistrationTokenHash(hash);
        if (found.isEmpty() || found.get().getRevokedAt() != null) return unregistered();
        var browser = found.get();
        Instant now = clock.instant();
        if (!browser.getExpiresAt().isAfter(now)) {
            sessions.revokeForRegistration(browser.getId(), now, SessionRevokedReason.EXPIRED);
            browser.revoke(now);
            return unregistered();
        }
        return new AuthResponses.BrowserStatus(true, mask(browser.getUser().getPhoneNumber()), browser.getExpiresAt());
    }

    // Request authentication does not count as user activity or extend any expiry.
    @Transactional(noRollbackFor = SessionInvalid.class)
    public AuthenticatedUser authenticate(String sessionToken) {
        var user = requireValid(sessionToken).getUser();
        return new AuthenticatedUser(user.getId(), user.getRole());
    }

    // Status polling intentionally does not refresh inactivity or registration expiry.
    @Transactional(noRollbackFor = SessionInvalid.class)
    public AuthResponses.SessionStatus current(String sessionToken) {
        return status(requireValid(sessionToken));
    }

    // Call only for a real user action, never from background polling/heartbeats.
    @Transactional(noRollbackFor = SessionInvalid.class)
    public AuthResponses.SessionStatus activity(String sessionToken) {
        var session = requireValid(sessionToken);
        Instant now = clock.instant();
        // Recheck after acquiring locks and before extending; an expired session cannot be revived.
        expireIfNeeded(session, now);
        Instant idleExpiry = now.plus(policy.sessionIdleTimeout());
        if (idleExpiry.isAfter(session.getAbsoluteExpiresAt())) idleExpiry = session.getAbsoluteExpiresAt();
        session.recordActivity(now, idleExpiry);
        return status(session);
    }

    @Transactional
    public void logout(String sessionToken) {
        var session = findLocked(sessionToken);
        if (session != null) session.revoke(clock.instant(), SessionRevokedReason.LOGOUT);
    }

    @Transactional
    public void unregister(String browserToken, String sessionToken) {
        if (missing(browserToken)) { logout(sessionToken); return; }
        String hash = secrets.tokenHash(browserToken);
        var userId = browsers.findUserIdByTokenHash(hash);
        if (userId.isEmpty()) { logout(sessionToken); return; }
        if (users.findByIdForUpdate(userId.get()).isEmpty()) return;
        var found = browsers.findByRegistrationTokenHash(hash);
        if (found.isEmpty()) return;
        var browser = found.get();
        // Only this registration's sessions; stale cookies must not revoke a newer browser.
        sessions.revokeForRegistration(browser.getId(), clock.instant(), SessionRevokedReason.REGISTRATION_REMOVED);
        browser.revoke(clock.instant());
    }

    private LoginSession requireValid(String token) {
        var session = findLocked(token);
        if (session == null) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
        if (session.getRevokedAt() != null) {
            AuthErrorCode code = switch (session.getRevokedReason()) {
                case SESSION_REPLACED -> AuthErrorCode.SESSION_REPLACED;
                case EXPIRED -> AuthErrorCode.SESSION_EXPIRED;
                default -> AuthErrorCode.SESSION_REQUIRED;
            };
            throw new AuthException(code);
        }
        expireIfNeeded(session, clock.instant());
        return session;
    }

    private LoginSession findLocked(String token) {
        if (missing(token)) return null;
        String hash = secrets.tokenHash(token);
        var userId = sessions.findUserIdByTokenHash(hash);
        if (userId.isEmpty() || users.findByIdForUpdate(userId.get()).isEmpty()) return null;
        return sessions.findBySessionTokenHash(hash).orElse(null);
    }

    private void expireIfNeeded(LoginSession session, Instant now) {
        var browser = session.getBrowserRegistration();
        if (browser.getRevokedAt() != null) {
            session.revoke(now, SessionRevokedReason.REGISTRATION_REMOVED);
            throw new SessionInvalid(AuthErrorCode.SESSION_REQUIRED);
        }
        if (!session.getIdleExpiresAt().isAfter(now) || !session.getAbsoluteExpiresAt().isAfter(now)
                || !browser.getExpiresAt().isAfter(now)) {
            session.revoke(now, SessionRevokedReason.EXPIRED);
            if (!browser.getExpiresAt().isAfter(now)) browser.revoke(now);
            throw new SessionInvalid(AuthErrorCode.SESSION_EXPIRED);
        }
    }

    private AuthResponses.SessionStatus status(LoginSession session) {
        var user = session.getUser();
        var summary = new AuthResponses.UserSummary(user.getId().toString(), mask(user.getPhoneNumber()), user.getRole().name(), user.getName(), user.getOccupation());
        return new AuthResponses.SessionStatus(true, summary, session.getIdleExpiresAt());
    }
    private AuthResponses.BrowserStatus unregistered() { return new AuthResponses.BrowserStatus(false, null, null); }
    private boolean missing(String token) { return token == null || token.isBlank(); }
    private String mask(String phone) { return "010-****-" + phone.substring(phone.length() - 4); }
    public static final class SessionInvalid extends AuthException {
        public SessionInvalid(AuthErrorCode code) { super(code); }
    }
}
