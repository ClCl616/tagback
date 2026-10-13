package com.tagback.service;

import com.tagback.config.AuthProperties;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.*;
import com.tagback.exception.*;
import com.tagback.service.sms.SmsSecrets;
import java.time.Clock;
import java.time.Instant;
import java.time.Duration;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
@Profile("sms-mock & !prod & !production")
public class LoginService {
    private final UserRepository users;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final VerificationGrantRepository grants;
    private final SmsRequestGateRepository gates;
    private final AuthOperationRepository operations;
    private final PinService pins;
    private final PhoneNumberNormalizer phones;
    private final SmsSecrets secrets;
    private final AuthProperties policy;
    private final Clock clock;
    private final ObjectMapper json;

    public LoginService(UserRepository users, BrowserRegistrationRepository browsers, LoginSessionRepository sessions,
                        VerificationGrantRepository grants, SmsRequestGateRepository gates, AuthOperationRepository operations,
                        PinService pins, PhoneNumberNormalizer phones, SmsSecrets secrets, AuthProperties policy, Clock clock, ObjectMapper json) {
        this.users = users; this.browsers = browsers; this.sessions = sessions; this.grants = grants;
        this.gates = gates; this.operations = operations; this.pins = pins; this.phones = phones; this.secrets = secrets;
        this.policy = policy; this.clock = clock; this.json = json;
    }

    @Transactional(noRollbackFor = PinLoginFailure.class)
    public Result phone(AuthRequests.PhoneLogin input, UUID key) {
        requirePinFormat(input.pin());
        String phone = phones.normalize(input.phoneNumber());
        var user = users.findByPhoneNumberForUpdate(phone)
                .orElseThrow(() -> new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND));
        Instant now = clock.instant();
        String scope = secrets.tokenHash("phone-login:" + user.getId());
        String fingerprint = secrets.keyedHash(scope + ":" + input.pin());
        String browserToken = secrets.keyedHash("phone-login-browser:" + user.getId() + ":" + key);
        String sessionToken = secrets.keyedHash("phone-login-session:" + user.getId() + ":" + key);
        var replay = replay(scope, "PHONE_LOGIN", key, fingerprint, browserToken, sessionToken, now);
        if (replay != null) return replay;
        Instant operationExpiry = now.plus(policy.smsRequestWindow());
        verifyPin(user, input.pin(), scope, "PHONE_LOGIN", key, fingerprint, operationExpiry);
        now = clock.instant();
        boolean replaced = browsers.existsByUserIdAndRevokedAtIsNull(user.getId());
        sessions.revokeAllForUser(user.getId(), now, SessionRevokedReason.SESSION_REPLACED);
        browsers.revokeAllForUser(user.getId(), now);
        user.setPinFailureState(0, null);
        var browser = browsers.saveAndFlush(new BrowserRegistration(user, secrets.tokenHash(browserToken),
                now.plus(policy.browserRegistrationTtl()), now));
        return finish(user, browser, browserToken, sessionToken, replaced, scope, "PHONE_LOGIN", key,
                fingerprint, operationExpiry, now);
    }

    // Only explicit PIN failures commit. All failures during successful-login storage roll back.
    @Transactional(noRollbackFor = PinLoginFailure.class)
    public Result registered(AuthRequests.RegisteredLogin input, String browserToken, UUID key) {
        requirePinFormat(input.pin());
        if (browserToken == null || browserToken.isBlank()) throw new AuthException(AuthErrorCode.BROWSER_REGISTRATION_INVALID);
        String browserHash = secrets.tokenHash(browserToken);
        Long userId = browsers.findUserIdByTokenHash(browserHash)
                .orElseThrow(() -> new AuthException(AuthErrorCode.BROWSER_REGISTRATION_INVALID));
        var user = users.findByIdForUpdate(userId)
                .orElseThrow(() -> new AuthException(AuthErrorCode.BROWSER_REGISTRATION_INVALID));
        Instant now = clock.instant();
        var browser = browsers.findValidByTokenHash(browserHash, now)
                .orElseThrow(() -> new AuthException(AuthErrorCode.BROWSER_REGISTRATION_INVALID));
        String scope = secrets.tokenHash("registered-login:" + browser.getId());
        String fingerprint = secrets.keyedHash(scope + ":" + input.pin());
        String sessionToken = secrets.keyedHash("registered-login-session:" + browser.getId() + ":" + key);
        var replay = replay(scope, "REGISTERED_LOGIN", key, fingerprint, browserToken, sessionToken, now);
        if (replay != null) return replay;
        Instant operationExpiry = now.plus(policy.smsRequestWindow());
        verifyPin(user, input.pin(), scope, "REGISTERED_LOGIN", key, fingerprint, operationExpiry);
        now = clock.instant();
        if (!browser.getExpiresAt().isAfter(now)) throw new AuthException(AuthErrorCode.BROWSER_REGISTRATION_INVALID);
        user.setPinFailureState(0, null);
        browser.renew(now, now.plus(policy.browserRegistrationTtl()));
        sessions.revokeAllForUser(userId, now, SessionRevokedReason.SESSION_REPLACED);
        return finish(user, browser, browserToken, sessionToken, false, scope, "REGISTERED_LOGIN", key,
                fingerprint, operationExpiry, now);
    }

    @Transactional(noRollbackFor = PinLoginFailure.class)
    public Result newBrowser(AuthRequests.NewBrowserLogin input, UUID key) {
        requirePinFormat(input.pin());
        String hash = secrets.tokenHash(input.verificationToken());
        String phone = grants.findPhoneNumberByTokenHash(hash)
                .orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        // Gate -> grant -> user. Registered login only takes the user lock.
        gates.findForUpdate(phone).orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        var grant = grants.findByTokenHashForUpdate(hash)
                .orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        if (grant.getPurpose() != SmsPurpose.LOGIN) throw new AuthException(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH);
        var user = users.findByPhoneNumberForUpdate(phone)
                .orElseThrow(() -> new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND));
        Instant now = clock.instant();
        String scope = secrets.tokenHash("new-browser-login:" + grant.getId());
        String fingerprint = secrets.keyedHash(scope + ":" + input.pin());
        String browserToken = secrets.keyedHash("new-browser-login-browser:" + grant.getId() + ":" + key);
        String sessionToken = secrets.keyedHash("new-browser-login-session:" + grant.getId() + ":" + key);
        var replay = replay(scope, "NEW_BROWSER_LOGIN", key, fingerprint, browserToken, sessionToken, now);
        if (replay != null) return replay;
        if (grant.getConsumedAt() != null) throw new AuthException(AuthErrorCode.VERIFICATION_CONSUMED);
        if (!grant.getExpiresAt().isAfter(now)) throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        verifyPin(user, input.pin(), scope, "NEW_BROWSER_LOGIN", key, fingerprint, grant.getExpiresAt());
        now = clock.instant();
        if (grants.consumeIfAvailable(grant.getId(), phone, SmsPurpose.LOGIN, now) != 1)
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        boolean replaced = browsers.existsByUserIdAndRevokedAtIsNull(user.getId());
        sessions.revokeAllForUser(user.getId(), now, SessionRevokedReason.SESSION_REPLACED);
        browsers.revokeAllForUser(user.getId(), now);
        user.setPinFailureState(0, null);
        var browser = browsers.saveAndFlush(new BrowserRegistration(user, secrets.tokenHash(browserToken),
                now.plus(policy.browserRegistrationTtl()), now));
        return finish(user, browser, browserToken, sessionToken, replaced, scope, "NEW_BROWSER_LOGIN", key,
                fingerprint, grant.getExpiresAt(), now);
    }

    private void verifyPin(User user, String pin, String scope, String type, UUID key,
                           String fingerprint, Instant expiry) {
        Instant now = clock.instant();
        if (user.getPinFailedCount() >= 20) fail(AuthErrorCode.PIN_LOGIN_BLOCKED, null, scope, type, key, fingerprint, expiry, now);
        if (user.getPinLockedUntil() != null && user.getPinLockedUntil().isAfter(now))
            fail(AuthErrorCode.PIN_RETRY_WAIT, user.getPinLockedUntil(), scope, type, key, fingerprint, expiry, now);
        if (user.getPinHash() == null) throw new AuthException(AuthErrorCode.PIN_LOGIN_BLOCKED);
        if (pins.matches(pin, user.getPinHash())) return;
        now = clock.instant();
        int count = user.getPinFailedCount() + 1;
        Duration wait = switch (count) {
            case 5 -> policy.pinFirstWait();
            case 10 -> policy.pinSecondWait();
            case 15 -> policy.pinThirdWait();
            default -> null;
        };
        Instant until = wait == null ? null : now.plus(wait);
        user.setPinFailureState(count, until);
        AuthErrorCode code = count >= 20 ? AuthErrorCode.PIN_LOGIN_BLOCKED
                : until != null ? AuthErrorCode.PIN_RETRY_WAIT : AuthErrorCode.PIN_MISMATCH;
        fail(code, until, scope, type, key, fingerprint, expiry, now);
    }

    private void fail(AuthErrorCode code, Instant retryAt, String scope, String type, UUID key,
                      String fingerprint, Instant expiry, Instant now) {
        // A grant can expire while a costly PIN comparison is running; do not store invalid expiry ranges.
        if (expiry.isAfter(now)) {
            var operation = new AuthOperation(scope, type, key.toString(), fingerprint, expiry, now);
            operation.completeFailed(code.name(), json.writeValueAsString(new Failure(code.name(), retryAt)), now);
            operations.saveAndFlush(operation);
        }
        throw new PinLoginFailure(code, retryAt);
    }

    private Result replay(String scope, String type, UUID key, String fingerprint,
                          String browserToken, String sessionToken, Instant now) {
        var previous = operations.findForUpdate(scope, type, key.toString());
        if (previous.isEmpty()) return null;
        var operation = previous.get();
        if (!fingerprint.equals(operation.getRequestFingerprint()) || !operation.getExpiresAt().isAfter(now))
            throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        if (operation.getStatus() == AuthOperationStatus.FAILED) {
            var failure = json.readValue(operation.getResultJson(), Failure.class);
            throw new PinLoginFailure(AuthErrorCode.valueOf(failure.code()), failure.retryAt());
        }
        var session = sessions.findValidByTokenHash(secrets.tokenHash(sessionToken), now)
                .orElseThrow(() -> new AuthException(AuthErrorCode.SESSION_EXPIRED));
        var stored = json.readValue(operation.getResultJson(), StoredResult.class);
        return new Result(stored.response(), browserToken, sessionToken, session.getAbsoluteExpiresAt(), stored.previousBrowserRevoked());
    }

    private Result finish(User user, BrowserRegistration browser, String browserToken, String sessionToken,
                          boolean replaced, String scope, String type, UUID key, String fingerprint,
                          Instant operationExpiry, Instant now) {
        Instant idleExpiry = now.plus(policy.sessionIdleTimeout());
        Instant absoluteExpiry = now.plus(policy.sessionAbsoluteTimeout());
        sessions.saveAndFlush(new LoginSession(browser, secrets.tokenHash(sessionToken), idleExpiry, absoluteExpiry, now));
        var summary = new AuthResponses.UserSummary(user.getId().toString(), "010-****-" + user.getPhoneNumber().substring(user.getPhoneNumber().length() - 4), user.getRole().name(), user.getName(), user.getOccupation());
        var response = new AuthResponses.LoginResult(summary, idleExpiry, browser.getExpiresAt());
        var operation = new AuthOperation(scope, type, key.toString(), fingerprint, operationExpiry, now);
        operation.completeSuccessfully(json.writeValueAsString(new StoredResult(response, replaced)), now);
        operations.save(operation);
        return new Result(response, browserToken, sessionToken, absoluteExpiry, replaced);
    }

    private void requirePinFormat(String pin) {
        if (pin == null || !pin.matches("[0-9]{6}")) throw new AuthException(AuthErrorCode.INVALID_INPUT);
    }

    public static final class PinLoginFailure extends AuthException {
        public PinLoginFailure(AuthErrorCode code, Instant retryAt) { super(code, retryAt); }
    }
    public record Failure(String code, Instant retryAt) {}
    public record StoredResult(AuthResponses.LoginResult response, boolean previousBrowserRevoked) {}
    public record Result(AuthResponses.LoginResult response, String browserToken, String sessionToken,
                         Instant sessionAbsoluteExpiry, boolean previousBrowserRevoked) {
        @Override public String toString() { return "LoginResult[redacted]"; }
    }
}
