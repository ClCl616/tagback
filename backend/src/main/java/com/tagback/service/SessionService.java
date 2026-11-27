package com.tagback.service;

import com.tagback.config.AuthProperties;
import com.tagback.config.AuthenticatedUser;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.exception.*;
import com.tagback.service.AuthSecrets;
import java.time.Clock;
import java.time.Instant;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SessionService {
    private final UserRepository users;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final AuthSecrets secrets;
    private final AuthProperties policy;
    private final Clock clock;

    public SessionService(UserRepository users, BrowserRegistrationRepository browsers, LoginSessionRepository sessions,
                          AuthSecrets secrets, AuthProperties policy, Clock clock) {
        this.users = users; this.browsers = browsers; this.sessions = sessions;
        this.secrets = secrets; this.policy = policy; this.clock = clock;
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
    private boolean missing(String token) { return token == null || token.isBlank(); }
    private String mask(String phone) { return phone == null ? "" : "010-****-" + phone.substring(phone.length() - 4); }
    public static final class SessionInvalid extends AuthException {
        public SessionInvalid(AuthErrorCode code) { super(code); }
    }
}
