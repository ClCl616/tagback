package com.tagback.service;

import com.tagback.domain.repository.RentalRepository;
import com.tagback.domain.repository.UserRepository;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile(com.tagback.config.AuthProfiles.KAKAO)
public class AccountWithdrawalService {
    private final SessionService sessions;
    private final UserRepository users;
    private final RentalRepository rentals;
    private final JdbcTemplate db;
    private final AuthSecrets secrets;
    private final KakaoChallengeService challenges;
    private final Clock clock;

    public AccountWithdrawalService(SessionService sessions, UserRepository users, RentalRepository rentals,
                                    JdbcTemplate db, AuthSecrets secrets, KakaoChallengeService challenges, Clock clock) {
        this.sessions = sessions; this.users = users; this.rentals = rentals;
        this.db = db; this.secrets = secrets; this.challenges = challenges; this.clock = clock;
    }

    @Transactional
    public void withdraw(String sessionToken) {
        // Validate again inside this transaction. SessionService locks the user until commit.
        long userId = Long.parseLong(sessions.current(sessionToken).user().userId());
        var user = users.findByIdForUpdate(userId).orElseThrow(() -> new AuthException(AuthErrorCode.SESSION_REQUIRED));
        if (rentals.existsByUser_IdAndReturnedAtIsNull(userId)) throw new AuthException(AuthErrorCode.OUTSTANDING_RENTALS);

        var now = clock.instant();
        var deleteAfter = now.atZone(ZoneOffset.UTC).plusYears(1).toInstant();
        db.update("insert into withdrawn_rental_history(item_id,rented_date,due_date,returned_date,return_condition,delete_after) "
                + "select item_id,(rented_at at time zone 'UTC')::date,(due_at at time zone 'UTC')::date,"
                + "(returned_at at time zone 'UTC')::date,return_condition,? from rentals where user_id=? and returned_at is not null",
                Timestamp.from(deleteAfter), userId);

        // Delete snapshots and credentials before removing their referenced rows.
        db.update("delete from rental_operations where rental_id in (select rental_id from rentals where user_id=?) "
                + "or rental_grant_id in (select g.rental_grant_id from rental_grants g join rental_codes c on c.rental_code_id=g.rental_code_id where c.user_id=?)", userId, userId);
        db.update("delete from nfc_return_scan_tickets where rental_id in (select rental_id from rentals where user_id=?)", userId);
        db.update("delete from rentals where user_id=?", userId);
        db.update("delete from rental_grants where rental_code_id in (select rental_code_id from rental_codes where user_id=?)", userId);
        db.update("delete from rental_codes where user_id=?", userId);
        db.update("update item_status_history set changed_by_user_id=null, actor_withdrawn=true where changed_by_user_id=?", userId);

        var browserIds = db.query("select browser_registration_id from browser_registrations where user_id=?",
                (rs, n) -> rs.getObject(1, UUID.class), userId);
        for (var browserId : browserIds)
            db.update("delete from auth_operations where caller_scope_hash=?", secrets.tokenHash("registered-login:" + browserId));
        var identities = db.query("select bot_id,bot_user_key from kakao_bot_identities where user_id=?",
                (rs, n) -> new Identity(rs.getString(1), rs.getString(2)), userId);
        for (var identity : identities) {
            challenges.deleteIdentityRateLimit(identity.botId(), identity.userKey());
            var challengeIds = db.query("select challenge_id from kakao_auth_challenges where bot_id=? and bot_user_key=?",
                    (rs, n) -> rs.getObject(1, UUID.class), identity.botId(), identity.userKey());
            for (var id : challengeIds) {
                for (var prefix : new String[]{"kakao-signup-scope:", "kakao-login-scope:", "kakao-pin-reset-scope:"})
                    db.update("delete from auth_operations where caller_scope_hash=?", secrets.keyedHash(prefix + id));
            }
            db.update("delete from kakao_auth_challenges where bot_id=? and bot_user_key=?", identity.botId(), identity.userKey());
        }
        // Successful response snapshots can include a name and account ID.
        db.update("delete from auth_operations where result_json is not null and "
                + "((result_json::jsonb -> 'user' ->> 'userId')=? or (result_json::jsonb -> 'response' -> 'user' ->> 'userId')=?)",
                Long.toString(userId), Long.toString(userId));
        db.update("delete from login_sessions where user_id=?", userId);
        db.update("delete from browser_registrations where user_id=?", userId);
        db.update("delete from kakao_bot_identities where user_id=?", userId);
        if (user.getPhoneNumber() != null) {
            db.update("delete from verification_grants where phone_number=?", user.getPhoneNumber());
            db.update("delete from sms_verifications where phone_number=?", user.getPhoneNumber());
            db.update("delete from sms_request_gates where phone_number=?", user.getPhoneNumber());
        }
        db.update("delete from users where user_id=?", userId);
    }

    @Scheduled(fixedDelayString = "${tagback.withdrawal.cleanup-interval-ms:3600000}", initialDelayString = "${tagback.withdrawal.cleanup-initial-delay-ms:60000}")
    @Transactional
    public void deleteExpiredHistory() {
        db.update("delete from withdrawn_rental_history where delete_after <= ?", Timestamp.from(clock.instant()));
    }

    private record Identity(String botId, String userKey) {}
}
