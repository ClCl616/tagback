package com.tagback.service;

import com.tagback.config.AuthProperties;
import com.tagback.domain.entity.BrowserRegistration;
import com.tagback.domain.entity.SessionRevokedReason;
import com.tagback.domain.repository.BrowserRegistrationRepository;
import com.tagback.domain.repository.LoginSessionRepository;
import com.tagback.domain.repository.UserRepository;
import com.tagback.dto.auth.AuthRequests;
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

/** Development-only Kakao login. The challenge and user are locked until transaction completion. */
@Service
@Profile(com.tagback.config.AuthProfiles.KAKAO)
public class KakaoLoginService {
    private static final String OPERATION = "KAKAO_NEW_BROWSER_LOGIN";
    private final KakaoChallengeService challenges;
    private final LoginService login;
    private final UserRepository users;
    private final BrowserRegistrationRepository browsers;
    private final LoginSessionRepository sessions;
    private final AuthSecrets secrets;
    private final AuthProperties policy;
    private final Clock clock;
    private final JdbcTemplate db;

    public KakaoLoginService(KakaoChallengeService challenges, LoginService login, UserRepository users,
            BrowserRegistrationRepository browsers, LoginSessionRepository sessions, AuthSecrets secrets,
            AuthProperties policy, Clock clock, JdbcTemplate db) {
        this.challenges = challenges; this.login = login; this.users = users; this.browsers = browsers;
        this.sessions = sessions; this.secrets = secrets; this.policy = policy; this.clock = clock; this.db = db;
    }

    // PIN failures must persist; other failures roll back the complete browser replacement.
    @Transactional(noRollbackFor = LoginService.PinLoginFailure.class)
    public LoginService.Result newBrowser(AuthRequests.KakaoNewBrowserLogin input, String proof, UUID key) {
        login.requirePinFormat(input.pin());
        var challenge = challenges.lockForCompletion(input.challengeId(), proof);
        if (!"LOGIN".equals(challenge.purpose())) throw new AuthException(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH);
        if ("EXPIRED".equals(challenge.status())) throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        if ((!"VERIFIED".equals(challenge.status()) && !"CONSUMED".equals(challenge.status()))
                || challenge.botId() == null || challenge.userId() == null)
            throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
        if ("VERIFIED".equals(challenge.status()) && !challenge.expiresAt().isAfter(clock.instant()))
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);

        var ids = db.query("select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?",
                (rs, n) -> rs.getLong(1), challenge.botId(), challenge.userId());
        if (ids.isEmpty()) throw new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND);
        var user = users.findByIdForUpdate(ids.getFirst())
                .orElseThrow(() -> new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND));
        // Recheck after acquiring the user lock so a future unlink cannot authenticate a stale mapping.
        Boolean linked = db.queryForObject("select exists(select 1 from kakao_bot_identities where user_id=? and bot_id=? and bot_user_key=?)",
                Boolean.class, user.getId(), challenge.botId(), challenge.userId());
        if (!Boolean.TRUE.equals(linked)) throw new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND);

        Instant now = clock.instant();
        String scope = secrets.keyedHash("kakao-login-scope:" + input.challengeId());
        String fingerprint = secrets.keyedHash(scope + ":" + input.pin());
        String browserToken = secrets.keyedHash("kakao-login-browser:" + input.challengeId() + ":" + key);
        String sessionToken = secrets.keyedHash("kakao-login-session:" + input.challengeId() + ":" + key);
        var replay = login.replay(scope, OPERATION, key, fingerprint, browserToken, sessionToken, now);
        if (replay != null) return replay;
        if ("CONSUMED".equals(challenge.status())) throw new AuthException(AuthErrorCode.VERIFICATION_CONSUMED);
        if (!challenge.expiresAt().isAfter(now)) throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);

        login.verifyPin(user, input.pin(), scope, OPERATION, key, fingerprint, challenge.expiresAt());
        now = clock.instant();
        if (db.update("update kakao_auth_challenges set status='CONSUMED', consumed_at=? where challenge_id=? and status='VERIFIED' and purpose='LOGIN' and expires_at>?",
                Timestamp.from(now), input.challengeId(), Timestamp.from(now)) != 1)
            throw new AuthException(AuthErrorCode.VERIFICATION_EXPIRED);
        boolean replaced = browsers.existsByUserIdAndRevokedAtIsNull(user.getId());
        sessions.revokeAllForUser(user.getId(), now, SessionRevokedReason.SESSION_REPLACED);
        browsers.revokeAllForUser(user.getId(), now);
        user.setPinFailureState(0, null);
        var browser = browsers.saveAndFlush(new BrowserRegistration(user, secrets.tokenHash(browserToken),
                now.plus(policy.browserRegistrationTtl()), now));
        return login.finish(user, browser, browserToken, sessionToken, replaced, scope, OPERATION, key,
                fingerprint, challenge.expiresAt(), now);
    }
}
