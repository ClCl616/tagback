package com.tagback.service;

import com.tagback.config.AuthProperties;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.*;
import com.tagback.exception.*;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
@Profile(com.tagback.config.AuthProfiles.KAKAO)
public class KakaoSignupService {
    private final KakaoChallengeService challenges;
    private final UserRepository users;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final AuthOperationRepository operations;
    private final PinService pins;
    private final AuthSecrets secrets;
    private final AuthProperties policy;
    private final Clock clock;
    private final ObjectMapper json;
    private final JdbcTemplate db;

    public KakaoSignupService(KakaoChallengeService challenges, UserRepository users,
            BrowserRegistrationRepository browsers, LoginSessionRepository sessions,
            AuthOperationRepository operations, PinService pins, AuthSecrets secrets,
            AuthProperties policy, Clock clock, ObjectMapper json, JdbcTemplate db) {
        this.challenges = challenges; this.users = users; this.browsers = browsers;
        this.sessions = sessions; this.operations = operations; this.pins = pins;
        this.secrets = secrets; this.policy = policy; this.clock = clock; this.json = json; this.db = db;
    }

    @Transactional
    public Result signup(AuthRequests.KakaoSignup input, String proof, UUID key) {
        pins.validate(input.pin());
        String name = profileValue(input.profile() == null ? null : input.profile().name());
        String occupation = profileValue(input.profile() == null ? null : input.profile().occupation());
        var challenge = challenges.lockForCompletion(input.challengeId(), proof);
        if (!"SIGNUP".equals(challenge.purpose())) throw new AuthException(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH);
        Instant now = clock.instant();
        String scope = secrets.keyedHash("kakao-signup-scope:" + input.challengeId());
        String fingerprint = secrets.keyedHash("kakao-signup-request:" + json.writeValueAsString(input));
        String browserToken = secrets.keyedHash("kakao-signup-browser:" + input.challengeId() + ":" + key);
        String sessionToken = secrets.keyedHash("kakao-signup-session:" + input.challengeId() + ":" + key);
        var prior = operations.findForUpdate(scope, "KAKAO_SIGNUP", key.toString());
        if (prior.isPresent()) {
            var operation = prior.get();
            if (!fingerprint.equals(operation.getRequestFingerprint()) || !operation.getExpiresAt().isAfter(now))
                throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
            var session = sessions.findValidByTokenHash(secrets.tokenHash(sessionToken), now)
                    .orElseThrow(() -> new AuthException(AuthErrorCode.SESSION_EXPIRED));
            return new Result(json.readValue(operation.getResultJson(), AuthResponses.LoginResult.class),
                    browserToken, sessionToken, session.getAbsoluteExpiresAt());
        }
        if ("CONSUMED".equals(challenge.status())) throw new AuthException(AuthErrorCode.VERIFICATION_CONSUMED);
        if (!challenge.expiresAt().isAfter(now) || "EXPIRED".equals(challenge.status()))
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        if (!"VERIFIED".equals(challenge.status()) || challenge.botId() == null || challenge.userId() == null)
            throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);

        // Serialize distinct challenges for the same identity; the unique constraint is the final guard.
        String identity = secrets.keyedHash("kakao-identity:" + challenge.botId().length() + ":" + challenge.botId() + challenge.userId());
        db.queryForObject("select pg_advisory_xact_lock(hashtextextended(?, 0))", (rs, row) -> 0, identity);
        Boolean exists = db.queryForObject("select exists(select 1 from kakao_bot_identities where bot_id=? and bot_user_key=?)",
                Boolean.class, challenge.botId(), challenge.userId());
        if (Boolean.TRUE.equals(exists)) throw new AuthException(AuthErrorCode.KAKAO_IDENTITY_ALREADY_REGISTERED);
        String pinHash = pins.hash(input.pin());
        now = clock.instant();
        if (db.update("update kakao_auth_challenges set status='CONSUMED', consumed_at=? where challenge_id=? and status='VERIFIED' and expires_at>?",
                Timestamp.from(now), input.challengeId(), Timestamp.from(now)) != 1)
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        var user = User.withoutPhone(pinHash, now);
        user.setProfile(name, occupation);
        users.saveAndFlush(user);
        if (db.update("insert into kakao_bot_identities(user_id,bot_id,bot_user_key,linked_at) values (?,?,?,?) on conflict do nothing",
                user.getId(), challenge.botId(), challenge.userId(), Timestamp.from(now)) != 1)
            throw new AuthException(AuthErrorCode.KAKAO_IDENTITY_ALREADY_REGISTERED);
        Instant browserExpiry = now.plus(policy.browserRegistrationTtl());
        Instant idleExpiry = now.plus(policy.sessionIdleTimeout());
        Instant absoluteExpiry = now.plus(policy.sessionAbsoluteTimeout());
        var browser = browsers.saveAndFlush(new BrowserRegistration(user, secrets.tokenHash(browserToken), browserExpiry, now));
        sessions.saveAndFlush(new LoginSession(browser, secrets.tokenHash(sessionToken), idleExpiry, absoluteExpiry, now));
        var summary = new AuthResponses.UserSummary(user.getId().toString(),
                user.getRole().name(), user.getName(), user.getOccupation());
        var response = new AuthResponses.LoginResult(summary, idleExpiry, browserExpiry);
        var operation = new AuthOperation(scope, "KAKAO_SIGNUP", key.toString(), fingerprint, challenge.expiresAt(), now);
        operation.completeSuccessfully(json.writeValueAsString(response), now);
        operations.save(operation);
        return new Result(response, browserToken, sessionToken, absoluteExpiry);
    }

    private String profileValue(String value) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > 40)
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        return value.trim();
    }

    public record Result(AuthResponses.LoginResult response, String browserToken, String sessionToken, Instant sessionAbsoluteExpiry) {
        @Override public String toString() { return "KakaoSignupResult[redacted]"; }
    }
}
