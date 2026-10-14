package com.tagback.service.sms;

import com.tagback.config.AuthProperties;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.dto.auth.SmsPurpose;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.PhoneNumberNormalizer;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
@Profile("sms-mock & !prod & !production")
public class SmsAuthService {
    private final SmsRequestGateRepository gates;
    private final SmsVerificationRepository requests;
    private final VerificationGrantRepository grants;
    private final AuthOperationRepository operations;
    private final UserRepository users;
    private final PhoneNumberNormalizer phones;
    private final AuthProperties policy;
    private final Clock clock;
    private final SmsSecrets secrets;
    private final MockSmsDelivery delivery;
    private final ObjectMapper json;

    public SmsAuthService(SmsRequestGateRepository gates, SmsVerificationRepository requests,
                          VerificationGrantRepository grants, AuthOperationRepository operations,
                          UserRepository users, PhoneNumberNormalizer phones, AuthProperties policy, Clock clock,
                          SmsSecrets secrets, MockSmsDelivery delivery, ObjectMapper json) {
        this.gates = gates;
        this.requests = requests;
        this.grants = grants;
        this.operations = operations;
        this.users = users;
        this.phones = phones;
        this.policy = policy;
        this.clock = clock;
        this.secrets = secrets;
        this.delivery = delivery;
        this.json = json;
    }

    @Transactional
    public AuthResponses.SmsRequested request(AuthRequests.SmsRequest input, UUID idempotencyKey) {
        String phone = phones.normalize(input.phoneNumber());
        if (input.purpose() == SmsPurpose.SIGNUP && users.existsByPhoneNumber(phone))
            throw new AuthException(AuthErrorCode.PHONE_NUMBER_ALREADY_REGISTERED);
        if (input.purpose() == SmsPurpose.PIN_RESET && !users.existsByPhoneNumber(phone))
            throw new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND);
        if (input.purpose() == SmsPurpose.PHONE_CHANGE)
            throw new AuthException(AuthErrorCode.REAUTHENTICATION_REQUIRED);

        gates.ensureExists(phone);
        var gate = gates.findForUpdate(phone).orElseThrow();
        Instant now = clock.instant();
        // For this unauthenticated operation, the random request key is the replay capability.
        // Only non-secret request metadata is stored/replayed; no verification token or SMS code.
        String scope = secrets.tokenHash("sms-request:" + phone);
        String fingerprint = secrets.keyedHash("sms-request:" + phone + ":" + input.purpose());
        var previous = operations.findForUpdate(scope, "SMS_REQUEST", idempotencyKey.toString());
        if (previous.isPresent()) {
            var operation = previous.get();
            if (!fingerprint.equals(operation.getRequestFingerprint()) || !operation.getExpiresAt().isAfter(now))
                throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
            return json.readValue(operation.getResultJson(), AuthResponses.SmsRequested.class);
        }

        if (gate.getResendAvailableAt() != null && gate.getResendAvailableAt().isAfter(now))
            throw new AuthException(AuthErrorCode.SMS_RESEND_WAIT, gate.getResendAvailableAt());
        Instant since = now.minus(policy.smsRequestWindow());
        long sent = requests.countSentSince(phone, since);
        long pending = requests.countByPhoneNumberAndDeliveryStatus(phone, SmsDeliveryStatus.PENDING);
        if (sent + pending >= policy.smsMaxRequests()) {
            Instant retryAt = requests.findOldestSentSince(phone, since)
                    .map(time -> time.plus(policy.smsRequestWindow()))
                    .orElse(now.plus(policy.smsResendInterval()));
            throw new AuthException(AuthErrorCode.SMS_REQUEST_LIMIT_EXCEEDED, retryAt);
        }

        // A new code supersedes every earlier code and unused proof for this number,
        // regardless of purpose. Rejected requests and idempotent replays do not reach here.
        requests.invalidateUnfinished(phone, now);
        grants.consumeAllForPhone(phone, now);
        UUID requestId = UUID.randomUUID();
        String code = secrets.generateCode();
        Instant expiresAt = now.plus(policy.smsCodeTtl());
        Instant resendAt = now.plus(policy.smsResendInterval());
        var request = new SmsVerification(requestId, phone, input.purpose(), secrets.codeHash(requestId, code),
                expiresAt, resendAt, now);
        // The mock provider accepts immediately. Real provider reservation/outcome handling is deferred.
        request.markSent(now);
        requests.saveAndFlush(request);
        gates.updateResendAvailableAt(phone, resendAt);
        var response = new AuthResponses.SmsRequested(requestId.toString(), expiresAt, resendAt);
        var operation = new AuthOperation(scope, "SMS_REQUEST", idempotencyKey.toString(), fingerprint,
                now.plus(policy.smsRequestWindow()), now);
        operation.completeSuccessfully(json.writeValueAsString(response), now);
        operations.save(operation);
        delivery.deliverAfterCommit(requestId, code, expiresAt);
        return response;
    }

    // Wrong-code responses must COMMIT the increment rather than rolling it back.
    @Transactional(noRollbackFor = AuthException.class)
    public AuthResponses.SmsVerified verify(AuthRequests.SmsVerification input) {
        UUID id;
        try { id = UUID.fromString(input.requestId()); }
        catch (IllegalArgumentException exception) { throw new AuthException(AuthErrorCode.INVALID_INPUT); }
        String phone = requests.findPhoneNumberById(id)
                .orElseThrow(() -> new AuthException(AuthErrorCode.SMS_REQUEST_INVALIDATED));
        // Same lock order as resend: number gate, then request. Scalar lookup above avoids stale entities.
        gates.findForUpdate(phone).orElseThrow();
        var request = requests.findByIdForUpdate(id)
                .orElseThrow(() -> new AuthException(AuthErrorCode.SMS_REQUEST_INVALIDATED));
        Instant now = clock.instant();
        validateUsable(request, now);
        if (!secrets.matches(id, input.code(), request.getCodeHash())) {
            request.recordFailedAttempt();
            if (request.getFailedCount() >= policy.smsMaxAttempts())
                throw new AuthException(AuthErrorCode.SMS_ATTEMPTS_EXCEEDED);
            throw new AuthException(AuthErrorCode.SMS_CODE_MISMATCH);
        }
        String token = secrets.generateToken();
        Instant expiresAt = now.plus(policy.verificationTtl());
        request.markVerified(now);
        grants.save(new VerificationGrant(request, secrets.tokenHash(token), expiresAt, now));
        return new AuthResponses.SmsVerified(token, request.getPurpose(), expiresAt,
                "010-****-" + phone.substring(phone.length() - 4));
    }

    @Transactional(readOnly = true)
    public MockCode getMockCode(UUID id) {
        var request = requests.findById(id)
                .orElseThrow(() -> new AuthException(AuthErrorCode.SMS_REQUEST_INVALIDATED));
        validateUsable(request, clock.instant());
        String code = delivery.findCode(id)
                .orElseThrow(() -> new AuthException(AuthErrorCode.SMS_REQUEST_INVALIDATED));
        return new MockCode(code, request.getExpiresAt());
    }

    private void validateUsable(SmsVerification request, Instant now) {
        if (request.getInvalidatedAt() != null || request.getDeliveryStatus() != SmsDeliveryStatus.SENT)
            throw new AuthException(AuthErrorCode.SMS_REQUEST_INVALIDATED);
        if (request.getVerifiedAt() != null) throw new AuthException(AuthErrorCode.SMS_ALREADY_VERIFIED);
        if (request.getFailedCount() >= policy.smsMaxAttempts()) throw new AuthException(AuthErrorCode.SMS_ATTEMPTS_EXCEEDED);
        if (!request.getExpiresAt().isAfter(now)) throw new AuthException(AuthErrorCode.SMS_CODE_EXPIRED);
    }

    public record MockCode(String code, Instant expiresAt) {
        @Override public String toString() { return "MockCode[redacted]"; }
    }
}
