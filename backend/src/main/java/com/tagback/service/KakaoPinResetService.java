package com.tagback.service;

import com.tagback.domain.entity.AuthOperation;
import com.tagback.domain.entity.SessionRevokedReason;
import com.tagback.domain.repository.AuthOperationRepository;
import com.tagback.domain.repository.BrowserRegistrationRepository;
import com.tagback.domain.repository.LoginSessionRepository;
import com.tagback.domain.repository.UserRepository;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Development-only PIN recovery, bound to the verified chatbot identity and originating browser. */
@Service
@Profile(com.tagback.config.AuthProfiles.KAKAO)
public class KakaoPinResetService {
    private static final String OPERATION = "KAKAO_PIN_RESET";
    private final KakaoChallengeService challenges;
    private final UserRepository users;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final AuthOperationRepository operations;
    private final PinService pins;
    private final AuthSecrets secrets;
    private final Clock clock;
    private final JdbcTemplate db;
    private final ObjectMapper json;

    public KakaoPinResetService(KakaoChallengeService challenges, UserRepository users,
            BrowserRegistrationRepository browsers, LoginSessionRepository sessions,
            AuthOperationRepository operations, PinService pins, AuthSecrets secrets,
            Clock clock, JdbcTemplate db, ObjectMapper json) {
        this.challenges = challenges; this.users = users; this.browsers = browsers;
        this.sessions = sessions; this.operations = operations; this.pins = pins;
        this.secrets = secrets; this.clock = clock; this.db = db; this.json = json;
    }

    @Transactional
    public Result reset(AuthRequests.KakaoPinReset input, String proof, UUID key) {
        pins.validate(input.pin());
        var challenge = challenges.lockForCompletion(input.challengeId(), proof);
        if (!"PIN_RESET".equals(challenge.purpose())) throw new AuthException(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH);
        if ("EXPIRED".equals(challenge.status())) throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        if ((!"VERIFIED".equals(challenge.status()) && !"CONSUMED".equals(challenge.status()))
                || challenge.botId() == null || challenge.userId() == null)
            throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
        Instant now = clock.instant();
        if ("VERIFIED".equals(challenge.status()) && !challenge.expiresAt().isAfter(now))
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);

        var ids = db.query("select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?",
                (rs, n) -> rs.getLong(1), challenge.botId(), challenge.userId());
        if (ids.isEmpty()) throw new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND);
        var user = users.findByIdForUpdate(ids.getFirst())
                .orElseThrow(() -> new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND));
        Boolean linked = db.queryForObject("select exists(select 1 from kakao_bot_identities where user_id=? and bot_id=? and bot_user_key=?)",
                Boolean.class, user.getId(), challenge.botId(), challenge.userId());
        if (!Boolean.TRUE.equals(linked)) throw new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND);

        now = clock.instant();
        String scope = secrets.keyedHash("kakao-pin-reset-scope:" + input.challengeId());
        String fingerprint = secrets.keyedHash("kakao-pin-reset-request:" + input.challengeId() + ":" + input.pin());
        var previous = operations.findForUpdate(scope, OPERATION, key.toString());
        if (previous.isPresent()) {
            var operation = previous.get();
            if (!fingerprint.equals(operation.getRequestFingerprint()) || !operation.getExpiresAt().isAfter(now))
                throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
            return new Result(json.readValue(operation.getResultJson(), AuthResponses.PinResetResult.class), true);
        }
        if ("CONSUMED".equals(challenge.status())) throw new AuthException(AuthErrorCode.VERIFICATION_CONSUMED);
        if (!challenge.expiresAt().isAfter(now)) throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        String pinHash = pins.hash(input.pin());
        now = clock.instant();
        if (db.update("update kakao_auth_challenges set status='CONSUMED', consumed_at=? where challenge_id=? and status='VERIFIED' and purpose='PIN_RESET' and expires_at>?",
                Timestamp.from(now), input.challengeId(), Timestamp.from(now)) != 1)
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        user.resetPin(pinHash);
        sessions.revokeAllForUser(user.getId(), now, SessionRevokedReason.PIN_RESET);
        browsers.revokeAllForUser(user.getId(), now);
        var result = new AuthResponses.PinResetResult(true);
        var operation = new AuthOperation(scope, OPERATION, key.toString(), fingerprint, challenge.expiresAt(), now);
        operation.completeSuccessfully(json.writeValueAsString(result), now);
        operations.save(operation);
        return new Result(result, false);
    }

    public record Result(AuthResponses.PinResetResult response, boolean replayed) {}
}
