package com.tagback.service;

import com.tagback.config.AuthProperties;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.*;
import com.tagback.exception.*;
import com.tagback.service.sms.SmsSecrets;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
@Profile("sms-mock & !prod & !production")
public class SignupService {
    private final UserRepository users;
    private final VerificationGrantRepository grants;
    private final SmsRequestGateRepository gates;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final AuthOperationRepository operations;
    private final PinService pins;
    private final SmsSecrets secrets;
    private final AuthProperties policy;
    private final Clock clock;
    private final ObjectMapper json;

    public SignupService(UserRepository users, VerificationGrantRepository grants, SmsRequestGateRepository gates,
                         BrowserRegistrationRepository browsers, LoginSessionRepository sessions,
                         AuthOperationRepository operations, PinService pins, SmsSecrets secrets,
                         AuthProperties policy, Clock clock, ObjectMapper json) {
        this.users = users; this.grants = grants; this.gates = gates; this.browsers = browsers;
        this.sessions = sessions; this.operations = operations; this.pins = pins;
        this.secrets = secrets; this.policy = policy; this.clock = clock; this.json = json;
    }

    @Transactional
    public Result signup(AuthRequests.Signup input, UUID key) {
        pins.validate(input.pin());
        String name = profileValue(input.profile() == null ? null : input.profile().name());
        String occupation = profileValue(input.profile() == null ? null : input.profile().occupation());
        String hash = secrets.tokenHash(input.verificationToken());
        String phone = grants.findPhoneNumberByTokenHash(hash)
                .orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        // Match SMS lock order and serialize different grants for the same phone number.
        gates.findForUpdate(phone).orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        var grant = grants.findByTokenHashForUpdate(hash)
                .orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        Instant now = clock.instant();
        if (grant.getPurpose() != SmsPurpose.SIGNUP) throw new AuthException(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH);

        String scope = secrets.tokenHash("signup:" + grant.getId());
        String fingerprint = secrets.keyedHash("signup:" + grant.getId() + ":"
                + json.writeValueAsString(input));
        // Derived secret tokens permit response-loss retries without storing raw cookies.
        String browserToken = secrets.keyedHash("signup-browser:" + grant.getId() + ":" + key);
        String sessionToken = secrets.keyedHash("signup-session:" + grant.getId() + ":" + key);
        var prior = operations.findForUpdate(scope, "SIGNUP", key.toString());
        if (prior.isPresent()) {
            var operation = prior.get();
            if (!fingerprint.equals(operation.getRequestFingerprint()) || !operation.getExpiresAt().isAfter(now))
                throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
            var session = sessions.findValidByTokenHash(secrets.tokenHash(sessionToken), now)
                    .orElseThrow(() -> new AuthException(AuthErrorCode.SESSION_EXPIRED));
            var response = json.readValue(operation.getResultJson(), AuthResponses.LoginResult.class);
            return new Result(response, browserToken, sessionToken, session.getAbsoluteExpiresAt());
        }
        if (grant.getConsumedAt() != null) throw new AuthException(AuthErrorCode.VERIFICATION_CONSUMED);
        if (!grant.getExpiresAt().isAfter(now)) throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        if (users.existsByPhoneNumber(phone)) throw new AuthException(AuthErrorCode.PHONE_NUMBER_ALREADY_REGISTERED);

        String pinHash = pins.hash(input.pin());
        // Hashing takes time: check expiration again before consuming the grant.
        now = clock.instant();
        if (grants.consumeIfAvailable(grant.getId(), phone, SmsPurpose.SIGNUP, now) != 1)
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        var user = users.saveAndFlush(new User(phone, pinHash, now));
        user.setProfile(name, occupation);
        Instant browserExpiry = now.plus(policy.browserRegistrationTtl());
        Instant idleExpiry = now.plus(policy.sessionIdleTimeout());
        Instant absoluteExpiry = now.plus(policy.sessionAbsoluteTimeout());
        var browser = browsers.saveAndFlush(new BrowserRegistration(user, secrets.tokenHash(browserToken), browserExpiry, now));
        sessions.saveAndFlush(new LoginSession(browser, secrets.tokenHash(sessionToken), idleExpiry, absoluteExpiry, now));
        var summary = new AuthResponses.UserSummary(user.getId().toString(), "010-****-" + phone.substring(phone.length() - 4), user.getRole().name(), user.getName(), user.getOccupation());
        var response = new AuthResponses.LoginResult(summary, idleExpiry, browserExpiry);
        var operation = new AuthOperation(scope, "SIGNUP", key.toString(), fingerprint, grant.getExpiresAt(), now);
        operation.completeSuccessfully(json.writeValueAsString(response), now);
        operations.save(operation);
        return new Result(response, browserToken, sessionToken, absoluteExpiry);
    }

    private String profileValue(String value) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > 40)
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        return value.trim();
    }

    public record Result(AuthResponses.LoginResult response, String browserToken, String sessionToken,
                         Instant sessionAbsoluteExpiry) {
        @Override public String toString() { return "SignupResult[redacted]"; }
    }
}
