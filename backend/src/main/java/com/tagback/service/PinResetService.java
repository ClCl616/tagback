package com.tagback.service;

import com.tagback.domain.entity.AuthOperation;
import com.tagback.domain.entity.SessionRevokedReason;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.dto.auth.SmsPurpose;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
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
public class PinResetService {
    private final UserRepository users;
    private final VerificationGrantRepository grants;
    private final SmsRequestGateRepository gates;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final AuthOperationRepository operations;
    private final PinService pins;
    private final SmsSecrets secrets;
    private final Clock clock;
    private final ObjectMapper json;

    public PinResetService(UserRepository users, VerificationGrantRepository grants, SmsRequestGateRepository gates,
                           BrowserRegistrationRepository browsers, LoginSessionRepository sessions,
                           AuthOperationRepository operations, PinService pins, SmsSecrets secrets,
                           Clock clock, ObjectMapper json) {
        this.users = users; this.grants = grants; this.gates = gates; this.browsers = browsers;
        this.sessions = sessions; this.operations = operations; this.pins = pins;
        this.secrets = secrets; this.clock = clock; this.json = json;
    }

    @Transactional
    public AuthResponses.PinResetResult reset(AuthRequests.PinReset input, UUID key) {
        pins.validate(input.pin());
        String hash = secrets.tokenHash(input.verificationToken());
        String phone = grants.findPhoneNumberByTokenHash(hash)
                .orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        // Use the same gate -> grant -> user lock order as SMS verification and signup.
        gates.findForUpdate(phone).orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        var grant = grants.findByTokenHashForUpdate(hash)
                .orElseThrow(() -> new AuthException(AuthErrorCode.VERIFICATION_INVALID));
        if (grant.getPurpose() != SmsPurpose.PIN_RESET)
            throw new AuthException(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH);
        Instant now = clock.instant();
        String scope = secrets.tokenHash("pin-reset:" + grant.getId());
        String fingerprint = secrets.keyedHash("pin-reset:" + grant.getId() + ":" + input.pin());
        var previous = operations.findForUpdate(scope, "PIN_RESET", key.toString());
        if (previous.isPresent()) {
            var operation = previous.get();
            if (!fingerprint.equals(operation.getRequestFingerprint()) || !operation.getExpiresAt().isAfter(now))
                throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
            return json.readValue(operation.getResultJson(), AuthResponses.PinResetResult.class);
        }
        if (grant.getConsumedAt() != null) throw new AuthException(AuthErrorCode.VERIFICATION_CONSUMED);
        if (!grant.getExpiresAt().isAfter(now)) throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        var user = users.findByPhoneNumberForUpdate(phone)
                .orElseThrow(() -> new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND));
        String pinHash = pins.hash(input.pin());
        now = clock.instant();
        if (grants.consumeIfAvailable(grant.getId(), phone, SmsPurpose.PIN_RESET, now) != 1)
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        user.resetPin(pinHash);
        sessions.revokeAllForUser(user.getId(), now, SessionRevokedReason.PIN_RESET);
        browsers.revokeAllForUser(user.getId(), now);
        grants.consumeAllForPhone(phone, now);
        var result = new AuthResponses.PinResetResult(true);
        var operation = new AuthOperation(scope, "PIN_RESET", key.toString(), fingerprint, grant.getExpiresAt(), now);
        operation.completeSuccessfully(json.writeValueAsString(result), now);
        operations.save(operation);
        return result;
    }
}
